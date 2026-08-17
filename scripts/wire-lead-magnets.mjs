/**
 * wire-lead-magnets.mjs — publish Oscar's generated lead magnets to /plan/<slug>/
 * with the Meta pixel and CRM capture stamped in.
 *
 * WHY AN INJECTION STEP AND NOT HAND EDITS. The five HTML files come out of a
 * generator in Oscar's AIOS vault, and his README is explicit: "Edit the config,
 * never the HTML. Every file here is generated, and a regenerate overwrites hand
 * edits without warning." Wiring added by hand would be destroyed the next time
 * he ships. This re-applies the wiring from scratch on every run, so the loop is
 * always: Oscar regenerates -> we re-run this -> wiring is back.
 *
 * IDEMPOTENT. Running twice produces the same file. Each injected block carries
 * a marker comment and is stripped before being re-added, so nothing stacks up.
 *
 * Usage, from the website repo with the magnets repo checked out beside it:
 *   node scripts/wire-lead-magnets.mjs ../cao-active-lead-magnets
 *   node scripts/wire-lead-magnets.mjs ../cao-active-lead-magnets --check
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";

const SRC = process.argv[2];
const CHECK = process.argv.includes("--check");
if (!SRC) {
  console.error("usage: node scripts/wire-lead-magnets.mjs <path-to-cao-active-lead-magnets> [--check]");
  process.exit(2);
}

/** file in the magnets repo -> the URL it is published at */
const MAGNETS = [
  ["construction-ai-build-plan.html",         "construction"],
  ["trades-ai-build-plan.html",               "trades"],
  ["financial-services-ai-build-plan.html",   "financial-services"],
  ["professional-services-ai-build-plan.html", "professional-services"],
  ["admin-overload-ai-build-plan.html",       "admin"],
];

/** Shared media the pages reference by bare filename. */
const SHARED = ["logo.svg", "preview.mp4"];

const PIXEL_ID = "1656519126480896";   // CAO in-house dataset, NOT the creator army's
const MARK_OPEN = "<!-- wired:begin -->";
const MARK_CLOSE = "<!-- wired:end -->";

const BLOCK = `${MARK_OPEN}
<!-- Injected by scripts/wire-lead-magnets.mjs. Do not edit here or in the
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
<script src="/lm-capture.js" defer></script>
${MARK_CLOSE}`;

/** Remove any previously injected block so re-running cannot stack them. */
function strip(html) {
  const re = new RegExp(`${MARK_OPEN}[\\s\\S]*?${MARK_CLOSE}\\s*`, "g");
  return html.replace(re, "");
}

function wire(html) {
  const clean = strip(html);
  const at = clean.lastIndexOf("</head>");
  if (at < 0) throw new Error("no </head> — cannot inject");
  return clean.slice(0, at) + BLOCK + "\n" + clean.slice(at);
}

/**
 * Shared media is published ONCE at /plan/_shared/ and the bare filenames in the
 * page are rewritten to point at it.
 *
 * Copying it per folder instead cost 21 MB in the repo — preview.mp4 alone is
 * 2 MB and there are five folders — for five identical copies of the same
 * video. The rewrite is confined to the exact known filenames, so it cannot
 * touch anything else in the document.
 */
function sharedMedia() {
  const proof = readdirSync(SRC).filter((f) => /^proof-.*\.(jpg|png|webp)$/i.test(f));
  return [...SHARED, ...proof];
}

function repointMedia(html, names) {
  let out = html;
  for (const n of names) {
    // Only inside a quoted attribute or the shot:"..." config value — never a
    // bare mention in prose.
    out = out.split(`"${n}"`).join(`"/plan/_shared/${n}"`);
  }
  return out;
}

// Shared media, published once.
if (!CHECK) {
  mkdirSync(join("plan", "_shared"), { recursive: true });
  for (const m of sharedMedia()) {
    const from = join(SRC, m);
    if (existsSync(from)) copyFileSync(from, join("plan", "_shared", m));
  }
  console.log(`shared media -> /plan/_shared/ (${sharedMedia().length} files)`);
}

let changed = 0, checked = 0;
for (const [file, slug] of MAGNETS) {
  const src = join(SRC, file);
  if (!existsSync(src)) { console.error(`MISSING in source repo: ${file}`); process.exitCode = 1; continue; }

  const outDir = join("plan", slug);
  const outFile = join(outDir, "index.html");
  const wired = repointMedia(wire(readFileSync(src, "utf8")), sharedMedia());
  checked++;

  const current = existsSync(outFile) ? readFileSync(outFile, "utf8") : null;
  const same = current === wired;

  if (CHECK) {
    console.log(`${same ? "up to date" : "STALE    "}  /plan/${slug}/`);
    if (!same) process.exitCode = 1;
    continue;
  }

  if (!same) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(outFile, wired);
    changed++;
  }

  console.log(`${same ? "unchanged" : "wrote    "}  /plan/${slug}/   (${(wired.length / 1024).toFixed(0)} KB)`);
}

if (!CHECK) {
  console.log(`\n${checked} magnet(s) processed, ${changed} written.`);
  console.log("Pixel + /lm-capture.js injected. Re-run after any regenerate from the source repo.");
}
