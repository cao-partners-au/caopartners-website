/**
 * CAO Partners - Netlify Function: form-submit
 *
 * Handles POST from both Netlify forms (enquire + talent).
 * Replaces the netlify-sync.py hourly cron for new submissions.
 *
 * Flow:
 *   1. Parse multipart form body (fields + optional CV file)
 *   2. If CV present: upload to Supabase Storage (candidate-cvs bucket)
 *   3. Write candidate/lead row directly to Supabase
 *   4. Write row to Google Sheet (temporary - flagged for removal when CRM is master)
 *   5. Push lead contact to Aircall (leads only)
 *   6. Redirect to thank-you page
 *
 * ⚠️  SHEET WRITE FLAGGED: Steps 4 is a Google Sheet write.
 *     Remove when CRM intake form replaces this Netlify form entirely.
 *     Tracked as outstanding migration item (17 May 2026).
 *
 * Env vars required (set in Netlify dashboard):
 *   SUPABASE_URL              - e.g. https://ksxnbkmoqnucsgivszlo.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY - service role key (not anon key - needs Storage write)
 *   GOOGLE_SERVICE_ACCOUNT_JSON - full JSON string of service account credentials
 *   AIRCALL_API_ID            - Aircall API ID
 *   AIRCALL_API_TOKEN         - Aircall API token
 */

const { parse } = require("querystring");

// ── Env ───────────────────────────────────────────────────────────────────────
const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SHEET_ID          = "1KXbac_zHAXRC78ZyC_lNNhveC_HvVYHHvIPaKr2E3Zg";
const AIRCALL_API_ID    = process.env.AIRCALL_API_ID;
const AIRCALL_API_TOKEN = process.env.AIRCALL_API_TOKEN;
const VIRGINIA_NUMBER_ID = 1255171;

// ── Date helpers ──────────────────────────────────────────────────────────────
function nowAEST() {
  const d = new Date();
  // UTC+10 (Brisbane - no DST)
  const aest = new Date(d.getTime() + 10 * 60 * 60 * 1000);
  const dd   = String(aest.getUTCDate()).padStart(2, "0");
  const mm   = String(aest.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = aest.getUTCFullYear();
  const hh   = String(aest.getUTCHours()).padStart(2, "0");
  const min  = String(aest.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

// ── Phone normalisation ───────────────────────────────────────────────────────
function normalisePhone(raw) {
  if (!raw || !raw.trim()) return null;
  let p = raw.trim().replace(/[\s\-\(\)\.]+/g, "");
  if (p.startsWith("+61")) return p;
  if (/^61\d{9}$/.test(p)) return "+" + p;
  if (p.startsWith("04") && p.length === 10) return "+614" + p.slice(2);
  if (p.startsWith("0") && p.length >= 9) return "+61" + p.slice(1);
  if (p.startsWith("+")) return p;
  return raw.trim();
}

// ── Parse multipart form (Netlify passes raw body + headers) ─────────────────
async function parseMultipart(event) {
  // Netlify Functions v2 pass isBase64Encoded + body
  // For multipart/form-data we use a simple boundary parser
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
          stream.resume(); // discard unexpected files
        }
      });

      bb.on("finish", () => resolve({ fields, fileBuffer, fileName, fileMime }));
      bb.on("error",  (e) => reject(e));

      bb.write(bodyBuffer);
      bb.end();
    });
  }

  // Fallback: URL-encoded (no file upload path)
  const body = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : event.body || "";
  return { fields: parse(body), fileBuffer: null, fileName: null, fileMime: null };
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

  // Return public URL
  return `${SUPABASE_URL}/storage/v1/object/public/candidate-cvs/${path}`;
}

