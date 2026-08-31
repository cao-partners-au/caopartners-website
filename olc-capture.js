/**
 * olc-capture.js — intake for the One Life Club co-branded Free AI Audit (/olc/).
 *
 * SIBLING OF audit-capture.js, AND DELIBERATELY NOT THE SAME FILE. Two reasons:
 *
 *  1. NO PIXEL. This funnel is dropped into the One Life Club community, not
 *     bought through an ad. There is no ad click to attribute, so there is no
 *     browser Lead event and no fb_* fields. lead_source "OLC" also keeps the
 *     server quiet: form-submit fires a Meta/TikTok event only for the channels
 *     that own one, and OLC is excluded there explicitly.
 *
 *  2. IT EXISTS AT ALL. As Oscar shipped it the page transmitted NOTHING. The
 *     size, turnover, phone and company answers were held in memory and dropped
 *     on the floor; only a name and an email reached Calendly, inside the iframe
 *     URL. A member could complete the whole thing and leave no record anywhere,
 *     which is the opposite of an intake. This is what makes it one.
 *
 * The asset's own rep pick is a coin flip (Math.random over two Calendly URLs),
 * which ignores cao_RoundRobin and would drift from the CRM. We post first, ask
 * for the assigned rep back, and repoint the calendar at whoever the rota named.
 */
