/**
 * CAO Partners website chat.
 *
 * Stamped onto every page by scripts/wire-chat-widget.mjs. Talks only to the chat
 * service named in data-chat-base (https://chat.caopartners.com.au), which is its
 * own locked-down service: it can start and continue a visitor's own conversation
 * and nothing else.
 *
 * PUBLIC SWITCH. Nothing renders until the chat service says so (GET status ->
 * mode): off renders nothing; test renders only in browsers flagged by opening any
 * page with ?chat=test (?chat=off clears the flag); live renders for everyone.
 *
 * Flow:
 *   1. The visitor picks Hire or Become (Become is pre-selected on /become pages).
 *   2. During live chat hours (9am to 5pm AEST, Monday to Friday; the green LED is on): name, email, phone (both required), first message, then live
 *      chat. If nobody has replied after the service's no-reply window, the widget
 *      offers the call-back form so the enquiry is never lost.
 *   3. After hours: the call-back form straight away.
 *
 * The conversation id and token live in localStorage so the chat follows the
 * visitor across pages. Everything a visitor or rep types is rendered with
 * textContent, never as HTML. Shadow DOM keeps the site's CSS and the widget's
 * apart.
 */
(function () {
  "use strict";
  if (window.__caoChatLoaded) return;
  window.__caoChatLoaded = true;

  var script = document.currentScript;
  var BASE = ((script && script.getAttribute("data-chat-base")) || "https://chat.caopartners.com.au").replace(/\/$/, "");
  // The site's own logo (black artwork), drawn white on the dark panel as the plan pages do.
  // Lazy inside the hidden panel, so it only downloads when a visitor opens the chat; absolute
  // so it still resolves on pages served from another path or subdomain.
  var LOGO_URL = "https://caopartners.com.au/logo.svg";
  // Live chat hours, as the chat service reports them (lib/cao/chat/config.ts CHAT_HOURS_LABEL).
  var HOURS_FALLBACK = "9am to 5pm AEST, Monday to Friday";
  function hoursText() { return (status && status.hours) || HOURS_FALLBACK; }
  var STORE_KEY = "cao_chat_v1";
  var POLL_OPEN_MS = 4000;
  var POLL_CLOSED_MS = 20000;

  var state = load() || {};
  var status = null;          // { open, nextOpen, noReplySeconds }
  var panelOpen = false;
  var pollTimer = null;
  var seen = {};              // message id -> true
  var lastAt = null;          // ISO time of the newest message rendered
  var firstVisitorText = "";
  var latest = null;          // last poll response
  var view = "";

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { return null; }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* private mode: chat still works for this page */ }
  }
  function forget() {
    state = {};
    seen = {};
    lastAt = null;
    firstVisitorText = "";
    latest = null;
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
  }

  function defaultType() {
    return /^\/(become|join-our-team)/.test(location.pathname) ? "become" : "hire";
  }

  function api(path, body) {
    var opts = body === undefined
      ? { method: "GET", credentials: "omit" }
      : { method: "POST", credentials: "omit", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
    return fetch(BASE + "/api/public/chat/" + path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        json.httpStatus = res.status;
        return json;
      });
    }, function () {
      return { ok: false, error: "network", httpStatus: 0 };
    });
  }

  // ---- DOM helpers --------------------------------------------------------
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "text") node.textContent = v;
        else if (k === "onclick") node.addEventListener("click", v);
        else if (k === "onsubmit") node.addEventListener("submit", v);
        else node.setAttribute(k, v === true ? "" : v);
      });
    }
    (children || []).forEach(function (c) { if (c) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return node;
  }

  function field(label, input) {
    return el("label", { class: "field" }, [el("span", { text: label }), input]);
  }

  function honeypot() {
    return el("input", { type: "text", name: "website", tabindex: "-1", autocomplete: "off", "aria-hidden": "true", class: "hp" });
  }

  // ---- shell --------------------------------------------------------------
  var host = el("div", { id: "cao-chat" });
  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
  var style = el("style", { text: CSS() });
  var launcher = el("button", { class: "launcher", type: "button", "aria-label": "Chat with CAO Partners", "aria-expanded": "false" }, [
    el("span", { class: "icon", "aria-hidden": "true", text: "\u2709" }),
    el("span", { class: "live", "aria-hidden": "true" }),
    el("span", { class: "label", text: "Chat with us" }),
    el("span", { class: "dot", "aria-hidden": "true" })
  ]);
  var titleLine = el("div", { class: "sub", text: "" });
  var closeBtn = el("button", { class: "close", type: "button", "aria-label": "Close chat", text: "\u00d7" });
  var body = el("div", { class: "body" });
  var panel = el("section", { class: "panel", role: "dialog", "aria-label": "CAO Partners chat", hidden: true }, [
    el("header", {}, [el("div", {}, [el("img", { class: "logo", src: LOGO_URL, alt: "CAO Partners", loading: "lazy", decoding: "async" }), titleLine]), closeBtn]),
    body
  ]);
  root.appendChild(style);
  root.appendChild(panel);
  root.appendChild(launcher);

  // While the panel is closed and the call-back offer is due, the bubble says so.
  function setNudge(on) {
    var label = launcher.querySelector(".label");
    launcher.classList.toggle("unread", on || launcher.classList.contains("unread"));
    launcher.classList.toggle("nudge", on);
    if (label) label.textContent = on ? "Leave your details" : "Chat with us";
  }

  launcher.addEventListener("click", function () { panelOpen ? closePanel() : openPanel(); });
  closeBtn.addEventListener("click", closePanel);
  panel.addEventListener("keydown", function (e) { if (e.key === "Escape") closePanel(); });

  var TESTER_KEY = "cao_chat_tester";
  function testerFlag() {
    try {
      var q = new URLSearchParams(location.search).get("chat");
      if (q === "test") localStorage.setItem(TESTER_KEY, "1");
      if (q === "off") localStorage.removeItem(TESTER_KEY);
      return localStorage.getItem(TESTER_KEY) === "1";
    } catch (e) {
      return /[?&]chat=test\b/.test(location.search);
    }
  }
  var isTester = testerFlag();

  function mount() {
    if (!document.body) return setTimeout(mount, 50);
    refreshStatus().then(function (s) {
      var mode = s && s.mode;
      var visible = mode === "live" || (mode === "test" && isTester);
      if (!visible) return; // off, unreachable, or not a tester: render nothing at all
      if (mode === "test") launcher.classList.add("testing");
      document.body.appendChild(host);
      if (state.conversationId) schedulePoll(1500);
      // Re-check the hours every 5 minutes so the LED and wording change at 9am and 5pm on an open page.
      setInterval(function () { if (!document.hidden) refreshStatus(); }, 5 * 60 * 1000);
    });
  }
  mount();

  function openPanel() {
    panelOpen = true;
    panel.hidden = false;
    launcher.setAttribute("aria-expanded", "true");
    launcher.classList.remove("unread");
    setNudge(false);
    launcher.classList.remove("unread");
    host.classList.add("is-open");
    if (state.conversationId) {
      showChat();
      poll();
    } else {
      showLoading();
      refreshStatus().then(showChoose);
    }
  }

  function closePanel() {
    panelOpen = false;
    panel.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
    host.classList.remove("is-open");
    launcher.focus();
    schedulePoll(POLL_CLOSED_MS);
  }

  function refreshStatus() {
    return api("status").then(function (s) {
      if (s && s.ok) status = s;
      else status = status || { mode: "off", open: false, nextOpen: "soon", noReplySeconds: 180, unavailable: true };
      setSubtitle();
      return status;
    });
  }

  function setSubtitle() {
    // The green LED on the bubble means a person can reply now: live chat hours, switch on.
    launcher.classList.toggle("online", !!(status && status.open));
    launcher.setAttribute("aria-label", status && status.open ? "Chat with CAO Partners, we're online" : "Chat with CAO Partners");
    if (!status) { titleLine.textContent = ""; return; }
    titleLine.textContent = status.open
      ? "We're online. Replies usually take a few minutes."
      : (status.holiday ? "We're closed for " + status.holiday : "We're offline") + ". Live chat runs " + hoursText() + ".";
  }

  function setBody(name, nodes, focusSelector) {
    view = name;
    body.textContent = "";
    nodes.forEach(function (n) { body.appendChild(n); });
    var f = focusSelector && body.querySelector(focusSelector);
    if (f) setTimeout(function () { f.focus(); }, 30);
  }

  function showLoading() {
    setBody("loading", [el("p", { class: "muted", text: "Loading..." })]);
  }

  function errorLine(text) {
    return el("p", { class: "error", role: "alert", text: text });
  }

  // ---- step 1: hire or become ---------------------------------------------
  function showChoose() {
    var pre = defaultType();
    function pick(type) {
      state.enquiryType = type;
      if (status && status.open) showStartForm();
      else showCaptureForm("after_hours");
    }
    setBody("choose", [
      el("p", { class: "lead", text: "Hi! What can we help you with?" }),
      el("button", { type: "button", class: "choice" + (pre === "hire" ? " primary" : ""), onclick: function () { pick("hire"); } }, [
        el("strong", { text: "I want to hire a Chief Agent Officer" }),
        el("span", { text: "For my business" })
      ]),
      el("button", { type: "button", class: "choice" + (pre === "become" ? " primary" : ""), onclick: function () { pick("become"); } }, [
        el("strong", { text: "I want to become a Chief Agent Officer" }),
        el("span", { text: "Roles, training and applying" })
      ])
    ], ".choice.primary");
  }

  // ---- step 2a: live chat start -------------------------------------------
  function showStartForm(message) {
    var name = el("input", { type: "text", name: "name", maxlength: "120", autocomplete: "name", required: true });
    var email = el("input", { type: "email", name: "email", maxlength: "254", autocomplete: "email", required: true });
    var phone = el("input", { type: "tel", name: "phone", maxlength: "32", autocomplete: "tel", required: true });
    var text = el("textarea", { name: "message", rows: "3", maxlength: "2000", required: true });
    var hp = honeypot();
    var err = el("div");
    var submit = el("button", { type: "submit", class: "primary wide", text: "Start chat" });
    if (state.name) name.value = state.name;
    if (state.email) email.value = state.email;
    if (state.phone) phone.value = state.phone;
    if (message) text.value = message;

    var form = el("form", { class: "form", onsubmit: function (e) {
      e.preventDefault();
      err.textContent = "";
      if (!name.value.trim() || !text.value.trim()) { err.appendChild(errorLine("Please add your name and a message.")); return; }
      if (!email.value.trim() || !phone.value.trim()) { err.appendChild(errorLine("Please add your email and phone number so we can reach you.")); return; }
      submit.disabled = true;
      submit.textContent = "Starting...";
      api("start", {
        enquiryType: state.enquiryType, name: name.value, email: email.value, phone: phone.value,
        message: text.value, page: location.href, website: hp.value
      }).then(function (r) {
        submit.disabled = false;
        submit.textContent = "Start chat";
        if (r.ok) {
          state.conversationId = r.conversationId;
          state.token = r.token;
          state.name = name.value.trim();
          state.email = email.value.trim();
          state.phone = phone.value.trim();
          state.startedAt = new Date().toISOString();
          firstVisitorText = text.value.trim();
          save();
          showChat();
          poll();
          return;
        }
        if (r.error === "after_hours") {
          status = { mode: status && status.mode, open: false, nextOpen: r.nextOpen || "soon", noReplySeconds: 180, hours: status && status.hours, holiday: status && status.holiday };
          setSubtitle();
          state.name = name.value.trim(); state.email = email.value.trim(); state.phone = phone.value.trim();
          firstVisitorText = text.value.trim();
          showCaptureForm("after_hours");
          return;
        }
        err.appendChild(errorLine(messageFor(r)));
      });
    } }, [
      el("p", { class: "lead", text: state.enquiryType === "become" ? "Ask us about becoming a CAO." : "Ask us about hiring a CAO." }),
      field("Your name *", name),
      field("Email *", email),
      field("Phone *", phone),
      field("Message *", text),
      hp, err, submit,
      el("button", { type: "button", class: "link", text: "Back", onclick: showChoose })
    ]);
    setBody("start", [form], "input[name=name]");
  }

  // ---- step 2b / fallback: call-back form -----------------------------------
  function showCaptureForm(reason) {
    var intro = reason === "no_reply"
      ? "Sorry for the wait. Leave your details and we'll get back to you as soon as someone is free."
      : "Live chat is available " + hoursText() + ". Leave your details and we'll get back to you " + (status && status.nextOpen && status.nextOpen !== "now" ? status.nextOpen + "." : "shortly.");
    var name = el("input", { type: "text", name: "name", maxlength: "120", autocomplete: "name", required: true });
    var email = el("input", { type: "email", name: "email", maxlength: "254", autocomplete: "email", required: true });
    var phone = el("input", { type: "tel", name: "phone", maxlength: "32", autocomplete: "tel", required: true });
    var question = el("textarea", { name: "question", rows: "3", maxlength: "2000", required: true });
    var byCall = el("input", { type: "radio", name: "pref", value: "call", checked: true });
    var byEmail = el("input", { type: "radio", name: "pref", value: "email" });
    var hp = honeypot();
    var err = el("div");
    var submit = el("button", { type: "submit", class: "primary wide", text: "Send my details" });
    name.value = state.name || (latest && latest.name) || "";
    email.value = state.email || (latest && latest.email) || "";
    phone.value = state.phone || (latest && latest.phone) || "";
    question.value = firstVisitorText || "";

    var form = el("form", { class: "form", onsubmit: function (e) {
      e.preventDefault();
      err.textContent = "";
      var pref = byEmail.checked ? "email" : "call";
      if (!name.value.trim() || !question.value.trim()) { err.appendChild(errorLine("Please add your name and your question.")); return; }
      if (!email.value.trim() || !phone.value.trim()) { err.appendChild(errorLine("Please add your email and phone number so we can reach you.")); return; }
      submit.disabled = true;
      submit.textContent = "Sending...";
      var payload = {
        name: name.value, email: email.value, phone: phone.value, question: question.value,
        preferredContact: pref, page: location.href, website: hp.value
      };
      if (state.conversationId && state.token) { payload.conversationId = state.conversationId; payload.token = state.token; }
      else payload.enquiryType = state.enquiryType || defaultType();
      api("capture", payload).then(function (r) {
        submit.disabled = false;
        submit.textContent = "Send my details";
        if (r.ok || r.error === "already_captured") {
          if (r.token) { state.conversationId = r.conversationId; state.token = r.token; }
          state.name = name.value.trim(); state.email = email.value.trim(); state.phone = phone.value.trim();
          state.captured = true;
          state.captureNote = thanksText(pref, r.nextOpen || (status && status.nextOpen), name.value.trim());
          save();
          showChat();
          poll();
          return;
        }
        if (r.error === "not_found") { forget(); showChoose(); return; }
        err.appendChild(errorLine(messageFor(r)));
      });
    } }, [
      el("p", { class: "lead", text: intro }),
      field("Your name *", name),
      field("Phone *", phone),
      field("Email *", email),
      el("fieldset", { class: "pref" }, [
        el("legend", { text: "Best way to reach you" }),
        el("label", {}, [byCall, " Call me"]),
        el("label", {}, [byEmail, " Email me"])
      ]),
      field("Your question *", question),
      hp, err, submit,
      reason === "no_reply" ? el("button", { type: "button", class: "link", text: "Keep waiting in the chat", onclick: function () { state.dismissedOffer = true; save(); showChat(); poll(); } }) : null
    ].filter(Boolean));
    setBody("capture", [form], "input[name=name]");
  }

  function thanksText(pref, nextOpen, name) {
    var when = !nextOpen || nextOpen === "now" ? "shortly" : "from " + nextOpen;
    var first = (name || "").split(/\s+/)[0];
    return "Thanks" + (first ? " " + first : "") + ". We've got your details and will " + (pref === "email" ? "email you " : "call you ") + when + ".";
  }

  // ---- live chat view -----------------------------------------------------
  var list, input, sendBtn, offer, note;

  function showChat() {
    list = el("div", { class: "messages", "aria-live": "polite" });
    input = el("textarea", { rows: "2", maxlength: "2000", "aria-label": "Type your message", placeholder: "Type your message" });
    sendBtn = el("button", { type: "button", class: "primary", text: "Send" });
    offer = el("div", { class: "offer", hidden: true }, [
      el("p", { class: "offer-text", text: "Nobody has replied yet. Leave your details and we'll get back to you." }),
      el("button", { type: "button", class: "primary", text: "Leave my details", onclick: function () { showCaptureForm("no_reply"); } })
    ]);
    note = el("p", { class: "note", hidden: !state.captured, text: state.captureNote || "Thanks. We've got your details and will be in touch." });
    var composer = el("div", { class: "composer" }, [input, sendBtn]);
    seen = {};
    lastAt = null;
    setBody("chat", [list, note, offer, composer,
      el("button", { type: "button", class: "link", text: "Start a new chat", onclick: function () { if (confirm("Start a new chat? This one will be cleared from this browser.")) { forget(); refreshStatus().then(showChoose); } } })
    ], "textarea");
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    sendBtn.addEventListener("click", sendMessage);
  }

  function sendMessage() {
    var text = input.value.trim();
    if (!text || sendBtn.disabled) return;
    sendBtn.disabled = true;
    api("send", { conversationId: state.conversationId, token: state.token, message: text, page: location.href }).then(function (r) {
      sendBtn.disabled = false;
      if (r.ok) { input.value = ""; if (!firstVisitorText) firstVisitorText = text; poll(); return; }
      if (r.error === "not_found") { forget(); refreshStatus().then(showChoose); return; }
      if (r.error === "closed") { renderClosed(); return; }
      list.appendChild(errorLine(messageFor(r)));
    });
  }

  function renderMessage(m) {
    if (seen[m.id]) return;
    seen[m.id] = true;
    if (m.sender === "visitor" && !firstVisitorText) firstVisitorText = m.body;
    var who = m.sender === "staff" ? (m.name || "CAO Partners") : m.sender === "visitor" ? "You" : "";
    list.appendChild(el("div", { class: "msg " + m.sender }, [
      who ? el("div", { class: "who", text: who }) : null,
      el("div", { class: "bubble", text: m.body })
    ].filter(Boolean)));
    if (!lastAt || m.at > lastAt) lastAt = m.at;
  }

  function renderClosed() {
    if (!list || body.querySelector(".closed")) return;
    list.appendChild(el("p", { class: "note closed", text: "This chat has been closed. Start a new chat if you need anything else." }));
    if (input) { input.disabled = true; sendBtn.disabled = true; }
  }

  // ---- polling ------------------------------------------------------------
  function schedulePoll(ms) {
    clearTimeout(pollTimer);
    if (!state.conversationId) return;
    pollTimer = setTimeout(poll, ms);
  }

  function poll() {
    clearTimeout(pollTimer);
    if (!state.conversationId || !state.token) return;
    var watching = panelOpen && view === "chat";
    api("poll", { conversationId: state.conversationId, token: state.token, after: watching ? lastAt : null }).then(function (r) {
      if (r.error === "not_found") { forget(); if (panelOpen) refreshStatus().then(showChoose); return; }
      if (!r.ok) { schedulePoll(panelOpen ? POLL_OPEN_MS * 2 : POLL_CLOSED_MS); return; }
      latest = r;
      status = { mode: status && status.mode, open: r.open, nextOpen: r.nextOpen, noReplySeconds: (status && status.noReplySeconds) || 180, hours: status && status.hours, holiday: status && status.holiday };
      setSubtitle();
      if (r.captured && !state.captured) { state.captured = true; save(); }

      // The call-back offer is due once the visitor's oldest unanswered message has
      // waited the no-reply window. Worked out on EVERY poll, not only while the chat
      // is open: a visitor who closed the panel or moved to another page would
      // otherwise never learn the offer exists (Michael's test, 14 Sep 2026).
      var waitMs = r.firstUnansweredAt ? Date.now() - new Date(r.firstUnansweredAt).getTime() : 0;
      var limit = ((status && status.noReplySeconds) || 180) * 1000;
      var offerDue = !!(r.status !== "closed" && !r.captured && !state.dismissedOffer && r.firstUnansweredAt && waitMs >= limit);

      if (watching) {
        (r.messages || []).forEach(renderMessage);
        list.scrollTop = list.scrollHeight;
        if (r.status === "closed") renderClosed();
        note.hidden = !state.captured;
        var offerText = offer.querySelector(".offer-text");
        if (offerText) {
          offerText.textContent = r.staffReplied
            ? "Sorry for the wait, we've been pulled away. Leave your details and we'll get back to you as soon as someone is free."
            : "Nobody has replied yet. Leave your details and we'll get back to you.";
        }
        offer.hidden = !offerDue;
        setNudge(false);
      } else {
        var staffNew = (r.messages || []).some(function (m) { return m.sender === "staff" && (!state.lastSeenStaffAt || m.at > state.lastSeenStaffAt); });
        if (staffNew && !panelOpen) launcher.classList.add("unread");
        if (!panelOpen) setNudge(offerDue);
      }
      if (watching) {
        var staff = (r.messages || []).filter(function (m) { return m.sender === "staff"; });
        if (staff.length) { state.lastSeenStaffAt = staff[staff.length - 1].at; save(); }
      }
      schedulePoll(panelOpen ? POLL_OPEN_MS : POLL_CLOSED_MS);
    });
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && state.conversationId) poll();
  });

  // The addresses the site already publishes: enquiries for hiring, recruitment for candidates.
  function contactEmail() {
    return (state.enquiryType || defaultType()) === "become" ? "recruitment@caopartners.com.au" : "enquiries@caopartners.com.au";
  }

  function messageFor(r) {
    switch (r.error) {
      case "disabled": return "Chat is switched off right now. You can email " + contactEmail() + ".";
      case "rate_limited": return "Too many messages from here just now. Please try again in a minute.";
      case "invalid_email": return "That email address doesn't look right.";
      case "invalid_phone": return "That phone number doesn't look right.";
      case "contact_required": return "Please add your email and phone number so we can reach you.";
      case "phone_required": return "Add a phone number so we can call you, or choose email.";
      case "email_required": return "Add an email address, or choose a call.";
      case "network": return "We couldn't reach the chat. Check your connection and try again.";
      case "unavailable": return "Chat is unavailable right now. You can email " + contactEmail() + ".";
      default: return "Something went wrong. Please try again.";
    }
  }

  function CSS() {
    return [
      ":host{all:initial}",
      "*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}",
      ".launcher{position:fixed;right:20px;bottom:20px;z-index:2147483000;display:flex;align-items:center;gap:8px;border:0;border-radius:999px;padding:12px 18px;background:#1269ff;color:#fff;font-size:15px;font-weight:600;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.35)}",
      ".launcher:hover{background:#0d50cc}",
      ".launcher:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid #7fb0ff;outline-offset:2px}",
      ".launcher .icon{font-size:18px;line-height:1}",
      ".launcher .live{display:none;width:9px;height:9px;border-radius:50%;background:#31d158;box-shadow:0 0 0 2px rgba(255,255,255,.9),0 0 8px 2px rgba(49,209,88,.9);animation:caoLive 2s ease-in-out infinite}",
      ".launcher.online .live{display:inline-block}",
      ":host(.is-open) .launcher .live{display:none}",
      "@keyframes caoLive{0%,100%{opacity:1}50%{opacity:.55}}",
      "@media (prefers-reduced-motion:reduce){.launcher .live{animation:none}}",
      ".launcher .dot{display:none;width:10px;height:10px;border-radius:50%;background:#ff5a5a;border:2px solid #fff}",
      ".launcher.unread .dot{display:inline-block}",
      ".launcher.nudge{background:#0d50cc;box-shadow:0 0 0 3px rgba(255,204,51,.9),0 8px 24px rgba(0,0,0,.35)}",
      ".launcher.testing::after{content:'TEST';margin-left:4px;font-size:10px;font-weight:700;background:#ffcc33;color:#111;border-radius:6px;padding:1px 5px}",
      ":host(.is-open) .launcher .label{display:none}",
      ".panel{position:fixed;right:20px;bottom:84px;z-index:2147483000;width:370px;max-width:calc(100vw - 24px);height:560px;max-height:calc(100vh - 110px);display:flex;flex-direction:column;background:#0c0d1a;color:#fff;border:1px solid #1e2140;border-radius:16px;overflow:hidden;box-shadow:0 18px 48px rgba(0,0,0,.5)}",
      ".panel[hidden]{display:none}",
      "header{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;padding:14px 16px;background:#070812;border-bottom:1px solid #1e2140}",
      ".logo{display:block;height:30px;width:auto;margin:0 0 4px;filter:brightness(0) invert(1)}",
      ".sub{font-size:12px;color:#aab0d6;margin-top:2px;line-height:1.35}",
      ".close{background:transparent;border:0;color:#aab0d6;font-size:24px;line-height:1;cursor:pointer;padding:0 4px}",
      ".body{flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:10px}",
      ".lead{margin:0 0 4px;font-size:14px;line-height:1.45}",
      ".muted{color:#aab0d6;font-size:14px}",
      ".choice{display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;text-align:left;padding:12px 14px;border-radius:12px;border:1px solid #2a2e55;background:#111224;color:#fff;cursor:pointer;font-size:14px}",
      ".choice span{font-size:12px;color:#aab0d6}",
      ".choice:hover,.choice.primary{border-color:#1269ff}",
      ".form{display:flex;flex-direction:column;gap:10px}",
      ".field{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#c9cdea}",
      "input[type=text],input[type=email],input[type=tel],textarea{width:100%;padding:9px 10px;border-radius:8px;border:1px solid #2a2e55;background:#04050f;color:#fff;font-size:14px;resize:vertical}",
      "fieldset.pref{border:0;padding:0;margin:0;display:flex;gap:16px;align-items:center;font-size:13px;color:#c9cdea}",
      "fieldset.pref legend{float:left;margin-right:8px;font-size:12px}",
      "button.primary{background:#1269ff;color:#fff;border:0;border-radius:8px;padding:10px 14px;font-size:14px;font-weight:600;cursor:pointer}",
      "button.primary:hover{background:#0d50cc}",
      "button.primary[disabled]{opacity:.6;cursor:default}",
      "button.wide{width:100%}",
      "button.link{background:transparent;border:0;color:#7fb0ff;font-size:13px;cursor:pointer;padding:4px 0;align-self:flex-start}",
      ".hp{position:absolute;left:-10000px;width:1px;height:1px;opacity:0}",
      ".error{color:#ff9b9b;font-size:13px;margin:0}",
      ".messages{flex:1;display:flex;flex-direction:column;gap:8px;overflow-y:auto;min-height:120px}",
      ".msg{display:flex;flex-direction:column;max-width:85%}",
      ".msg.visitor{align-self:flex-end;align-items:flex-end}",
      ".msg.staff,.msg.system{align-self:flex-start}",
      ".who{font-size:11px;color:#aab0d6;margin:0 4px 2px}",
      ".bubble{padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-wrap:break-word}",
      ".visitor .bubble{background:#1269ff;color:#fff;border-bottom-right-radius:4px}",
      ".staff .bubble{background:#1c1f3a;color:#fff;border-bottom-left-radius:4px}",
      ".system .bubble{background:transparent;color:#aab0d6;font-style:italic}",
      ".note{font-size:13px;color:#c9f2d0;background:#0f2a1a;border:1px solid #1f5a36;border-radius:10px;padding:10px 12px;margin:0}",
      ".note[hidden],.offer[hidden]{display:none}",
      ".offer{background:#1a1733;border:1px solid #3a3470;border-radius:10px;padding:10px 12px;font-size:13px}",
      ".offer p{margin:0 0 8px}",
      ".composer{display:flex;gap:8px;align-items:flex-end}",
      ".composer textarea{flex:1;resize:none}",
      "@media (max-width:480px){.panel{right:0;left:0;bottom:0;width:100%;max-width:100%;height:100%;max-height:100%;border-radius:0}.launcher{right:14px;bottom:14px}:host(.is-open) .launcher{display:none}}",
      "@media print{.launcher,.panel{display:none}}"
    ].join("\n");
  }
})();