// ── Supabase DB write ─────────────────────────────────────────────────────────
async function supabaseInsertCandidate(fields, cvUrl, submittedAt) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;

  const name  = `${(fields.first_name || "").trim()} ${(fields.last_name || "").trim()}`.trim();
  const email = (fields.email || "").toLowerCase().trim();
  if (!email) return;

  const now = new Date().toISOString();

  const payload = {
    id:                    crypto.randomUUID(),
    submitted_at:          submittedAt,
    name,
    email,
    phone:                 normalisePhone(fields.phone),
    current_title:         fields.current_title || null,
    years_experience:      fields.years_experience || null,
    ai_experience:         fields.ai_experience || null,
    availability:          fields.availability || null,
    linkedin:              fields.linkedin || null,
    state:                 fields.state || null,
    scoring_result:        "Pending",
    interview_booked:      "Not Yet",
    interview_completed:   "Not Yet",
    interview_score:       null,
    candidate_status:      "New",
    assigned_to:           null,
    cv_url:                cvUrl || null,
    notes:                 fields.bio || null,
    michael_score:         null,
    salary_expectation:    null,
    fireflies_transcript_id: null,
    outreach_sent_at:      null,
    status_updated_at:     now,
    created_at:            now,
    updated_at:            now,
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/cao_Candidates`, {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${SUPABASE_KEY}`,
      apikey:         SUPABASE_KEY,
      "Content-Type": "application/json",
      Prefer:         "resolution=ignore-duplicates",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`Supabase candidate insert failed: ${res.status} ${err}`);
  } else {
    console.log(`Supabase: candidate ${name} inserted.`);
  }
}

async function supabaseInsertLead(fields, submittedAt) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;

  const name  = `${(fields.first_name || "").trim()} ${(fields.last_name || "").trim()}`.trim();
  const email = (fields.email || "").toLowerCase().trim();
  if (!email) return;

  const now = new Date().toISOString();

  const payload = {
    id:                   crypto.randomUUID(),
    submitted_at:         submittedAt,
    name,
    email,
    phone:                normalisePhone(fields.phone),
    company:              fields.company || null,
    company_size:         fields.company_size || null,
    deal_status:          "New Lead",
    contacted:            false,
    discovery_booked:     false,
    discovery_completed:  false,
    service_agreement:    "Not Sent",
    outreach_email_sent:  false,
    assigned_to:          null,
    rep_name:             null,
    state:                fields.state || null,
    notes:                null,
    discovery_score:      null,
    status_updated_at:    now,
    created_at:           now,
    updated_at:           now,
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/cao_Leads`, {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${SUPABASE_KEY}`,
      apikey:         SUPABASE_KEY,
      "Content-Type": "application/json",
      Prefer:         "resolution=ignore-duplicates",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`Supabase lead insert failed: ${res.status} ${err}`);
  } else {
    console.log(`Supabase: lead ${name} inserted.`);
  }
}

