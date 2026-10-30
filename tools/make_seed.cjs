"use strict";
// Rebuilds src/seed.json (mod id -> [Workshop id, name]) from folders of Workshop item copies,
// each item in a subfolder named by its Workshop id with a modinfo.json inside, e.g.
//   node tools/make_seed.cjs "E:\Modding\Sandustry\references\workshop-mods\last-used" "...\interesting-mods"
// or Steam's own "steamapps\workshop\content\2764460". Existing entries are kept unless a folder
// gives the same mod id.
const fs = require("node:fs"), path = require("node:path");
const out = path.join(__dirname, "..", "src", "seed.json");
const seed = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : {};
let added = 0;
for (const root of process.argv.slice(2)) {
  for (const item of fs.readdirSync(root)) {
    if (!/^\d{6,20}$/.test(item)) continue;
    const file = path.join(root, item, "modinfo.json");
    if (!fs.existsSync(file)) continue;
    try {
      const m = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
      if (typeof m.id !== "string" || !m.id) continue;
      seed[m.id] = [item, String(m.name || m.id).trim()];
      added++;
    } catch (e) { console.warn("skipped " + file + ": " + e.message); }
  }
}
const ids = Object.keys(seed).sort((a, b) => a.localeCompare(b));
fs.writeFileSync(out, "{\n" + ids.map((id) => "  " + JSON.stringify(id) + ": " + JSON.stringify(seed[id])).join(",\n") + "\n}\n");
console.log(`seed.json: ${ids.length} mods (${added} read from folders)`);
