/**
 * The website chat widget tag, shared by every script that writes HTML pages.
 *
 * WHY SHARED. Three scripts write pages here: wire-chat-widget.mjs (every page),
 * wire-lead-magnets.mjs and publish-sms-plans.mjs (the /plan/ pages, rebuilt from
 * generated source on each run). If only the first added the tag, the next
 * lead-magnet publish would silently strip the chat from the plan pages. All
 * three call withChatWidget(), so a republish keeps it.
 *
 * IDEMPOTENT. The tag sits between marker comments and is stripped before being
 * re-added, so running any script twice yields the same bytes.
 *
 * CSP. Two pages (audit, olc) carry a strict Content-Security-Policy meta tag.
 * The widget script is same-origin (script-src 'self' already allows it), but its
 * API calls go to the chat service, so that origin is added to connect-src.
 */
export const CHAT_BASE = "https://chat.caopartners.com.au";
const OPEN = "<!-- cao-chat-widget -->";
const CLOSE = "<!-- /cao-chat-widget -->";
export const CHAT_TAG = `${OPEN}<script src="/chat-widget.js" data-chat-base="${CHAT_BASE}" defer></script>${CLOSE}`;

/* FIRST-TOUCH ATTRIBUTION rides on the same every-page stamp (18 Sep 2026), so the
   three page-writing scripts keep it on a republish for free. It is NOT deferred: it
   must stamp the hidden first_touch field before a visitor can submit. It is its own
   marked block, stripped and re-added like the chat tag, so both stay idempotent.
   Same-origin, so the strict CSP pages already allow it (script-src 'self'). */
const ATTR_OPEN = "<!-- cao-attribution -->";
const ATTR_CLOSE = "<!-- /cao-attribution -->";
export const ATTRIBUTION_TAG = `${ATTR_OPEN}<script src="/attribution.js"></script>${ATTR_CLOSE}`;

function stripBlock(html, open, close) {
  const start = html.indexOf(open);
  if (start < 0) return html;
  const end = html.indexOf(close, start);
  if (end < 0) throw new Error(`${open} opening marker without a closing marker`);
  let after = end + close.length;
  if (html[after] === "\n") after++;
  return html.slice(0, start) + html.slice(after);
}

export function stripChatWidget(html) {
  const start = html.indexOf(OPEN);
  if (start < 0) return html;
  const end = html.indexOf(CLOSE, start);
  if (end < 0) throw new Error("chat widget opening marker without a closing marker");
  let after = end + CLOSE.length;
  if (html[after] === "\n") after++;
  return html.slice(0, start) + html.slice(after);
}

function allowChatInCsp(html) {
  return html.replace(/(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")/gi, (all, pre, policy, post) => {
    const directives = policy.split(";").map((d) => d.trim());
    const i = directives.findIndex((d) => /^connect-src\s/i.test(d));
    if (i < 0) {
      throw new Error("page has a CSP without connect-src; add the chat origin by hand after checking default-src");
    }
    const parts = directives[i].split(/\s+/);
    if (!parts.includes(CHAT_BASE)) directives[i] = [...parts, CHAT_BASE].join(" ");
    return pre + directives.filter(Boolean).join("; ") + post;
  });
}

export function withChatWidget(html) {
  const out = allowChatInCsp(stripBlock(stripChatWidget(html), ATTR_OPEN, ATTR_CLOSE));
  const body = out.lastIndexOf("</body>");
  if (body < 0) throw new Error("page has no </body>");
  return out.slice(0, body) + ATTRIBUTION_TAG + "\n" + CHAT_TAG + "\n" + out.slice(body);
}
