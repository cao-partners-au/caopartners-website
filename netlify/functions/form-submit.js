/**
 * CAO Partners - form-submit (minimal v3)
 * Uses Node https (stdlib only) - no fetch, no busboy, no external deps
 */

const { parse }      = require("querystring");
const https          = require("https");
const { URL }        = require("url");
const { randomUUID, createHash } = require("crypto");

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_KEY         = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ROUND_ROBIN_ENABLED  = process.env.ROUND_ROBIN_ENABLED === "true";
const TURNSTILE_SECRET     = process.env.TURNSTILE_SECRET; // Cloudflare Turnstile (CAPTCHA) server-side key

// Meta Conversions API (server-side Lead event). Pixel ID is non-secret (it's in the
// client HTML); the access token is a long-lived System User token and MUST stay secret.
// META_TEST_EVENT_CODE is optional — set it to route events to Events Manager → Test
// Events for validation, leave empty for live counting.
const META_PIXEL_ID        = process.env.META_PIXEL_ID;
const META_CAPI_TOKEN      = process.env.META_CAPI_ACCESS_TOKEN;
const META_TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE;
const META_API_VERSION     = "v21.0"; // bump ~yearly before Meta deprecates it

const BPS_REPS = [
  { email: "robert@caopartners.com.au", name: "Robert Kelly" },
  { email: "jonathan@caopartners.com.au", name: "Jonathan Ngo" },
];
const TAS_REPS = [
  { email: "oscar@caopartners.com.au", name: "Oscar Badman" },
];

// Spam defence. These forms POST to this function (not Netlify's native form handler),
// so the page's bot-field honeypot and any disposable-domain filtering must be enforced
// HERE. Known throwaway / probe domains we've seen hammering the form, plus common
// disposable providers. Add new offenders as they appear.
const DISPOSABLE_DOMAINS = new Set([
  "immenseignite.info", "web-library.net",
  "mailinator.com", "guerrillamail.com", "guerrillamail.info", "sharklasers.com",
  "10minutemail.com", "yopmail.com", "tempmail.com", "temp-mail.org", "trashmail.com",
  "getnada.com", "dispostable.com", "maildrop.cc", "throwawaymail.com", "fakeinbox.com",
  "mintemail.com", "moakt.com", "emailondeck.com", "tempr.email",
]);

// Returns a reason string if this submission looks like bot spam, else null.
// We respond with the normal success redirect either way so bots get no signal.
function spamReason(fields) {
  // 1. Honeypot: real users never see/fill bot-field; bots that fill every input do.
  const honey = (fields["bot-field"] || fields.bot_field || "").trim();
  if (honey) return "honeypot filled";
  // 2. Disposable / known-probe email domain.
  const domain = ((fields.email || "").toLowerCase().trim().split("@")[1] || "").trim();
  if (domain && DISPOSABLE_DOMAINS.has(domain)) return `disposable domain ${domain}`;
  return null;
}

// Cloudflare Turnstile (CAPTCHA) server-side verification. Returns null when OK — or
// when no secret is configured in this deploy context (falls back to honeypot+blocklist
// so non-prod contexts don't break). Returns a reason string when the token is missing
// or invalid. Network errors fail OPEN (never block a genuine user on a Cloudflare blip).
async function turnstileReason(fields, event) {
  if (!TURNSTILE_SECRET) return null;
  const token = fields["cf-turnstile-response"] || fields.cf_turnstile_response || "";
  if (!token) return "missing Turnstile token";
  try {
    const headers = event.headers || {};
    const ip = headers["x-nf-client-connection-ip"] || (headers["x-forwarded-for"] || "").split(",")[0].trim() || "";
    const params = new URLSearchParams({ secret: TURNSTILE_SECRET, response: token });
    if (ip) params.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const data = await res.json().catch(() => ({}));
    return data.success ? null : `Turnstile failed (${(data["error-codes"] || []).join(",") || "no success"})`;
  } catch (e) {
    console.error("[form-submit] Turnstile verify error, allowing:", e.message);
    return null; // fail open
  }
}

