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

  forms.forEach(function (form) {
    var contentName = form.getAttribute('name') === 'talent' ? 'talent' : 'enquire';
    form.addEventListener('submit', function () {
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

      try {
        if (window.fbq) {
          fbq('track', 'Lead', { content_name: contentName }, { eventID: eventId });
        }
      } catch (e) {}
    });
  });
})();
