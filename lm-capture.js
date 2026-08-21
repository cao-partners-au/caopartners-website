/**
 * lm-capture.js — turn a lead-magnet report into a CRM lead.
 *
 * The five /plan/ pages are GENERATED from Oscar's AIOS vault and his README is
 * explicit: "Edit the config, never the HTML. Every file here is generated, and
 * a regenerate overwrites hand edits without warning." So nothing here lives
 * inside those files. This script is stamped onto them at deploy time by
 * scripts/wire-lead-magnets.mjs, which is re-runnable — Oscar ships new HTML,
 * we re-run the injection, and the wiring survives.
 *
 * THE HOOK. The asset adds `done` to <body> at the moment the report renders:
 *
 *     if(step >= STEP_RESULT){ document.body.classList.add("done"); renderReport(); ... }
 *
 * Its own comment says this is "exactly as on every other asset", so watching
 * that class is stable across all five and across a regenerate. Wrapping an
 * internal function or matching a button label would not be.
 *
 * WHY VALUES ARE BUFFERED. The contact inputs are destroyed when the step
 * changes, so by the time `done` appears there is nothing left to read. A
 * delegated listener records them as they are typed.
 *
 * DEDUPE. The browser Lead and the server Lead share one event_id, so Meta
 * counts one conversion rather than two. Same mechanism as /lead-form.js.
 */