// ── HTTP helper (stdlib https) ────────────────────────────────────────────────
function httpsRequest(urlStr, method, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const opts = {
      hostname: u.hostname,
      path:     u.pathname + u.search,
      method,
      headers,
    };
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function supabaseGet(path) {
  const res = await httpsRequest(
    `${SUPABASE_URL}/rest/v1/${path}`,
    "GET",
    { "Authorization": `Bearer ${SUPABASE_KEY}`, "apikey": SUPABASE_KEY, "Accept": "application/json" },
    null
  );
  return JSON.parse(res.body);
}

// Idempotency guard: the form's submit button isn't debounced, so a double-click
// double-POSTs (~1-2s apart) and we'd insert the same lead/candidate twice. If a row
// with this email already landed in the last 90s, treat this POST as the duplicate and
// skip it (no insert, no round-robin advance). On any error we proceed (never block a
// genuine submission).
async function isRecentDuplicate(table, email) {
  if (!email) return false;
  try {
    const since = new Date(Date.now() - 90 * 1000).toISOString();
    const rows = await supabaseGet(`${table}?email=eq.${encodeURIComponent(email)}&created_at=gte.${encodeURIComponent(since)}&select=id&limit=1`);
    return Array.isArray(rows) && rows.length > 0;
  } catch (e) {
    console.error("[form-submit] dedup check failed, proceeding:", e.message);
    return false;
  }
}

async function supabasePatch(path, payload) {
  const body = JSON.stringify(payload);
  return httpsRequest(
    `${SUPABASE_URL}/rest/v1/${path}`,
    "PATCH",
    {
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "apikey": SUPABASE_KEY,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "Prefer": "return=minimal",
    },
    body
  );
}

async function supabaseInsert(table, payload) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Supabase env vars missing");
    return false;
  }
  const body = JSON.stringify(payload);
  const res = await httpsRequest(
    `${SUPABASE_URL}/rest/v1/${table}`,
    "POST",
    {
      "Authorization":  `Bearer ${SUPABASE_KEY}`,
      "apikey":         SUPABASE_KEY,
      "Content-Type":   "application/json",
      "Content-Length": Buffer.byteLength(body),
      "Prefer":         "return=minimal",
    },
    body
  );
  if (res.status >= 300) {
    console.error(`Supabase insert failed (${res.status}): ${res.body}`);
    return false;
  }
  console.log(`Supabase insert OK (${res.status})`);
  return true;
}

// ── Supabase Storage upload ───────────────────────────────────────────────────
async function uploadCvToSupabase(fileBuffer, fileName, fileMime, candidateName) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn("Supabase env vars not set - skipping CV upload");
    return null;
  }

  const ts      = Date.now();
  const safe    = (candidateName || "candidate").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g, "");
  const ext     = (fileName || "cv.pdf").split(".").pop().toLowerCase();
  const path    = `${ts}-${safe}.${ext}`;

  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/candidate-cvs/${path}`,
    {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${SUPABASE_KEY}`,
        "Content-Type": fileMime || "application/pdf",
        "x-upsert":     "false",
      },
      body: fileBuffer,
    }
  );

  if (!res.ok) {
    const err = await res.text();
    console.error(`CV upload failed: ${res.status} ${err}`);
    return null;
  }

  return `${SUPABASE_URL}/storage/v1/object/public/candidate-cvs/${path}`;
}

