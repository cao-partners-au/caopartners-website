/**
 * wire-chat-widget.mjs: put the website chat widget on every page.
 *
 * The site is static HTML with no shared layout, so the tag is stamped into each
 * page just before </body> (see scripts/lib/chat-widget-tag.mjs for why every
 * page-writing script shares one helper).
 *
 * Usage, from the website repo root:
 *   node scripts/wire-chat-widget.mjs          # stamp every tracked page
 *   node scripts/wire-chat-widget.mjs --check  # exit 1 if any page lacks it
 *
 * Skips the dated homepage backup, which is not a live page.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { withChatWidget } from "./lib/chat-widget-tag.mjs";

const CHECK = process.argv.includes("--check");
const SKIP = new Set(["index-backup-20260514.html"]);

const pages = execFileSync("git", ["ls-files", "*.html"], { encoding: "utf8" })
  .split("\n")
  .filter((p) => p && !SKIP.has(p) && !p.startsWith("node_modules/") && !p.startsWith("scripts/"));

const stale = [];
for (const page of pages) {
  const html = readFileSync(page, "utf8");
  const wired = withChatWidget(html);
  if (wired === html) continue;
  stale.push(page);
  if (!CHECK) writeFileSync(page, wired);
}

if (CHECK) {
  if (stale.length) {
    console.error(`chat widget missing or out of date on ${stale.length} page(s):\n  ${stale.join("\n  ")}`);
    console.error("run: node scripts/wire-chat-widget.mjs");
    process.exit(1);
  }
  console.log(`chat widget present on all ${pages.length} pages`);
} else {
  console.log(`wired ${stale.length} of ${pages.length} pages (${pages.length - stale.length} already current)`);
}
