/**
 * booking-confirmed — a lead picked a time in the Book Now calendar.
 *
 * POST { lead_id }  ->  { ok: true }
 *
 * WHY THIS EXISTS AT ALL. The warm outreach cron selects leads on
 * `outreach_email_sent != true` with a status of New Lead or Contacted, and the
 * email it sends offers the rep's Calendly link. Without this, someone who had
 * JUST booked would receive "thanks for reaching out, here is my calendar"
 * within a couple of hours. That reads as nobody being home, to the single most
 * engaged lead of the day.
 *
 * The pipeline advancer does move booked leads to Discovery Booked, which the
 * cron's status filter excludes, but it runs hourly and the outreach cron can
 * fire first. This closes that window immediately.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not set deal_status. The pipeline
 * advancer owns that column and decides it from the Calendly booking itself,
 * which is the stated source of truth. Two writers on one status field is how
 * cards start disagreeing with calendars.
 *
 * ON TRUST. The only input is a lead id that the caller was already handed when
 * they created that lead moments earlier. The worst a forged call can do is
 * suppress one outreach email and add a note, so this is not worth a signed
 * token: the guard is that it can only ever set the flag TRUE, never clear it,
 * and never touches contact details, status or assignment.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const reply = (statusCode, body) => ({ statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return reply(405, { error: "POST only" });
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("[booking-confirmed] Supabase not configured");
    return reply(500, { error: "not configured" });
  }

  let leadId;
  try {
    leadId = (JSON.parse(event.body || "{}").lead_id || "").trim();
  } catch (e) {
    return reply(400, { error: "bad body" });
  }
  if (!UUID.test(leadId)) return reply(400, { error: "lead_id must be a uuid" });

  const now = new Date().toISOString();
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/cao_Leads?id=eq.${leadId}`,
      {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({ outreach_email_sent: true, updated_at: now }),
      },
    );
    if (!res.ok) {
      console.error(`[booking-confirmed] patch ${leadId}: ${res.status} ${(await res.text()).slice(0, 200)}`);
      return reply(502, { error: "could not update the lead" });
    }
    const rows = await res.json().catch(() => []);
    if (!rows.length) return reply(404, { error: "lead not found" });

    console.log(`[booking-confirmed] ${leadId} booked from the form, outreach suppressed`);
    return reply(200, { ok: true });
  } catch (e) {
    console.error("[booking-confirmed] crash:", e.message);
    return reply(500, { error: "failed" });
  }
};
