"use strict";
// Refreshes src/workshop.json: every ready-to-use Sandustry Workshop item (id, title, author) and,
// with --versions, the version numbers in each item's change notes (the game's uploader writes the
// mod version as the change note, which lets Mod Sync confirm a title match). Needs Node 18+ and
// steamcommunity.com (a mod can't reach it from inside the game):
//   node tools/workshop_catalog.cjs [--versions]
// Writes nothing unless the item count equals the total the Workshop reports, so a changed page
// layout fails loudly instead of shipping a short list.
const fs = require("node:fs"), path = require("node:path");
const APP = 2764460, PER = 30;
const out = path.join(__dirname, "..", "src", "workshop.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decode(s) {
  return String(s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
}

// One browse page -> {items: [{id, title, author}], total}
function parseListing(html) {
  const items = [];
  for (const block of html.split(/<div class="workshopItem"/).slice(1)) {
    const id = (block.match(/data-publishedfileid="(\d+)"/) || block.match(/filedetails\/\?id=(\d+)/) || [])[1];
    const title = (block.match(/class="workshopItemTitle[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1];
    const author = (block.match(/class="workshopItemAuthorName[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/) || [])[1];
    if (id && title) items.push({ id, title: decode(title), author: decode(author) });
  }
  const total = (html.match(/of\s+([\d,]+)\s+entries/) || [])[1];
  return { items, total: total ? Number(total.replace(/,/g, "")) : null };
}

// An item's change-notes page -> version-looking strings found in the notes.
function parseChangelog(html) {
  const versions = new Set();
  for (const m of html.matchAll(/changeLogCtn[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/g)) {
    for (const v of decode(m[1]).match(/\bv?\d+\.\d+(?:\.\d+)*(?:-[0-9A-Za-z.]+)?\b/g) || []) versions.add(v.replace(/^v/, ""));
  }
  return [...versions];
}

async function get(url) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (modsync workshop catalog)", "accept-language": "en-US" } });
    if (r.ok) return r.text();
    if (attempt === 3) throw new Error(`HTTP ${r.status} for ${url}`);
    await sleep(2000 * attempt);
  }
}

async function main() {
  const items = [], seen = new Set();
  let total = null;
  for (let p = 1; p < 200; p++) {
    const url = `https://steamcommunity.com/workshop/browse/?appid=${APP}&browsesort=mostrecent&section=readytouseitems&actualsort=mostrecent&numperpage=${PER}&p=${p}`;
    const page = parseListing(await get(url));
    if (page.total) total = page.total;
    for (const it of page.items) if (!seen.has(it.id)) { seen.add(it.id); items.push(it); }
    console.log(`page ${p}: ${page.items.length} items, ${items.length}/${total === null ? "?" : total}`);
    if (!page.items.length || (total && items.length >= total)) break;
    await sleep(800);
  }
  if (!total || items.length !== total) throw new Error(`parsed ${items.length} items, the Workshop reports ${total}: the page layout probably changed. Nothing written.`);
  if (process.argv.includes("--versions")) {
    for (const [i, it] of items.entries()) {
      it.versions = parseChangelog(await get(`https://steamcommunity.com/sharedfiles/filedetails/changelog/${it.id}`));
      if ((i + 1) % 25 === 0) console.log(`change notes: ${i + 1}/${items.length}`);
      await sleep(400);
    }
  }
  items.sort((a, b) => a.id.localeCompare(b.id));
  const src = `steamcommunity.com/workshop/browse/?appid=${APP} (ready-to-use items)` + (process.argv.includes("--versions") ? " + change notes" : "");
  fs.writeFileSync(out, `{\n  "source": ${JSON.stringify(src)},\n  "fetched": ${JSON.stringify(new Date().toISOString().slice(0, 10))},\n  "items": [\n` +
    items.map((it) => "    " + JSON.stringify(it)).join(",\n") + "\n  ]\n}\n");
  console.log(`src/workshop.json: ${items.length} items. Rebuild with node tools/build.cjs`);
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { parseListing, parseChangelog, decode };
