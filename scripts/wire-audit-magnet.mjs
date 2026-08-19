/**
 * wire-audit-magnet.mjs — publish the general-free-ai-audit asset to /audit/
 * with the Meta pixel, CRM capture and the privacy link stamped in.
 *
 * SEPARATE FROM wire-lead-magnets.mjs ON PURPOSE. That script serves five
 * report magnets from Oscar's cao-active-lead-magnets repo: one flat folder,
 * shared media deduped into /plan/_shared/, capture hooked on `done`. This
 * asset comes from a DIFFERENT repo (cao-lead-magnets), ships its own
 * self-contained dist/ including a clients/ folder, and converts on a Calendly
 * iframe rather than a rendered report. Bending one script around both would
 * make each harder to change, and the two will drift apart as Oscar versions
 * them independently.
 *
 * IDEMPOTENT, same as its sibling: the injected block is marked and stripped
 * before being re-added, so re-running never stacks.
 *
 * VERSIONED SOURCE. The asset lives under versions/<date>/dist. The version is
 * an argument rather than a glob so that publishing is a deliberate act: a new
 * version appearing in the repo must not silently change what the ads point at.
 *
 * Usage, from the website repo:
 *   node scripts/wire-audit-magnet.mjs <path-to-cao-lead-magnets> 2026-08-19.1
 *   node scripts/wire-audit-magnet.mjs <path-to-cao-lead-magnets> 2026-08-19.1 --check
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC_REPO = process.argv[2];
const VERSION = process.argv[3];
const CHECK = process.argv.includes("--check");
if (!SRC_REPO || !VERSION) {
  console.error("usage: node scripts/wire-audit-magnet.mjs <path-to-cao-lead-magnets> <version> [--check]");
  process.exit(2);
}

const ASSET = "general-free-ai-audit";
const OUT_DIR = "audit";
const DIST = join(SRC_REPO, "lead-magnets", "assets", ASSET, "versions", VERSION, "dist");

const PIXEL_ID = "1656519126480896";   // CAO in-house dataset, NOT the creator army's
const MARK_OPEN = "<!-- wired:begin -->";
const MARK_CLOSE = "<!-- wired:end -->";
const FOOT_OPEN = "<!-- wired:foot:begin -->";
const FOOT_CLOSE = "<!-- wired:foot:end -->";

const BLOCK = `${MARK_OPEN}
<!-- Injected by scripts/wire-audit-magnet.mjs. Do not edit here or in the
     source repo: the source is generated and this block is re-stamped on every
     deploy. Change the script instead. -->
<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${PIXEL_ID}');fbq('track','PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
 src="https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1"/></noscript>
<link rel="icon" href="/favicon.svg">
<script src="/audit-capture.js" defer></script>
${MARK_CLOSE}`;

/**
 * Meta's advertising policies require the destination of a paid ad that
 * collects contact details to carry a reachable privacy policy, and an ad can
 * be rejected without one. The generated asset has no footer, hence a minimal
 * one. Same treatment as the /plan/ magnets.
 */
const FOOT = `${FOOT_OPEN}
<div style="text-align:center;padding:28px 16px 40px;font:300 13px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;opacity:.55">
  <a href="https://caopartners.com.au/privacy/" style="color:inherit;text-decoration:underline">Privacy Policy</a>
  &nbsp;·&nbsp; © CAO Partners Pty Ltd
</div>
${FOOT_CLOSE}`;

function strip(html) {
  return html
    .replace(new RegExp(`${MARK_OPEN}[\\s\\S]*?${MARK_CLOSE}\\s*`, "g"), "")
    .replace(new RegExp(`${FOOT_OPEN}[\\s\\S]*?${FOOT_CLOSE}\\s*`, "g"), "");
}

function wire(html) {
  const clean = strip(html);
  const head = clean.lastIndexOf("</head>");
  if (head < 0) throw new Error("no </head> — cannot inject");
  const withHead = clean.slice(0, head) + BLOCK + "\n" + clean.slice(head);
  const body = withHead.lastIndexOf("</body>");
  if (body < 0) throw new Error("no </body> — cannot inject the privacy link");
  return withHead.slice(0, body) + FOOT + "\n" + withHead.slice(body);
}

if (!existsSync(DIST)) {
  console.error(`MISSING: ${DIST}\nCheck the version argument against the repo.`);
  process.exit(1);
}

const wired = wire(readFileSync(join(DIST, "index.html"), "utf8"));
const outFile = join(OUT_DIR, "index.html");
const current = existsSync(outFile) ? readFileSync(outFile, "utf8") : null;
const same = current === wired;

if (CHECK) {
  console.log(`${same ? "up to date" : "STALE    "}  /${OUT_DIR}/   (source ${VERSION})`);
  process.exitCode = same ? 0 : 1;
} else {
  mkdirSync(OUT_DIR, { recursive: true });
  // Everything the page references sits beside it in dist/ (logo, proof shots,
  // clients/). Copy the lot, then overwrite index.html with the wired version.
  for (const entry of readdirSync(DIST)) {
    if (entry === "index.html") continue;
    cpSync(join(DIST, entry), join(OUT_DIR, entry), { recursive: true });
  }
  writeFileSync(outFile, wired);
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  console.log(`wrote /${OUT_DIR}/index.html  (${kb(wired.length)}, source ${VERSION})`);
  console.log(`assets copied: ${readdirSync(OUT_DIR).filter((f) => f !== "index.html").join(", ")}`);
  console.log(`total published: ${kb(readdirSync(OUT_DIR).reduce((s, f) => {
    const p = join(OUT_DIR, f);
    return s + (statSync(p).isDirectory()
      ? readdirSync(p).reduce((a, g) => a + statSync(join(p, g)).size, 0)
      : statSync(p).size);
  }, 0))}`);
  console.log("Pixel + /audit-capture.js + privacy link injected.");
}
