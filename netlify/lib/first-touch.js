/* first-touch.js: turn where a visitor FIRST came from into a CRM lead_source.
 *
 * Input is the hidden `first_touch` field stamped by /attribution.js (JSON: ref,
 * land, utm_*, click ids), falling back to the POST's own Referer URL, whose query
 * string sometimes carries the UTMs (e.g. ?utm_source=chatgpt.com) even when the
 * referrer itself is our homepage.
 *
 * Output is { source, detail } or null. It is only ever consulted when the funnel
 * declared no channel, so it can never overwrite /tt, /cao, /li, OLC or ?src pages.
 *
 * Channels deliberately reuse existing lead_source values where they mean the same
 * thing (Google-Ads, Organic, LinkedIn, Meta-CAO, Creator Army), and add only four
 * new ones, all mapped in the CRM's lib/lead-source.ts:
 *   AI Search     ChatGPT, Perplexity, Claude, Gemini, Copilot
 *   Social        organic Facebook / Instagram / LinkedIn / X / YouTube / TikTok / Reddit
 *   Email         webmail referrers or utm_medium=email
 *   Web Referral  any other website, or a tagged link we do not recognise
 * "Referral" is NOT reused: it already means a person referred them.
 * No evidence => null, which the CRM shows honestly as Direct / Unattributed.
 */
"use strict";

const AI = [/(^|\.)chatgpt\.com$/, /(^|\.)openai\.com$/, /(^|\.)perplexity\.ai$/, /(^|\.)claude\.ai$/,
  /^gemini\.google\.com$/, /(^|\.)copilot\.microsoft\.com$/, /(^|\.)you\.com$/, /(^|\.)phind\.com$/];
const AI_UTM = /chatgpt|openai|perplexity|claude|gemini|copilot/i;
const SEARCH = [[/(^|\.)google\.[a-z.]+$/, "google"], [/(^|\.)bing\.com$/, "bing"], [/(^|\.)duckduckgo\.com$/, "duckduckgo"],
  [/(^|\.)yahoo\.[a-z.]+$/, "yahoo"], [/(^|\.)ecosia\.org$/, "ecosia"], [/^search\.brave\.com$/, "brave"]];
const SOCIAL = [[/(^|\.)facebook\.com$|^fb\.me$/, "facebook"], [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)linkedin\.com$|^lnkd\.in$/, "linkedin"], [/^t\.co$|(^|\.)x\.com$|(^|\.)twitter\.com$/, "x"],
  [/(^|\.)youtube\.com$|^youtu\.be$/, "youtube"], [/(^|\.)tiktok\.com$/, "tiktok"], [/(^|\.)reddit\.com$/, "reddit"],
  [/(^|\.)threads\.net$/, "threads"]];
const MAIL = /^(mail\.google\.com|outlook\.(live|office|office365)\.com|mail\.yahoo\.com|webmail\..+)$/;
const SOCIAL_UTM = { fb: "facebook", facebook: "facebook", ig: "instagram", instagram: "instagram",
  linkedin: "linkedin", li: "linkedin", tiktok: "tiktok", youtube: "youtube", x: "x", twitter: "x" };
const PAID = /^(paid|cpc|ppc|paid_social|paidsocial|social_paid|display)$/i;

function host(u) {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

function parseTouch(raw, referer) {
  let t = null;
  try { t = raw ? JSON.parse(raw) : null; } catch { t = null; }
  if (!t || typeof t !== "object") t = {};
  // The Referer's query string is the one attribution signal that survives even
  // when the visitor never loaded /attribution.js (blocked storage, old cached page).
  try {
    const q = new URL(referer).searchParams;
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_id", "gclid", "fbclid", "li_fat_id"]) {
      if (!t[k] && q.get(k)) t[k] = q.get(k).slice(0, 120);
    }
  } catch {}
  return t;
}

function detailOf(t, extra) {
  const bits = [];
  if (extra) bits.push(extra);
  if (t.ref) bits.push(`ref=${t.ref}`);
  for (const k of ["utm_source", "utm_medium", "utm_campaign"]) if (t[k]) bits.push(`${k}=${t[k]}`);
  if (t.land) bits.push(`land=${t.land}`);
  return ("first_touch " + bits.join(" ")).slice(0, 400);
}

function classify(raw, referer) {
  const t = parseTouch(raw, referer);
  const src = String(t.utm_source || "").toLowerCase();
  const med = String(t.utm_medium || "").toLowerCase();
  const camp = String(t.utm_campaign || t.utm_id || "");
  const h = host(t.ref);

  // 1. Paid click ids are the strongest evidence there is.
  if (t.gclid || t.gbraid || t.wbraid) return { source: "Google-Ads", detail: detailOf(t, "click=gclid") };
  if (t.li_fat_id && (src === "linkedin" || h.endsWith("linkedin.com"))) return { source: "LinkedIn", detail: detailOf(t, "click=li_fat_id") };

  // 2. Explicit tags.
  if (src) {
    if (AI_UTM.test(src)) return { source: "AI Search", detail: detailOf(t, `ai=${src}`) };
    const net = SOCIAL_UTM[src];
    if (net && PAID.test(med)) {
      // A paid Meta click that landed on the BASE site, not a sealed funnel. The
      // campaign id says whose account paid for it: 5264... is ours, 1202... is the
      // Creator Army account. Anything else is reported as paid social, not guessed.
      if (net === "facebook" || net === "instagram") {
        if (/^5264/.test(camp)) return { source: "Meta-CAO", detail: detailOf(t, "paid=meta") };
        if (/^1202/.test(camp)) return { source: "Creator Army", detail: detailOf(t, "paid=meta") };
      }
      if (net === "linkedin") return { source: "LinkedIn", detail: detailOf(t, "paid=linkedin") };
      return { source: "Social", detail: detailOf(t, `paid=${net}`) };
    }
    if (net) return { source: "Social", detail: detailOf(t, `network=${net}`) };
    if (med === "email" || med === "newsletter" || src === "email") return { source: "Email", detail: detailOf(t) };
    if (/google|bing/.test(src) && /organic/.test(med)) return { source: "Organic", detail: detailOf(t, `search=${src}`) };
  }

  // 3. The referring site. AI and webmail before search: gemini.google.com and
  //    mail.google.com both match the Google pattern but are not Google search.
  if (h) {
    if (AI.some((re) => re.test(h))) return { source: "AI Search", detail: detailOf(t, `ai=${h}`) };
    if (MAIL.test(h)) return { source: "Email", detail: detailOf(t) };
    const s = SEARCH.find(([re]) => re.test(h));
    if (s) return { source: "Organic", detail: detailOf(t, `search=${s[1]}`) };
    const so = SOCIAL.find(([re]) => re.test(h));
    if (so) return { source: "Social", detail: detailOf(t, `network=${so[1]}`) };
    return { source: "Web Referral", detail: detailOf(t, `site=${h}`) };
  }

  // 4. An fbclid with no referrer and no tags: a Facebook/Instagram link click whose
  //    referrer was stripped by the in-app browser. Our paid Meta goes to the sealed
  //    /cao funnel, so on the base site this is organic social.
  if (t.fbclid) return { source: "Social", detail: detailOf(t, "network=facebook click=fbclid") };

  // 5. A tag we do not recognise is still a tagged link someone shared.
  if (src) return { source: "Web Referral", detail: detailOf(t, `tag=${src}`) };

  return null;
}

module.exports = { classifyFirstTouch: classify };
