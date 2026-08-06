/**
 * fit.mjs — work out a per-logo display height so the row reads evenly.
 *
 * A single CSS height looks wrong here and the preview proved it: beard.com
 * towered while Northwear vanished, because a fixed height sizes the BOUNDING
 * BOX, and these files disagree wildly about how much padding, tagline and
 * whitespace sits inside that box. Grouping them into wide/tall/badge buckets
 * was the same mistake at lower resolution.
 *
 * So measure the ink instead. Render each logo at a reference height, count the
 * pixels that are actually opaque, and pick the height where every logo carries
 * roughly the same ink AREA — which is what the eye reads as "same size".
 * Two clamps keep it sane: nothing wider than the column allows, and nothing so
 * tall it breaks the row.
 *
 * Emits scripts/ticker-logo-heights.css — paste it into styles.css under the
 * "PER-LOGO HEIGHTS" comment whenever the client roster changes.
 *
 * DEV-ONLY. Deliberately NOT in package.json: this site is built by Netlify
 * from that file, and adding puppeteer would pull ~300MB of Chromium into every
 * deploy for a script that runs once a year. Run it from a checkout that
 * already has puppeteer:
 *
 *   cd ../cao-crm && node ../caopartners-website/scripts/fit-ticker-logos.mjs \
 *     ../caopartners-website/assets/clients
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
// Resolve puppeteer from the CURRENT WORKING DIRECTORY, not from this file.
// A bare ESM import resolves next to the script, which has no node_modules and
// (see above) deliberately never will — so the documented invocation would fail.
const { createRequire } = await import("node:module");
const puppeteer = createRequire(`${process.cwd()}/`)("puppeteer");

const DIR = process.argv[2] || "assets/clients";
const FILES = readdirSync(DIR).filter((f) => /\.(png|svg|jpe?g)$/i.test(f)).sort();

const REF = 120;          // reference render height, px
let TARGET_INK = 0;       // calibrated below from the roster itself
const MIN_H = 18, MAX_H = 44, MAX_W = 150;
const BADGE_AR = 1.4, BADGE_MIN_H = 42;  // circular badges need height to stay readable
const MEDIAN_H = 30;      // where the typical logo should land

const mime = (f) => (f.endsWith(".svg") ? "image/svg+xml" : f.endsWith(".jpg") ? "image/jpeg" : "image/png");
const uri = (f) => `data:${mime(f)};base64,${readFileSync(`${DIR}/${f}`).toString("base64")}`;

const browser = await puppeteer.launch({ headless: "new" });
const page = await browser.newPage();

const sizes = {};
for (const f of FILES) {
  const m = await page.evaluate(async (u, REF) => {
    const img = new Image(); img.src = u; await img.decode();
    const ar = img.naturalWidth / img.naturalHeight;
    const w = Math.round(REF * ar);
    const c = document.createElement("canvas"); c.width = w; c.height = REF;
    const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0, w, REF);
    const px = ctx.getImageData(0, 0, w, REF).data;
    let ink = 0;
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3] / 255;
      if (a < 0.12) continue;
      // A solid block (Fencepac) is all ink; a hairline wordmark is mostly gap.
      // Weight by alpha so soft edges count partially.
      ink += a;
    }
    return { ar, ink };
  }, uri(f), REF);

  sizes[f] = m;
}

// Calibrate the target from the roster rather than hard-coding it: put the
// MEDIAN logo at MEDIAN_H, so the row is balanced whoever is on it.
const inks = Object.values(sizes).map((m) => m.ink).sort((a, b) => a - b);
const medianInk = inks[Math.floor(inks.length / 2)];
TARGET_INK = medianInk * (MEDIAN_H / REF) ** 2;

for (const [f, m] of Object.entries(sizes)) {
  // ink scales with h^2, so h = REF * sqrt(target / inkAtRef)
  const hInk = REF * Math.sqrt(TARGET_INK / m.ink);
  // Pure ink area over-punishes SOLID marks: Fencepac is a filled orange block
  // and Territory Water a filled panel, so they carry far more ink than a
  // hairline wordmark of the same apparent size and get shrunk to nothing.
  // Split the difference with the uniform height — geometric mean keeps the
  // correction but stops it running away.
  let h = Math.sqrt(hInk * MEDIAN_H);
  h = Math.min(MAX_H, Math.max(MIN_H, h));
  // A near-square badge (H&L, Brisbane Pump Action) packs its detail into a
  // circle. Ink-matched against a wordmark it comes out ~32px, at which the
  // artwork inside is an unreadable smudge. Give compact marks a floor.
  if (m.ar < BADGE_AR) h = Math.max(h, BADGE_MIN_H);
  if (h * m.ar > MAX_W) h = MAX_W / m.ar;          // never wider than the column
  sizes[f] = { h: Math.round(h), w: Math.round(h * m.ar), ar: +m.ar.toFixed(2), ink: Math.round(m.ink) };
}
await browser.close();

// Emit the CSS block that lives in styles.css under "PER-LOGO HEIGHTS".
const css = Object.entries(sizes)
  .map(([f, s]) => `.ticker-track .cl-${f.replace(/\.[^.]+$/, "")} { height: ${s.h}px; }`)
  .join("\n");
writeFileSync(new URL("ticker-logo-heights.css", import.meta.url), css + "\n");
for (const [f, s] of Object.entries(sizes)) {
  console.log(`  ${f.padEnd(26)} h=${String(s.h).padStart(3)}  w=${String(s.w).padStart(4)}  ar=${s.ar}`);
}