(function () {
  "use strict";

  var ENDPOINT = "/.netlify/functions/form-submit";
  var MAGNET = "olc-ai-audit";
  var buf = {};
  var sent = false;


  /* The contact inputs are destroyed the moment the calendar replaces them, so
     values are recorded as they are typed rather than read at conversion. */
  var FIELDS = {
    first_name: "first_name", last_name: "last_name",
    email: "email", phone: "phone", company: "company",
  };
  document.addEventListener("input", function (e) {
    var el = e.target;
    if (!el || el.tagName !== "INPUT") return;
    var key = FIELDS[el.name] ||
      (el.type === "email" ? "email" : el.type === "tel" ? "phone" : null);
    if (key) buf[key] = String(el.value || "").trim();
  }, true);

  /* The three qualifying answers are button choices. Record the label of
     whichever was pressed; the questions are size, turnover and one other, so
     the values are bucketed the same way the /plan/ magnets bucket them. */
  var SIZE_MAP = {
    "under 20": "1-10", "20 to 50": "11-50", "50 to 120": "50-200",
    "120 to 300": "200-500", "more than 300": "500+",
  };
  var answers = [];
  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest ? e.target.closest("button,[data-value]") : null;
    if (!el) return;
    var t = String(el.textContent || "").trim();
    if (!t || t.length > 48) return;
    if (/^(back|next|continue|opening the calendar)/i.test(t)) return;
    var mapped = SIZE_MAP[t.toLowerCase()];
    if (mapped) { buf.company_size = mapped; buf.size_said = t; }
    else if (t.indexOf("$") > -1 || /m\b|million/i.test(t)) buf.turnover = t;
    if (answers.indexOf(t) < 0) answers.push(t);
  }, true);

  /* ONE PICKER, NOT TWO.
     The asset chooses which rep's Calendly to embed with
     Math.random() over BOOKING_URLS, while the CRM assigns the owner from
     cao_RoundRobin in form-submit.js. Two independent pickers agree about half
     the time, so a lead could sit with Gulliver while the meeting sat in
     Jonathan's calendar, and a coin flip also drifts away from an even split at
     the volumes this funnel runs at.
     So the round robin decides and the iframe is repointed at whoever it named.
     The swap happens within a second of the calendar appearing, while Calendly
     is still loading, so the reader sees one calendar rather than a change. If
     the call fails or names a rep we have no link for, the asset's own choice
     stands: a booking with the wrong rep beats no booking at all. */
  var CALENDLY = {
    "jonathan@caopartners.com.au": "https://calendly.com/jonathan-caopartners/30min",
    "gulliver@caopartners.com.au": "https://calendly.com/gulliver-caopartners/30min",
  };

  /* Attribution passthrough into the booking.
     Calendly returns a `tracking` block (utm_source, utm_campaign, utm_content
     ...) on every invitee, and it is null unless the booking URL carries them.
     Forwarding the ad's own UTMs means the BOOKING carries the ad id too, so a
     booking can be tied back to the creative even though the lead was already
     captured a step earlier. Cheap, and it makes the two records agree. */
  function utmSuffix() {
    var here = new URLSearchParams(location.search);
    var keep = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
    var add = [];
    for (var i = 0; i < keep.length; i++) {
      var v = here.get(keep[i]);
      if (v) add.push(keep[i] + "=" + encodeURIComponent(v));
    }
    return add.join("&");
  }

  /* Rebuild the iframe URL: the assigned rep's calendar if we know it, keeping
     the asset's own display settings and prefilled name/email. */
  function pointCalendar(box, repEmail) {
    try {
      var iframe = box.querySelector("iframe");
      if (!iframe || iframe.dataset.wired) return;
      var src = iframe.src;
      var base = CALENDLY[String(repEmail || "").toLowerCase()];
      if (base) {
        var q = src.indexOf("?");
        src = base + (q > -1 ? src.slice(q) : "");
      }
      var utm = utmSuffix();
      if (utm) src += (src.indexOf("?") > -1 ? "&" : "?") + utm;
      iframe.dataset.wired = "1";
      if (src !== iframe.src) iframe.src = src;
    } catch (err) { /* attribution must never cost a booking */ }
  }

  function fire(box) {
    if (sent) return;
    /* The asset only reaches this state after its own validation passes, but
       check anyway: a capture without an email is a row nobody can act on. */
    var email = String(buf.email || "").trim();
    if (email.indexOf("@") < 1) return;
    sent = true;

    var fd = new FormData();
    fd.append("form-name", "enquire");
    fd.append("first_name", buf.first_name || "");
    fd.append("last_name", buf.last_name || "");
    fd.append("email", email);
    fd.append("phone", buf.phone || "");
    fd.append("company", buf.company || "");
    fd.append("company_size", buf.company_size || "");
    fd.append("lead_source", "OLC");
    fd.append("lead_source_detail",
      "magnet=" + MAGNET + " turnover=" + (buf.turnover || "?") + " ref=" + location.href);
    fd.append("message",
      "One Life Club member requested a free AI audit.\n" +
      "Headcount: " + (buf.size_said || "not given") + "\n" +
      "Turnover: " + (buf.turnover || "not given") + "\n" +
      "Answers: " + (answers.join(" | ") || "none recorded") + "\n" +
      /* The capture fires when the calendar OPENS, not when a time is taken, so
         this row alone does not mean a meeting exists. It does not need a rep to
         go and check, though: cao-crm-pipeline-advancer runs hourly, matches
         Calendly invitee emails to cao_Leads and moves the card to Discovery
         Booked, counting active invitees only. So the board answers it. Say
         where to look rather than asking for manual work nobody will do. */
      "NOTE: this fires when the calendar opens, not when a time is taken. " +
      "If they booked, the card moves itself to Discovery Booked within the hour. " +
      "Still on New Lead after that means they did not pick a time, so it is worth a call.");
    /* Ask for the assigned rep back rather than the usual 302, so the calendar
       can be pointed at whoever the round robin named. */
    fd.append("respond", "json");

    fetch(ENDPOINT, { method: "POST", body: fd })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { pointCalendar(box, j && j.assigned_to); })
      .catch(function () { pointCalendar(box, null); });

    /* Belt and braces: if the round trip is slow, the UTMs still get on within
       a moment and the asset's own rep choice stands. */
    setTimeout(function () { pointCalendar(box, null); }, 4000);
  }

  /* Watch for the calendar replacing the form. The asset rewrites #app wholesale,
     so observe the subtree rather than one node. */
  function watch() {
    var found = document.querySelector("[data-calendar]");
    if (found) { fire(found); return; }
    new MutationObserver(function () {
      var box = document.querySelector("[data-calendar]");
      if (box) fire(box);
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", watch);
  } else {
    watch();
  }
})();
