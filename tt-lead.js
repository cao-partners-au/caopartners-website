/* CAO Partners — TikTok /tt funnel tracking.
 *
 * Loads only on the TikTok funnel pages (/hire/tt, /hire/form/tt). Two jobs:
 *   1. Persist the TikTok click id (ttclid) from the landing URL into a first-party
 *      cookie, so it survives a /hire/tt -> /hire/form/tt navigation and is still
 *      available at submit time for server-side Events API attribution.
 *   2. On the enquire form submit, generate one event_id, stamp it (+ ttclid + the
 *      _ttp cookie) into hidden fields for the server, and fire the browser Lead
 *      event with that SAME event_id so the pixel event and the server Events API
 *      event deduplicate. Mirrors how lead-form.js does it for Meta.
 *
 * The base site's Meta pixel is intentionally NOT present on these pages, so this
 * only ever touches ttq — never fbq.
 */
(function () {
  'use strict';

  function readCookie(name) {
    var m = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return m ? m.pop() : '';
  }
  function setCookie(name, value) {
    if (!value) return;
    document.cookie = name + '=' + encodeURIComponent(value) +
      ';path=/;max-age=' + (30 * 24 * 60 * 60) + ';SameSite=Lax';
  }
  function genId() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return 'e' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  // 1. Capture the click id from the landing URL and persist it (hub -> form).
  var m = window.location.search.match(/[?&]ttclid=([^&]+)/);
  if (m) setCookie('cao_ttclid', decodeURIComponent(m[1]));

  // 2. Form submit handler (only the form page has a form).
  var form = document.querySelector('form[name="enquire"]');
  if (!form) return;

  form.addEventListener('submit', function () {
    var eventId = genId();
    var set = function (name, value) {
      var f = form.querySelector('input[name="' + name + '"]');
      if (f) f.value = value || '';
    };
    set('tt_event_id', eventId);
    set('ttclid', readCookie('cao_ttclid'));
    set('ttp', readCookie('_ttp'));
    try {
      if (window.ttq) {
        ttq.track('Lead', { contents: [{ content_name: 'Hire a CAO' }] }, { event_id: eventId });
      }
    } catch (e) {}
  });
})();
