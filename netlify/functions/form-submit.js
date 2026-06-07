/**
 * CAO Partners - form-submit (minimal v3)
 * Uses Node https (stdlib only) - no fetch, no busboy, no external deps
 */

const { parse }      = require("querystring");
const https          = require("https");
const { URL }        = require("url");
const { randomUUID } = require("crypto");

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_KEY         = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ROUND_ROBIN_ENABLED  = process.env.ROUND_ROBIN_ENABLED === "true";

const BPS_REPS = [
  { email: "michael@caopartners.com.au", name: "Michael Perks" },
  { email: "jonathan@caopartners.com.au", name: "Jonathan Ngo" },
];
const TAS_REPS = [
  { email: "michael@caopartners.com.au", name: "Michael Perks" },
  { email: "oscar@caopartners.com.au",   name: "Oscar Badman" },
];

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

// ── Form parsers ──────────────────────────────────────────────────────────────
// Parse multipart as Buffer (bytes) so binary file data doesn't corrupt field parsing
function parseMultipartFields(bodyBuf, boundary) {
  const fields   = {};
  const boundBuf = Buffer.from("--" + boundary);
  const CRLF     = Buffer.from("\r\n");
  const DBLCRLF  = Buffer.from("\r\n\r\n");

  let pos = 0;
  while (pos < bodyBuf.length) {
    // Find next boundary
    const bStart = bodyBuf.indexOf(boundBuf, pos);
    if (bStart === -1) break;
    pos = bStart + boundBuf.length;

    // Skip CRLF after boundary
    if (bodyBuf.slice(pos, pos + 2).equals(CRLF)) pos += 2;
    else if (bodyBuf.slice(pos, pos + 2).toString() === "--") break; // terminal boundary

    // Find header/body separator
    const headerEnd = bodyBuf.indexOf(DBLCRLF, pos);
    if (headerEnd === -1) break;
    const header = bodyBuf.slice(pos, headerEnd).toString("utf8");
    pos = headerEnd + 4;

    // Find next boundary to know where value ends
    const nextBound = bodyBuf.indexOf(boundBuf, pos);
    if (nextBound === -1) break;
    // Value ends before \r\n-- (strip trailing CRLF)
    let valueEnd = nextBound;
    if (valueEnd >= 2 && bodyBuf.slice(valueEnd - 2, valueEnd).equals(CRLF)) valueEnd -= 2;

    const nm = header.match(/name="([^"]+)"/);
    if (!nm) { pos = nextBound; continue; }
    if (header.includes("filename=")) { pos = nextBound; continue; } // skip file fields

    fields[nm[1]] = bodyBuf.slice(pos, valueEnd).toString("utf8");
    pos = nextBound;
  }
  return fields;
}

function parseFields(event) {
  const ct = (event.headers["content-type"] || event.headers["Content-Type"] || "").toLowerCase();

  if (ct.includes("multipart/form-data")) {
    // Decode as Buffer - handles binary file data safely
    const bodyBuf = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64")
      : Buffer.from(event.body || "", "utf8");

    // Detect actual boundary from first line of body.
    // Some clients add extra leading dashes vs what Content-Type declares.
    // e.g. Content-Type says boundary=----abc but body uses ------abc
    const firstLine = bodyBuf.slice(0, 300).toString("utf8").split("\r\n")[0];
    const actualBoundary = firstLine.startsWith("--") ? firstLine.slice(2) : null;

    if (actualBoundary) {
      return parseMultipartFields(bodyBuf, actualBoundary);
    }
    // Fallback: use boundary from Content-Type header
    const bm = ct.match(/boundary=([^\s;]+)/);
    if (bm) return parseMultipartFields(bodyBuf, bm[1]);
  }

  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : (event.body || "");
  return parse(raw);
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

  const REDIRECT = { statusCode: 302, headers: { Location: "/application-submitted.html" }, body: "" };

  try {
    const fields   = parseFields(event);
    const formName = fields["form-name"] || fields.form_name || "";
    const isoNow   = new Date().toISOString();
    const name     = `${(fields.first_name || "").trim()} ${(fields.last_name || "").trim()}`.trim();

    console.log(`[form-submit] form="${formName}" email="${fields.email}" keys=${Object.keys(fields).join(",")}`);
    console.log(`[form-submit] isBase64=${event.isBase64Encoded} bodyLen=${(event.body||"").length}`);

    if (formName === "talent") {
      const rep = await getNextRep("TAS");
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
        assigned_to:         rep ? rep.email : null,
        cv_url:              null,
        created_at:          isoNow,
        updated_at:          isoNow,
      });
      console.log(`[form-submit] talent write: ${ok ? "OK" : "FAILED"}`);
      return REDIRECT;
    }

    if (formName === "enquire") {
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
