/**
 * publish-sms-plans.mjs — publish Oscar's SMS-delivered build plans to /plan/<folder>/ AS-IS.
 *
 * WHY NOT wire-lead-magnets.mjs. That script stamps the Meta pixel AND /lm-capture.js
 * onto the old in-page plans. The SMS pages carry their own pixel, icon and privacy link
 * (minted by cao-lead-magnets factory/scripts/inject-deliver.mjs) and post to the isolated
 * Railway service. Stamping lm-capture.js beside that flow would add a second, dead capture
 * and a second pixel. So this copies the minted page untouched except for one thing:
 * shared media is served from /plan/_shared/, exactly as today.
 *
 * Refuses a page whose bytes don't match its manifest, that isn't an SMS page, that lacks
 * exactly one CAO pixel, the privacy link or the honeypot, or that loads lm-capture.js.
 * Media byte-identical to /plan/_shared/ is served from there, as today. Media that differs
 * or is missing from _shared is published BESIDE the page instead: the minted bytes are what
 * Oscar verified, and overwriting _shared would silently change the other plans.
 *
 * DO NOT publish while CAO_ALLOW_PROD_WRITES is off on lead-magnet-web: every submission on a
 * published SMS page would fail with "unavailable".
 *
 * Usage, from the website repo:
 *   node scripts/publish-sms-plans.mjs <cao-lead-magnets> <release> <slug>=<folder> [...] [--check]
 *   node scripts/publish-sms-plans.mjs ../cao-lead-magnets 2026-09-11.1 construction-ai-build-plan=construction
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const CHECK = argv.includes("--check");
const [SRC, RELEASE, ...pairs] = argv.filter((a) => a !== "--check");
if (!SRC || !RELEASE || !pairs.length) {
  console.error("usage: node scripts/publish-sms-plans.mjs <cao-lead-magnets> <release> <slug>=<folder> [...] [--check]");
  process.exit(2);
}
const PIXEL = "fbq('init','1656519126480896')";
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const fail = (m) => { console.error(`publish-sms-plans: ${m}`); process.exit(1); };

let stale = 0;
for (const pair of pairs) {
  const [slug, folder] = pair.split("=");
  if (!slug || !folder || !/^[a-z0-9-]+$/.test(folder)) fail(`bad mapping "${pair}"`);
  const base = join(SRC, "lead-magnets/releases", RELEASE, slug);
  const manifest = JSON.parse(readFileSync(join(base, "manifest.json"), "utf8"));
  if (manifest.slug !== slug || manifest.version !== RELEASE) fail(`${slug}: manifest is ${manifest.slug} ${manifest.version}`);
  const srcHtml = readFileSync(join(base, "dist/index.html"));
  if (sha(srcHtml) !== manifest.artifacts?.hashes?.html) fail(`${slug}: page does not match its manifest hash`);
  let html = srcHtml.toString("utf8");

  if (!html.includes("window.CAO_DELIVER();")) fail(`${slug}: not an SMS-delivered page`);
  if (html.split(PIXEL).length !== 2) fail(`${slug}: expected exactly one CAO pixel`);
  if (!html.includes("Privacy Policy</a>")) fail(`${slug}: no privacy link`);
  if (!html.includes("website: honeypot.value || ''")) fail(`${slug}: honeypot missing`);
  if (/<script[^>]*lm-capture\.js/.test(html)) fail(`${slug}: loads lm-capture.js`);

  const media = readdirSync(join(base, "dist")).filter((f) => f !== "index.html");
  const repointed = [];
  const local = [];
  for (const f of media) {
    if (!/^[A-Za-z0-9._-]+$/.test(f)) fail(`${slug}: unexpected media name ${f}`);
    const bytes = readFileSync(join(base, "dist", f));
    const shared = join("plan", "_shared", f);
    if (existsSync(shared) && sha(bytes) === sha(readFileSync(shared))) {
      html = html.split(`"${f}"`).join(`"/plan/_shared/${f}"`);
      repointed.push(f);
    } else {
      local.push([f, bytes]); // referenced by bare name, so it resolves beside /plan/<folder>/
    }
  }

  const out = join("plan", folder, "index.html");
  const current = existsSync(out) ? readFileSync(out, "utf8") : null;
  if (CHECK) {
    const same = current === html && local.every(([f, bytes]) => {
      const p = join("plan", folder, f);
      return existsSync(p) && sha(readFileSync(p)) === sha(bytes);
    });
    console.log(`${same ? "up to date" : "STALE    "}  /plan/${folder}/  <- ${slug} ${RELEASE}`);
    if (!same) stale++;
    continue;
  }
  mkdirSync(join("plan", folder), { recursive: true });
  writeFileSync(out, html);
  for (const [f, bytes] of local) writeFileSync(join("plan", folder, f), bytes);
  console.log(`wrote  /plan/${folder}/  <- ${slug} ${RELEASE}  (source sha ${manifest.artifacts.hashes.html.slice(0, 12)})`);
  console.log(`       ${repointed.length} media from /plan/_shared/: ${repointed.join(", ") || "none"}`);
  console.log(`       ${local.length} published beside the page (differs from or absent in _shared): ${local.map(([f]) => f).join(", ") || "none"}`);
}
process.exit(stale ? 1 : 0);