// ── Round robin ───────────────────────────────────────────────────────────────
async function getNextRep(role) {
  const reps = role === "BPS" ? BPS_REPS : TAS_REPS;
  if (!ROUND_ROBIN_ENABLED || !SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const rows = await supabaseGet(`cao_RoundRobin?role=eq.${role}&select=id,last_assigned,total_assigned`);
    const row = rows?.[0];
    if (!row) return null;
    const lastIdx = reps.findIndex(r => r.email === row.last_assigned);
    const nextRep = reps[(lastIdx + 1) % reps.length];
    await supabasePatch(`cao_RoundRobin?role=eq.${role}`, {
      last_assigned:    nextRep.email,
      last_assigned_at: new Date().toISOString(),
      total_assigned:   (row.total_assigned ?? 0) + 1,
    });
    console.log(`[round-robin] ${role} -> ${nextRep.email}`);
    return nextRep;
  } catch (e) {
    console.error("[round-robin] error:", e.message);
    return null;
  }
}

// ── Parse multipart form (Netlify passes raw body + headers) ─────────────────
async function parseMultipart(event) {
  const contentType = event.headers["content-type"] || event.headers["Content-Type"] || "";

  if (contentType.includes("multipart/form-data")) {
    // Dynamically require busboy (bundled via package.json)
    const Busboy = require("busboy");

    return new Promise((resolve, reject) => {
      const fields = {};
      let fileBuffer = null;
      let fileName   = null;
      let fileMime   = null;

      const bodyBuffer = event.isBase64Encoded
        ? Buffer.from(event.body, "base64")
        : Buffer.from(event.body || "");

      const bb = Busboy({ headers: { "content-type": contentType } });

      bb.on("field", (name, val) => { fields[name] = val; });

      bb.on("file", (name, stream, info) => {
        if (name === "cv") {
          fileName = info.filename;
          fileMime = info.mimeType;
          const chunks = [];
          stream.on("data", (d) => chunks.push(d));
          stream.on("end",  ()  => { fileBuffer = Buffer.concat(chunks); });
        } else {
          stream.resume();
        }
      });

      bb.on("finish", () => resolve({ fields, fileBuffer, fileName, fileMime }));
      bb.on("error",  (e) => reject(e));

      bb.write(bodyBuffer);
      bb.end();
    });
  }

  // Fallback: URL-encoded
  const body = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : event.body || "";
  return { fields: parse(body), fileBuffer: null, fileName: null, fileMime: null };
}

function normalisePhone(raw) {
  if (!raw || !raw.trim()) return null;
  let p = raw.trim().replace(/[\s\-\(\)\.]+/g, "");
  if (p.startsWith("+61")) return p;
  if (/^61\d{9}$/.test(p)) return "+" + p;
  if (p.startsWith("04") && p.length === 10) return "+614" + p.slice(2);
  if (p.startsWith("0") && p.length >= 9) return "+61" + p.slice(1);
  return raw.trim();
}

// ── Meta CAPI helpers ─────────────────────────────────────────────────────────
function sha256(v) {
  return createHash("sha256").update(v).digest("hex");
}

// Normalize then SHA-256 a PII field (trim + lowercase per Meta's spec).
function hashPii(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  return s ? sha256(s) : null;
}

// Meta wants phone as digits-only, country-coded, no '+' or leading zero. AU-centric:
// 04xx xxx xxx -> 614xxxxxxxx. Returns null for anything implausible so we omit the
// param rather than send garbage that drags down match quality.
function metaPhoneDigits(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/\D+/g, "");
  if (!d) return null;
  if (d.startsWith("0"))       d = "61" + d.slice(1);
  else if (!d.startsWith("61")) d = "61" + d;
  if (d.length < 10 || d.length > 13) return null;
  return d;
}

