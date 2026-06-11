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
  { email: "oscar@caopartners.com.au", name: "Oscar Badman" },
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

// ── Supabase Storage upload ───────────────────────────────────────────────────
async function uploadCvToSupabase(fileBuffer, fileName, candidateName) {
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
        "Content-Type": "application/octet-stream",
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
    const { fields, fileBuffer, fileName } = await parseMultipart(event);
    const formName = fields["form-name"] || fields.form_name || "";
    const isoNow   = new Date().toISOString();
    const name     = `${(fields.first_name || "").trim()} ${(fields.last_name || "").trim()}`.trim();

    console.log(`[form-submit] form="${formName}" email="${fields.email}" keys=${Object.keys(fields).join(",")}`);
    console.log(`[form-submit] isBase64=${event.isBase64Encoded} bodyLen=${(event.body||"").length}`);

    if (formName === "talent") {
      let cvUrl = null;
      if (fileBuffer && fileBuffer.length > 0) {
        cvUrl = await uploadCvToSupabase(fileBuffer, fileName, name);
      }
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
        cv_url:              cvUrl || null,
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
