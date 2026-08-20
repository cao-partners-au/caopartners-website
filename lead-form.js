/* CAO Partners — direct lead form tracking */
(function () {
  'use strict';

  var forms = document.querySelectorAll('form[name="enquire"], form[name="talent"]');

  forms.forEach(function (form) {
    form.addEventListener('submit', function () {
      var button = form.querySelector('button[type="submit"]');
      if (button && !button.disabled) {
        button.disabled = true;
        button.dataset.label = button.textContent;
        button.textContent = 'Sending...';
      }
    });
  });

  function readCookie(name) {
    var match = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return match ? match.pop() : '';
  }

  /* ── Landing-page attribution (organic + Google Ads) ─────────────────────
     Landing pages link to the standard form with ?src=<slug>. We stash the slug
     in a cookie on the landing page so it survives the hop to the form, then
     stamp it onto the submission. Deliberately NOT a cloned form/pixel: the
     sealed funnels (/tt, /cao) exist to isolate PAID PIXEL datasets, and these
     pages carry no pixel of their own.

     The SAME pages serve organic search AND Google Ads traffic, so the slug also
     decides the channel: a `gads-` prefix means the visit was paid. Without this
     every paid lead would be filed as "Organic" and the channels would be
     indistinguishable in the CRM — the whole point of attribution.
     Never overrides a hardcoded lead_source (the /tt and /cao ad funnels). */
  var SRC_COOKIE = 'cao_src';
  var GADS_PREFIX = 'gads-';

  function sourceFor(slug) {
    return slug.indexOf(GADS_PREFIX) === 0 ? 'Google-Ads' : 'Organic';
  }

  function stashSrc() {
    try {
      var m = window.location.search.match(/[?&]src=([A-Za-z0-9_-]{1,64})(?:&|$)/);
      if (!m) return;
      var incoming = m[1];
      // PAID WINS. A visitor from a Google ad lands on e.g.
      // /ai-recruitment-australia?src=gads-ai-recruitment, but that page's own CTA
      // links to /hire/form?src=ai-recruitment-australia — so without this guard the
      // second hop would overwrite the paid slug and file the lead as Organic.
      var existing = readCookie(SRC_COOKIE);
      if (existing && existing.indexOf(GADS_PREFIX) === 0 && incoming.indexOf(GADS_PREFIX) !== 0) return;
      document.cookie = SRC_COOKIE + '=' + incoming + ';path=/;max-age=2592000;samesite=lax';
    } catch (e) {}
  }
  stashSrc();

  function genId() {
    try {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    } catch (e) {}
    return 'e' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function deriveFbc(existing) {
    if (existing) return existing;
    var match = window.location.search.match(/[?&]fbclid=([^&]+)/);
    return match ? 'fb.1.' + Date.now() + '.' + decodeURIComponent(match[1]) : '';
  }

  /* ── BOOK NOW ────────────────────────────────────────────────────────────
     A keen prospect should be able to take a time immediately rather than wait
     to be chased, but NOT at the cost of the lead record.

     ORDER IS EVERYTHING, AND IT PROTECTS ATTRIBUTION. The submission is posted
     first and the lead is created with its full attribution (lead_source, the
     ?src slug, fb_fbc, UTMs) before any calendar appears. Calendly is never in
     the attribution path, it is something that happens AFTER the lead exists.
     Someone who opens the calendar and abandons still leaves an attributed lead
     with a phone number, which is strictly better than today, where they leave
     with nothing.

     FAILS BACK TO THE OLD BEHAVIOUR. If the fetch throws, the response is not
     JSON, or the insert did not happen, the form is submitted natively exactly
     as it always was and the visitor lands on /success. Losing a lead to a
     clever booking flow would be a far worse trade than losing the booking. */
  var CALENDLY = {
    'jonathan@caopartners.com.au': 'https://calendly.com/jonathan-caopartners/30min',
    'gulliver@caopartners.com.au': 'https://calendly.com/gulliver-caopartners/30min'
  };

  function fieldValue(form, name) {
    var el = form.querySelector('[name="' + name + '"]');
    return el ? String(el.value || '').trim() : '';
  }

  /* Forward the ad UTMs into the booking. Calendly returns them on the invitee,
     so the booking record names the same campaign the lead does. */
  function utmSuffix() {
    var keep = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
    var here = window.location.search;
    var out = [];
    keep.forEach(function (k) {
      var m = here.match(new RegExp('[?&]' + k + '=([^&]+)'));
      if (m) out.push(k + '=' + m[1]);
    });
    return out.join('&');
  }

  function showCalendar(form, data) {
    var base = CALENDLY[String(data.assigned_to || '').toLowerCase()];
    if (!base) return false;   // unknown rep: nothing safe to show

    var first = fieldValue(form, 'first_name');
    var last = fieldValue(form, 'last_name');
    var name = (first + ' ' + last).trim() || fieldValue(form, 'name');
    var qs = 'hide_gdpr_banner=1&primary_color=1269ff' +
      '&name=' + encodeURIComponent(name) +
      '&email=' + encodeURIComponent(fieldValue(form, 'email'));
    var utm = utmSuffix();
    if (utm) qs += '&' + utm;

    var box = document.createElement('div');
    box.className = 'book-now';
    box.setAttribute('data-book-now', '');
    box.innerHTML =
      '<p class="book-now-lede"><strong>Got it, we have your details.</strong> ' +
      (data.rep_name ? data.rep_name.split(' ')[0] + ' will be in touch.' : 'We will be in touch.') +
      ' If you would rather not wait, pick a time now.</p>' +
      '<iframe title="Choose a time" loading="eager" src="' + base + '?' + qs + '"></iframe>' +
      '<p class="book-now-note"><a href="/success?t=enquire">No thanks, I will wait to be contacted</a></p>';

    form.parentNode.replaceChild(box, form);
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });

    /* Calendly posts a message to the parent when a time is taken. Telling the
       CRM straight away is what stops the warm outreach cron emailing this
       person a calendar link they have already used. */
    window.addEventListener('message', function (e) {
      if (!e.data || typeof e.data.event !== 'string') return;
      if (e.data.event !== 'calendly.event_scheduled') return;
      if (!data.lead_id) return;
      fetch('/.netlify/functions/booking-confirmed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: data.lead_id })
      }).catch(function () { /* the booking is already made; never alarm them */ });
    });
    return true;
  }

  forms.forEach(function (form) {
    form.addEventListener('submit', function (ev) {
      var eventId = genId();
      var setField = function (name, value) {
        var field = form.querySelector('input[name="' + name + '"]');
        if (field) field.value = value || '';
      };

      setField('fb_event_id', eventId);
      setField('fb_fbp', readCookie('_fbp'));
      setField('fb_fbc', deriveFbc(readCookie('_fbc')));
      setField('fb_source_url', window.location.href);

      // Stamp organic attribution only when the page hasn't already declared a
      // channel (the sealed TikTok / Meta-CAO forms hardcode lead_source).
      var srcField = form.querySelector('input[name="lead_source"]');
      var src = readCookie(SRC_COOKIE);
      if (srcField && !srcField.value && src) {
        srcField.value = sourceFor(src);
        setField('lead_source_detail', src);
      }

      // No client-side fbq('track','Lead') here on purpose: it used to fire on every
      // click, before the server validated the submission, so spam/duplicate/rejected
      // attempts were counted as Leads in Meta even though they never reached the CRM.
      // CAPI (form-submit.js) now fires the sole Lead event, gated on a real DB insert,
      // and already carries strong PII match keys (hashed email/phone) — no browser
      // pixel needed for match quality.

      // Book Now only applies to the client enquiry form. Candidate submissions
      // go to a different lane with a different calendar, so they keep the
      // native post untouched.
      if (form.getAttribute('name') !== 'enquire' || !form.hasAttribute('data-book-now-enabled')) return;

      ev.preventDefault();
      var fd = new FormData(form);
      fd.append('respond', 'json');

      /* THE TURNSTILE TOKEN IS SINGLE USE, and this is the whole reason the two
         failure paths differ.

         If the request never reached the server (offline, DNS, CORS), the token
         is untouched, so submitting natively is safe and the visitor gets the
         behaviour they always had.

         If the server DID answer, that token is spent. Resubmitting natively
         would be rejected as a replay, and if the first attempt actually
         inserted, it would risk a duplicate. So we never resubmit after a
         reply: we send them to the normal thank-you page, which is exactly
         where the old flow put them anyway. */
      var resubmitNatively = function () {
        form.removeAttribute('data-book-now-enabled');   // bypass this listener
        form.submit();
      };
      var thankYou = function () { window.location.href = '/success?t=enquire'; };

      fetch(form.getAttribute('action'), { method: 'POST', body: fd })
        .then(function (r) {
          return r.json().catch(function () { return null; });   // 302/HTML -> null
        })
        .then(function (data) {
          // Server answered. Token is spent either way, so never resubmit here.
          if (!data || !data.ok) { thankYou(); return; }
          if (!showCalendar(form, data)) thankYou();
        })
        .catch(function () {
          // Never reached the server: the token is still good.
          resubmitNatively();
        });
    });
  });
})();
