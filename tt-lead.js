/* CAO Partners — TikTok /tt funnel tracking.
 *
 * Loads on BOTH sealed TikTok funnels:
 *   CLIENT    /hire/tt,   /hire/form/tt    -> form[name="enquire"], fires Lead
 *   CANDIDATE /become/tt, /become/form/tt  -> form[name="talent"],  fires CompleteRegistration
 *
 * Two jobs:
 *   1. Persist the TikTok click id (ttclid) from the landing URL into a first-party
 *      cookie, so it survives a hub -> form navigation and is still available at
 *      submit time for server-side Events API attribution.
 *   2. On form submit, generate one event_id, stamp it (+ ttclid + the _ttp cookie)
 *      into hidden fields for the server, and fire the browser conversion event with
 *      that SAME event_id so the pixel event and the server Events API event
 *      deduplicate. Mirrors how lead-form.js does it for Meta.
 *
 * The two funnels fire DIFFERENT conversion events on the same pixel deliberately:
 * each campaign then optimises on its own event, so the candidate campaign never
 * trains on client enquiries (and vice versa).
 *
 * The base site's Meta pixel is intentionally NOT present on these pages, so this
 * only ever touches ttq — never fbq.
 */
(function () {
  'use strict';

  // Which funnel are we on? Path-based, so it also works on the hub pages where
  // there is no form to inspect.
  var IS_CANDIDATE = window.location.pathname.indexOf('/become/') === 0;
  var CONTENT_NAME = IS_CANDIDATE ? 'Become a CAO' : 'Hire a CAO';
  var CONVERSION_EVENT = IS_CANDIDATE ? 'CompleteRegistration' : 'Lead';

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

  // 2. Fire ViewContent on every /tt page view (hub + form) as a mid-funnel
  //    signal the algorithm can optimise on before the rarer conversion.
  //    Browser-only: no server-side ViewContent, so no event_id dedup needed.
  try {
    if (window.ttq) {
      ttq.track('ViewContent', { contents: [{ content_name: CONTENT_NAME }] });
    }
  } catch (e) {}

  // 3. Form submit handler (only the form page has a form). Matches whichever
  //    funnel's form is present — enquire (client) or talent (candidate).
  var form = document.querySelector('form[name="enquire"], form[name="talent"]');
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
        ttq.track(CONVERSION_EVENT, { contents: [{ content_name: CONTENT_NAME }] }, { event_id: eventId });
      }
    } catch (e) {}
  });
})();