// ── Google Sheets write ───────────────────────────────────────────────────────
// ⚠️  FLAGGED FOR REMOVAL - sheet write temporary until CRM is master intake
async function appendToSheet(tabName, row) {
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!saJson) {
    console.warn("GOOGLE_SERVICE_ACCOUNT_JSON not set - skipping sheet write");
    return;
  }

  // Get access token via service account JWT
  const { GoogleAuth } = require("google-auth-library");
  const auth = new GoogleAuth({
    credentials: JSON.parse(saJson),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const client = await auth.getClient();
  const token  = await client.getAccessToken();

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/'${tabName}'!A3:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;

  const res = await fetch(url, {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${token.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: [row] }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`Sheet append failed: ${res.status} ${err}`);
  } else {
    console.log(`Sheet: row appended to ${tabName}`);
  }
}

// ── Aircall contact push (leads only) ─────────────────────────────────────────
async function pushToAircall(name, phone, company, email) {
  if (!AIRCALL_API_ID || !AIRCALL_API_TOKEN || !phone) return;

  const p = normalisePhone(phone);
  if (!p) return;

  const auth = Buffer.from(`${AIRCALL_API_ID}:${AIRCALL_API_TOKEN}`).toString("base64");
  const parts = name.trim().split(" ");

  const res = await fetch("https://api.aircall.io/v1/contacts", {
    method:  "POST",
    headers: {
      Authorization:  `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      first_name:   parts[0] || "",
      last_name:    parts.slice(1).join(" ") || "",
      company_name: company || "",
      information:  email || "",
      phone_numbers: [{ label: "work", value: p }],
    }),
  });

  if (res.ok) {
    const data = await res.json();
    console.log(`Aircall: contact created ID=${data?.contact?.id}`);
  } else {
    console.warn(`Aircall: contact creation failed ${res.status}`);
  }
}

// ── Row builders (matching netlify-sync.py column order) ─────────────────────
function buildRecruitsRow(fields, submittedAt, cvUrl) {
  const name = `${(fields.first_name || "").trim()} ${(fields.last_name || "").trim()}`.trim();
  // A=Submitted At, B=Name, C=Email, D=Phone, E=Current Title, F=Years Exp,
  // G=AI Experience, H=Availability, I=LinkedIn, J=State, K=Scoring Result,
  // L=Interview Booked, M=Interview Completed, N=Interview Score,
  // O=Candidate Status, P=Assigned To, Q=CV Link, R=Notes(bio)
  return [
    submittedAt, name,
    fields.email || "", fields.phone || "",
    fields.current_title || "", fields.years_experience || "",
    fields.ai_experience || "", fields.availability || "",
    fields.linkedin || "",
    fields.state || "",
    "Pending",
    "Not Yet",
    "Not Yet",
    "",
    "New",
    "", cvUrl || "",
    fields.bio || "",
  ];
}

function buildLeadsRow(fields, submittedAt) {
  const name = `${(fields.first_name || "").trim()} ${(fields.last_name || "").trim()}`.trim();
  // A=Submitted At, B=Name, C=Email, D=Phone, E=Company, F=Company Size,
  // G=Deal Status, H=Contacted, I=Discovery Booked, J=Discovery Completed,
  // K=Service Agreement, L=Outreach Email Sent, M=Assigned To, N=State
  return [
    submittedAt, name,
    fields.email || "", fields.phone || "",
    fields.company || "", fields.company_size || "",
    "New Lead", "Not Yet", "Not Yet", "Not Yet", "Not Sent", "",
    "",
    fields.state || "",
  ];
}

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { fields, fileBuffer, fileName } = await parseMultipart(event);
    const formName    = fields["form-name"] || fields.form_name || "";
    const submittedAt = nowAEST();
    const isoNow      = new Date().toISOString();
    const name        = `${(fields.first_name || "").trim()} ${(fields.last_name || "").trim()}`.trim();

    // ── Talent (Become a CAO) form ─────────────────────────────────────────
    if (formName === "talent") {
      // 1. Upload CV if present
      let cvUrl = null;
      if (fileBuffer && fileBuffer.length > 0) {
        cvUrl = await uploadCvToSupabase(fileBuffer, fileName, name);
        console.log(`CV uploaded: ${cvUrl}`);
      } else {
        console.log("No CV uploaded - continuing without.");
      }

      // 2. Write to Supabase (primary)
      await supabaseInsertCandidate(fields, cvUrl, isoNow);

      // 3. Write to Google Sheet (temporary - flagged for removal)
      const row = buildRecruitsRow(fields, submittedAt, cvUrl);
      await appendToSheet("Potential Recruits", row);

      return {
        statusCode: 302,
        headers: { Location: "/thank-you" },
        body: "",
      };
    }

    // ── Enquire (Sales Lead) form ──────────────────────────────────────────
    if (formName === "enquire") {
      // 1. Write to Supabase (primary)
      await supabaseInsertLead(fields, isoNow);

      // 2. Push to Aircall
      await pushToAircall(name, fields.phone, fields.company, fields.email);

      // 3. Write to Google Sheet (temporary - flagged for removal)
      const row = buildLeadsRow(fields, submittedAt);
      await appendToSheet("Sales Leads", row);

      return {
        statusCode: 302,
        headers: { Location: "/thank-you" },
        body: "",
      };
    }

    console.warn(`Unknown form-name: ${formName}`);
    return {
      statusCode: 302,
      headers: { Location: "/thank-you" },
      body: "",
    };

  } catch (err) {
    console.error("form-submit error:", err);
    return {
      statusCode: 302,
      headers: { Location: "/thank-you" },
      body: "",
    };
  }
};