(function () {
  "use strict";

  var ENDPOINT = "/.netlify/functions/form-submit";
  var buf = {};
  var sent = false;

  /* The magnet slug is the folder: /plan/construction/ -> "construction". */
  function magnet() {
    var m = String(location.pathname).match(/\/plan\/([a-z0-9-]+)/i);
    return m ? m[1].toLowerCase() : "unknown";
  }

  function cookie(name) {
    var m = document.cookie.match(new RegExp("(^|;\\s*)" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[2]) : "";
  }

  /* EMAIL AND PHONE ARE BOTH COMPULSORY.
     A report handed over for an email alone leaves a lead nobody can ring, and
     these magnets exist to start conversations. Both are validated here rather
     than by the asset's own markup, because the pages are GENERATED and a
     regenerate would drop any `required` attribute added upstream.
     Kept deliberately loose: the job is to stop blanks and obvious rubbish, not
     to argue with a real person about their own number. */
  function validEmail(v) {
    v = String(v || "").trim();
    return v.indexOf("@") > 0 && v.indexOf(".", v.indexOf("@")) > 0 && !/\s/.test(v);
  }
  function validPhone(v) {
    // Australian mobiles and landlines, however the reader chooses to type them.
    // Also accepts +61 form. 8 digits is the shortest real AU number.
    var digits = String(v || "").replace(/[^0-9]/g, "");
    return digits.length >= 8 && digits.length <= 15;
  }

  /* Are we on the step that asks who they are? */
  function contactInputs() {
    return [].slice.call(document.querySelectorAll("input")).filter(function (el) {
      return el.offsetParent !== null && (el.type === "email" || el.type === "tel");
    });
  }

  function missingFields() {
    var missing = [];
    if (!validEmail(buf.email)) missing.push("a valid email address");
    if (!validPhone(buf.phone)) missing.push("a contact phone number");
    return missing;
  }

  /* Inline, non-blocking message. No alert(): an alert on a mobile ad landing
     page reads as a malfunction and loses the reader outright. */
  function warn(msg) {
    var id = "lm-required-msg";
    var box = document.getElementById(id);
    if (!box) {
      box = document.createElement("div");
      box.id = id;
      box.setAttribute("role", "alert");
      box.style.cssText =
        "margin:14px 0;padding:11px 14px;border-radius:10px;font:400 14px/1.5 inherit;" +
        "background:rgba(220,38,38,.10);border:1px solid rgba(220,38,38,.45);color:#fca5a5;";
      var anchor = contactInputs()[0];
      var host = anchor && anchor.parentNode ? anchor.parentNode : document.body;
      host.appendChild(box);
    }
    box.textContent = msg;
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function clearWarning() {
    var box = document.getElementById("lm-required-msg");
    if (box && box.parentNode) box.parentNode.removeChild(box);
  }

  /* THE GATE. Runs in the capture phase, so it stops the asset's own handler
     before it can advance the step and render the report.

     Keyed on "this step is showing contact inputs" rather than on the button's
     text, because the submit label differs per magnet ("Show me the five
     builds" on construction) and is regenerated upstream. Back and the carousel
     arrows stay clickable so nobody gets trapped on the step. */
  var NAV = /^(back|←|→|‹|›|<|>)$/i;
  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest ? e.target.closest("button,[data-value],a") : null;
    if (!el) return;
    if (!contactInputs().length) return;                 // not the contact step
    if (NAV.test(String(el.textContent || "").trim())) return;

    var missing = missingFields();
    if (!missing.length) { clearWarning(); return; }

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    warn("Please enter " + missing.join(" and ") + " so we can send your report.");
  }, true);

  /* Placeholder is the only stable label on these inputs — they carry no name
     or id. Kept loose so a wording tweak upstream does not silently drop a
     field; anything unrecognised is ignored rather than guessed at. */
  function classify(el) {
    var ph = (el.placeholder || "").toLowerCase();
    if (el.type === "email") return "email";
    if (el.type === "tel") return "phone";
    if (/first/.test(ph)) return "first_name";
    if (/last|surname/.test(ph)) return "last_name";
    if (/business|company/.test(ph)) return "company";
    return null;
  }

  document.addEventListener("input", function (e) {
    var el = e.target;
    if (!el || el.tagName !== "INPUT") return;
    var key = classify(el);
    if (key) buf[key] = String(el.value || "").trim();
  }, true);

  /* The two quiz answers are button choices, not inputs. Record the label of
     whichever option is selected on the way past. */
  /* The asset's headcount bands do not line up with the CRM's, and the CRM
     field is a <select> with a fixed list. Posting "20 to 50" leaves the
     dropdown BLANK — and a rep saving an unrelated edit then writes that blank
     over the real value. Same failure as the "Service Agreement Sent" literal.
     So map to the CRM's band with the largest overlap, and keep the verbatim
     answer in the message so nothing the reader said is lost. */
  var SIZE_MAP = {
    "under 20":      "1-10",
    "20 to 50":      "11-50",
    "50 to 120":     "50-200",
    "120 to 300":    "200-500",
    "more than 300": "500+"
  };

  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest ? e.target.closest("button,[data-value]") : null;
    if (!el) return;
    var t = String(el.textContent || "").trim();
    if (!t || t.length > 40) return;
    if (t.indexOf("$") > -1 || /m\b|million/i.test(t)) { buf.turnover = t; return; }
    var mapped = SIZE_MAP[t.toLowerCase()];
    if (mapped) { buf.company_size = mapped; buf.size_said = t; }
  }, true);


  /* ── BOOK NOW, BELOW THE REPORT ──────────────────────────────────────────
     A build-plan reader used to leave with nothing to do next: the report
     rendered, the lead landed on New Lead, and it sat there until a rep found
     time to ring. That gap is the whole cost of this funnel, and the reader is
     never keener than in the minute they finish reading their own diagnosis.

     BELOW, NOT INSTEAD. The report is what they came for, so the calendar is
     appended after it rather than replacing it the way /audit/ does. Someone
     who has read all five builds is a better prospect than someone who bounced
     at the top, and hijacking the page would cost exactly those readers.

     ATTRIBUTION IS UNAFFECTED. The lead is already written by the time this
     runs; the calendar is a step that happens afterwards. Same order as the
     enquiry forms and /audit/.

     Failing to show it costs nothing: the reader still has their report and the
     rep still has the lead, which is precisely today's behaviour. */
  var CALENDLY = {
    "jonathan@caopartners.com.au": "https://calendly.com/jonathan-caopartners/30min",
    "gulliver@caopartners.com.au": "https://calendly.com/gulliver-caopartners/30min"
  };

  function utmSuffix() {
    var keep = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
    var here = location.search, out = [];
    for (var i = 0; i < keep.length; i++) {
      var m = here.match(new RegExp("[?&]" + keep[i] + "=([^&]+)"));
      if (m) out.push(keep[i] + "=" + m[1]);
    }
    return out.join("&");
  }

  /* Styles are inline because these pages are generated and self-contained:
     borrowing a class from the asset would break the day Oscar renames it. */
  function addBooking(data) {
    try {
      if (document.querySelector("[data-book-now]")) return;
      var base = CALENDLY[String(data.assigned_to || "").toLowerCase()];
      if (!base) return;

      var report = document.getElementById("report") || document.body;
      var first = (data.rep_name || "").split(" ")[0] || "one of our team";
      var qs = "hide_gdpr_banner=1&background_color=04050f&text_color=f8fafc&primary_color=1269ff" +
        "&name=" + encodeURIComponent(((buf.first_name || "") + " " + (buf.last_name || "")).trim()) +
        "&email=" + encodeURIComponent(buf.email || "");
      var utm = utmSuffix();
      if (utm) qs += "&" + utm;

      var box = document.createElement("section");
      box.setAttribute("data-book-now", "");
      box.style.cssText = "max-width:900px;margin:56px auto 72px;padding:0 20px;" +
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";
      box.innerHTML =
        '<div style="border-top:1px solid rgba(255,255,255,.12);padding-top:36px">' +
          '<h2 style="font-size:24px;font-weight:500;margin:0 0 8px;color:#f8fafc;letter-spacing:-.3px">' +
            'Want to walk through this?</h2>' +
          '<p style="margin:0 0 20px;color:rgba(248,250,252,.6);font-size:16px;line-height:1.6">' +
            first + ' can take you through the builds above and where to start. ' +
            'Thirty minutes, no cost. Pick a time that suits.</p>' +
          '<iframe title="Choose a time" loading="lazy" src="' + base + '?' + qs + '" ' +
            'style="width:100%;min-height:700px;border:0;border-radius:12px"></iframe>' +
        '</div>';
      report.parentNode.insertBefore(box, report.nextSibling);

      /* Tell the CRM the moment a time is taken, so the warm outreach cron does
         not email a calendar link to someone who has just used one. */
      window.addEventListener("message", function (e) {
        if (!e.data || e.data.event !== "calendly.event_scheduled") return;
        if (!data.lead_id) return;
        fetch("/.netlify/functions/booking-confirmed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lead_id: data.lead_id })
        }).catch(function () { /* the booking is made; never alarm them */ });
      });
    } catch (err) { /* the report is the promise; a missing calendar is not fatal */ }
  }

  function fire() {
    if (sent) return;                    // the class can be re-added on re-render

    /* NO EMAIL AND PHONE, NO CAPTURE. Last line of defence behind the click
       gate above, for any path that reaches the report without going through a
       click we saw (restored session, keyboard submit, upstream markup change).
       `done` means the report rendered, which is not the same as the reader
       having identified themselves. Meta's ad-review crawler executes the page
       and clicks through, and a real visitor can abandon after question one, so
       without this guard both produce a cao_Leads row with an empty name and
       email AND a browser+server Lead conversion. Verified on 18 Aug 2026: an
       ad-review hit on /plan/trades/ created exactly that, two seconds before
       the end-to-end test row. Junk leads are the visible cost; the worse one
       is that false conversions teach the pixel to optimise toward bots.
       Deliberately does NOT set `sent`, so a genuine submission moments later
       still captures. */
    if (missingFields().length) return;

    sent = true;

    var eventId = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : String(Date.now()) + "-" + Math.random().toString(16).slice(2);

    /* Browser Lead. The server sends the matching one from form-submit.js with
       the SAME event_id, and Meta collapses the pair. */
    try {
      if (typeof window.fbq === "function") {
        window.fbq("track", "Lead", { content_name: "ai-build-plan:" + magnet() }, { eventID: eventId });
      }
    } catch (err) { /* tracking must never block the capture */ }

    var fd = new FormData();
    fd.append("form-name", "enquire");
    fd.append("first_name", buf.first_name || "");
    fd.append("last_name", buf.last_name || "");
    fd.append("email", buf.email || "");
    fd.append("phone", buf.phone || "");
    fd.append("company", buf.company || "");
    fd.append("company_size", buf.company_size || "");
    /* lead_source is what routes this to the CAO dataset in form-submit.js and
       what the CRM reports on. It is the same in-house Meta channel as the
       enquiry form, so it stays Meta-CAO; the magnet goes in the detail. */
    fd.append("lead_source", "Meta-CAO");
    fd.append("lead_source_detail", "magnet=" + magnet() + " turnover=" + (buf.turnover || "?") + " ref=" + location.href);
    fd.append("message",
      "Requested the " + magnet().replace(/-/g, " ") + " AI build plan.\n" +
      "Headcount: " + (buf.size_said || "not given") + "\n" +
      "Turnover: " + (buf.turnover || "not given"));
    fd.append("fb_event_id", eventId);
    fd.append("fb_fbc", cookie("_fbc"));
    fd.append("fb_fbp", cookie("_fbp"));
    fd.append("fb_source_url", location.href);

    // Ask for the assigned rep back so the calendar below the report is theirs.
    fd.append("respond", "json");

    fetch(ENDPOINT, { method: "POST", body: fd })
      .then(function (r) { return r.json().catch(function () { return null; }); })
      .then(function (data) { if (data && data.ok) addBooking(data); })
      .catch(function () { /* the reader already has their report; never alarm them */ });
  }

  /* Watch <body class> for `done`. */
  function watch() {
    if (document.body.classList.contains("done")) { fire(); return; }
    new MutationObserver(function () {
      if (document.body.classList.contains("done")) fire();
    }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", watch);
  } else {
    watch();
  }
})();
