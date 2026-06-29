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

      try {
        if (window.fbq) {
          fbq('track', 'Lead', { content_name: contentName }, { eventID: eventId });
        }
      } catch (e) {}
    });
  });
})();
