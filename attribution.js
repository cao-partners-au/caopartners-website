/* CAO Partners: first-touch attribution.
 *
 * WHY. The form function can only see the referrer of the FORM PAGE, which is
 * nearly always our own homepage: the visitor came from Google/LinkedIn/ChatGPT
 * to the homepage, then clicked through to the form. The real origin was lost one
 * page earlier, so those leads landed in the CRM as "Direct / Unattributed".
 *
 * WHAT. On every page view this remembers where the visitor FIRST came from (the
 * external referrer, the landing page, UTMs and ad click ids) for 90 days, and puts
 * it in a hidden `first_touch` field on every form on the page. form-submit.js
 * turns it into a channel only when the funnel has not already declared one, so
 * the sealed ad funnels (/tt, /cao, /li) and the ?src landing pages are untouched.
 *
 * RULES.
 *  - First touch wins, with one exception: a stored touch that is plain direct
 *    (no referrer, no campaign) is replaced by a later visit that does carry a
 *    source. "Direct" is the absence of evidence, not a channel to protect.
 *  - Internal navigation (our own domain as referrer) is never a touch.
 *  - Nothing personal is stored: a referrer origin+path, our own landing path,
 *    campaign tags and click ids. No cookies are set; storage failures are ignored.
 */
(function () {
  'use strict';

  var KEY = 'cao_ft';
  var TTL = 90 * 864e5;
  var PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
    'gclid', 'gbraid', 'wbraid', 'fbclid', 'li_fat_id', 'ttclid', 'msclkid'];

  function own(host) {
    return /(^|\.)caopartners\.com\.au$/i.test(host || '');
  }

  function current() {
    var t = { ts: Date.now(), land: (location.pathname || '/').slice(0, 120) };
    try {
      var q = new URLSearchParams(location.search);
      PARAMS.forEach(function (k) {
        var v = q.get(k);
        if (v) t[k] = v.slice(0, 120);
      });
    } catch (e) {}
    try {
      if (document.referrer) {
        var r = new URL(document.referrer);
        if (!own(r.hostname)) t.ref = (r.origin + r.pathname).slice(0, 160);
        else t.internal = true;
      }
    } catch (e) {}
    return t;
  }

  function hasSignal(t) {
    if (!t) return false;
    if (t.ref) return true;
    for (var i = 0; i < PARAMS.length; i++) if (t[PARAMS[i]]) return true;
    return false;
  }

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && s.ts && Date.now() - s.ts < TTL) return s;
    } catch (e) {}
    return null;
  }

  function save(t) {
    try { localStorage.setItem(KEY, JSON.stringify(t)); } catch (e) {}
  }

  var now = current();
  var stored = load();
  var touch = stored;
  if (!stored) {
    // A first page view reached by internal navigation means storage was cleared
    // or blocked mid-visit: we genuinely do not know the origin, so record nothing
    // rather than invent "direct".
    if (!now.internal || hasSignal(now)) { delete now.internal; touch = now; save(touch); }
  } else if (!hasSignal(stored) && hasSignal(now)) {
    delete now.internal;
    touch = now;
    save(touch);
  }

  if (!touch) return;
  var value = JSON.stringify(touch);

  function stamp(form) {
    var field = form.querySelector('input[name="first_touch"]');
    if (!field) {
      field = document.createElement('input');
      field.type = 'hidden';
      field.name = 'first_touch';
      form.appendChild(field);
    }
    field.value = value;
  }

  function stampAll() {
    Array.prototype.forEach.call(document.querySelectorAll('form'), stamp);
  }

  stampAll();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', stampAll);
  // Belt and braces for forms rendered after load: stamp on submit, in the capture
  // phase so it runs before any bubbling handler builds its FormData.
  document.addEventListener('submit', function (e) { if (e.target && e.target.tagName === 'FORM') stamp(e.target); }, true);
})();
