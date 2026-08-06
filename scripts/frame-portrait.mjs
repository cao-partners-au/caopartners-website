/**
 * frame-portrait.mjs — crop a cut-out portrait to the .founder-portrait frame.
 *
 * Step 2 of 2. Step 1 is scripts/portrait-on-white.swift, which lifts the
 * subject with the macOS person segmenter and writes a transparent PNG.
 *
 * FRAMED ON FACE SIZE, NOT SUBJECT WIDTH. Width-based framing looks fine until
 * a photo arrives in a different pose: Simon's warehouse shot has his elbows
 * spread far wider than Emil's, and matching shoulder widths made his head
 * visibly smaller in the card. Side by side, the eye compares faces. So face
 * height is pinned to FACE_H of the frame and the top of the face to FACE_TOP
 * from the top edge, which fixes both scale and vertical position, and any
 * future portrait lands consistently with no hand-tuning.
 *
 * Output is 4:5 at 2x (440x560). The frame is 220x280 with object-fit: cover,
 * so a square would be cropped a second time by the browser, somewhere we do
 * not control. JPEG, not PNG: the background is opaque, and PNG cost 362KB for
 * the pair where JPEG costs 51KB.
 *
 * Needs puppeteer, which is deliberately NOT in package.json — Netlify builds
 * from that file and puppeteer would drag ~300MB of Chromium into every deploy
 * for a script that runs when someone changes their headshot. Run it from a
 * checkout that has it:
 *
 *   # 1. get the face box (x y w h, pixels, top-left origin)
 *   swift scripts/face-rect.swift assets/founders/simon.jpg
 *   # 2. lift the subject
 *   swift scripts/portrait-on-white.swift assets/founders/simon.jpg /tmp/simon-cut.png none
 *   # 3. frame it
 *   cd ../cao-crm && node ../caopartners-website/scripts/frame-portrait.mjs \
 *     /tmp/simon-cut.png 326 159 264 264 \
 *     ../caopartners-website/assets/founders/simon-white.jpg
 */
import { readFileSync, writeFileSync } from "node:fs";
const { createRequire } = await import("node:module");
const puppeteer = createRequire(`${process.cwd()}/`)("puppeteer");

const [src, fx, fy, fw, fh, out] = process.argv.slice(2);
if (!out) {
  console.error("usage: frame-portrait <cut-out.png> <faceX> <faceY> <faceW> <faceH> <out.jpg>");
  process.exit(2);
}

const OUT_W = 440, OUT_H = 560;
const FACE_H = 0.30;    // face height as a share of the frame
const FACE_TOP = 0.17;  // top of the face, as a share of frame height

const browser = await puppeteer.launch({ headless: "new" });
const page = await browser.newPage();
const uri = `data:image/png;base64,${readFileSync(src).toString("base64")}`;
const r = await page.evaluate(async (uri, f, OUT_W, OUT_H, FACE_H, FACE_TOP) => {
  const img = new Image(); img.src = uri; await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext("2d").drawImage(img, 0, 0);

  const ch = f.h / FACE_H;                  // crop height follows face height
  const cw = ch * (OUT_W / OUT_H);
  const sy = f.y - ch * FACE_TOP;
  const sx = (f.x + f.w / 2) - cw / 2;      // centred on the face, not the body

  const o = document.createElement("canvas"); o.width = OUT_W; o.height = OUT_H;
  const ctx = o.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, OUT_W, OUT_H);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(c, sx, sy, cw, ch, 0, 0, OUT_W, OUT_H);
  return { b64: o.toDataURL("image/jpeg", 0.9).split(",")[1], scale: +(OUT_W / cw).toFixed(2) };
}, uri, { x: +fx, y: +fy, w: +fw, h: +fh }, OUT_W, OUT_H, FACE_H, FACE_TOP);

writeFileSync(out, Buffer.from(r.b64, "base64"));
await browser.close();
// Above 1 means upscaling — the source is too small and the result will be soft.
console.log(`${out} — resampled ${r.scale}x`);