// Best-effort server-side Lead event. Fully isolated: any error/timeout/non-200 is
// logged and swallowed so it can never affect the lead save or the redirect. Shares
// event_id with the client pixel so Meta dedupes the pair into one Lead.
async function sendMetaLeadEvent(event, fields, leadType) {
  if (!META_CAPI_TOKEN || !META_PIXEL_ID) {
    console.warn("[meta-capi] token/pixel id not set — skipping Lead event");
    return;
  }
  try {
    const headers = event.headers || {};
    const clientIp = headers["x-nf-client-connection-ip"]
      || (headers["x-forwarded-for"] || "").split(",")[0].trim()
      || undefined;
    const userAgent = headers["user-agent"] || headers["User-Agent"] || undefined;

    const userData = { country: sha256("au") };
    const em = hashPii(fields.email);       if (em) userData.em = em;
    const phone = metaPhoneDigits(fields.phone); if (phone) userData.ph = sha256(phone);
    const fn = hashPii(fields.first_name);  if (fn) userData.fn = fn;
    const ln = hashPii(fields.last_name);   if (ln) userData.ln = ln;
    const st = hashPii(fields.state);       if (st) userData.st = st;
    if (fields.fb_fbp) userData.fbp = fields.fb_fbp;
    if (fields.fb_fbc) userData.fbc = fields.fb_fbc;
    if (clientIp)  userData.client_ip_address = clientIp;
    if (userAgent) userData.client_user_agent = userAgent;

    const eventId = fields.fb_event_id || randomUUID();
    const payload = {
      data: [{
        event_name:       "Lead",
        event_time:       Math.floor(Date.now() / 1000),
        event_id:         eventId,
        action_source:    "website",
        event_source_url: fields.fb_source_url || headers["referer"] || headers["Referer"] || undefined,
        user_data:        userData,
        custom_data:      { lead_type: leadType || "enquire" },
      }],
    };
    if (META_TEST_EVENT_CODE) payload.test_event_code = META_TEST_EVENT_CODE;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    let res;
    try {
      res = await fetch(
        `https://graph.facebook.com/${META_API_VERSION}/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(META_CAPI_TOKEN)}`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(payload),
          signal:  controller.signal,
        }
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let parsed = {};
    try { parsed = JSON.parse(text); } catch (e) {}
    const trace = parsed.fbtrace_id || "";
    if (!res.ok) {
      const msg = parsed.error ? parsed.error.message : text;
      console.error(`[meta-capi] Lead failed (${res.status}) event_id=${eventId} fbtrace_id=${trace} err=${msg}`);
    } else {
      console.log(`[meta-capi] Lead OK events_received=${parsed.events_received} event_id=${eventId} fbtrace_id=${trace}`);
    }
  } catch (err) {
    console.error("[meta-capi] Lead error (ignored):", err.message);
  }
}

function nowAEST() {
  const d    = new Date();
  const aest = new Date(d.getTime() + 10 * 60 * 60 * 1000);
  return [
    String(aest.getUTCDate()).padStart(2, "0"),
    String(aest.getUTCMonth() + 1).padStart(2, "0"),
    aest.getUTCFullYear(),
  ].join("/") + " " + [
    String(aest.getUTCHours()).padStart(2, "0"),
    String(aest.getUTCMinutes()).padStart(2, "0"),
  ].join(":");
}

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const REDIRECT = { statusCode: 302, headers: { Location: "/success.html" }, body: "" };

  try {
    const { fields, fileBuffer, fileName, fileMime } = await parseMultipart(event);
    const formName = fields["form-name"] || fields.form_name || "";
    const isoNow   = new Date().toISOString();
    const name     = `${(fields.first_name || "").trim()} ${(fields.last_name || "").trim()}`.trim();

    console.log(`[form-submit] form="${formName}" email="${fields.email}" keys=${Object.keys(fields).join(",")}`);
    console.log(`[form-submit] isBase64=${event.isBase64Encoded} bodyLen=${(event.body||"").length}`);

    // Spam gate: drop honeypot-filled + disposable-domain submissions silently (return
    // the normal success redirect so the bot can't tell it was blocked). No DB write.
    const spam = spamReason(fields);
    if (spam) {
      console.log(`[form-submit] SPAM blocked (${spam}) email="${fields.email}" name="${name}"`);
      return REDIRECT;
    }
    // Turnstile (real CAPTCHA gate). Runs only when the secret is configured.
    const tsFail = await turnstileReason(fields, event);
    if (tsFail) {
      console.log(`[form-submit] SPAM blocked (${tsFail}) email="${fields.email}" name="${name}"`);
      return REDIRECT;
    }

    if (formName === "talent") {
      const email = (fields.email || "").toLowerCase().trim();
      if (await isRecentDuplicate("cao_Candidates", email)) {
        console.log(`[form-submit] duplicate talent submission within 90s for ${email} — skipping`);
        return REDIRECT;
      }
      let cvUrl = null;
      if (fileBuffer && fileBuffer.length > 0) {
        cvUrl = await uploadCvToSupabase(fileBuffer, fileName, fileMime, name);
      }
      const rep = await getNextRep("TAS");
      // TAS is Oscar-only, so a candidate must never land unassigned even if the
      // round robin is disabled/empty. Write BOTH columns: the outreach cron keys
      // off assigned_to, while the CRM UI displays tas_assigned.
      const tasEmail = (rep && rep.email) || "oscar@caopartners.com.au";
      const ok  = await supabaseInsert("cao_Candidates", {
        id:                  randomUUID(),
        submitted_at:        isoNow,
        name,
        email:               (fields.email || "").toLowerCase().trim(),
        phone:               normalisePhone(fields.phone),
        current_title:       fields.current_title || null,
        years_experience:    fields.years_experience || null,
        ai_experience:       fields.ai_experience || null,
        availability:        fields.availability || null,
        linkedin:            fields.linkedin || null,
        state:               fields.state || null,
        scoring_result:      "Pending",
        interview_booked:    "Not Yet",
        interview_completed: "Not Yet",
        candidate_status:    "New",
        assigned_to:         tasEmail,
        tas_assigned:        tasEmail,
        cv_url:              cvUrl || null,
        created_at:          isoNow,
        updated_at:          isoNow,
      });
      console.log(`[form-submit] talent write: ${ok ? "OK" : "FAILED"}`);
      // Server-side Meta Lead event, only on a real new insert (not the dedup-skip path).
      // Awaited (serverless can freeze after return) and isolated so it can never break
      // the redirect. Shares event_id with the client pixel for dedup.
      if (ok) await sendMetaLeadEvent(event, fields, "talent");
      return REDIRECT;
    }

    if (formName === "enquire") {
      const email = (fields.email || "").toLowerCase().trim();
      if (await isRecentDuplicate("cao_Leads", email)) {
        console.log(`[form-submit] duplicate enquire submission within 90s for ${email} — skipping`);
        return REDIRECT;
      }
      const rep = await getNextRep("BPS");
      const ok  = await supabaseInsert("cao_Leads", {
        id:           randomUUID(),
        submitted_at: isoNow,
        name,
        email:        (fields.email || "").toLowerCase().trim(),
        phone:        normalisePhone(fields.phone),
        company:      fields.company || null,
        company_size: fields.company_size || null,
        deal_status:  "New Lead",
        assigned_to:  rep ? rep.email : null,
        rep_name:     rep ? rep.name : null,
        state:        fields.state || null,
        notes:        fields.message || null,
        created_at:   isoNow,
        updated_at:   isoNow,
      });
      console.log(`[form-submit] enquire write: ${ok ? "OK" : "FAILED"}`);
      // Fire the server-side Meta Lead event only on a real new insert (not the dedup-skip
      // path above), so the event count stays honest. Awaited because the serverless
      // instance can freeze after we return; isolated so it can never break the redirect.
      if (ok) await sendMetaLeadEvent(event, fields, "enquire");
      return REDIRECT;
    }

    // Unknown form - log field keys to diagnose
    console.warn(`[form-submit] unknown form-name="${formName}" keys=${Object.keys(fields).join(",")}`);
    return REDIRECT;

  } catch (err) {
    console.error("[form-submit] crash:", err.message, err.stack);
    return REDIRECT;
  }
};
