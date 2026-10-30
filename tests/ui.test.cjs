"use strict";
// Drives the built mod/main.js in Chromium inside a fake game page (tests/harness): Sync Mods in the
// main menu, the status in the Load window, the sync window, and the check when a save loads. Needs Playwright:
//   npm i -D playwright  (or set PLAYWRIGHT_MODULE to an installed copy)
// SHOTS=<dir> saves screenshots.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
let pw;
try { pw = require(process.env.PLAYWRIGHT_MODULE || "playwright"); } catch (e) { pw = null; }
const saves = require("./fixtures/saves.json");
const SELF = "asekhan.modsync", RT = "__sandkitExternalRuntimeV1";
const root = path.join(__dirname, "..");

// What runs "now" in every scenario: most of Test World B's mods, plus Atomic Age, plus local dev mods.
const LOADED = [
  ["cooper.common-sense-patches", "1.4.7", "3787416006"], ["darkluke1111.dark-tools", "0.5.0", "3786928338"],
  ["eierschaukel.smoothrun", "1.2.0", "3788382408"], ["jojo5.betterVacuum", "1.4.10", "3793382676"],
  ["karasko.advanced-logic", "1.1.6", "3794915012"], ["laser-overcharge", "2.0.0", "3782896614"],
  ["matt.wired-fluids", "1.0.0", "3785225389"], ["md-player-statistic", "0.1.0", "3812519274"],
  ["moprala-filterlabels", "0.2.0", "3800984683"], ["sand-foundry", "0.2.1", "3800875300"],
  ["thatsmaik.day-night", "1.1.0", "3796826248"], ["trim.infinite-factory", "1.0.1", "3783114793"],
  ["uolkx.mod-inspector", "0.3.0", "3783397350"], ["uolkx.power-monitor", "0.1.1", "3783239581"],
  ["sandustry-labs.red-sand-production", "0.1.7", "3788826976"], ["sandustry-labs.t2-machinery", "1.2.28", "3789171920"],
  ["sandustry-labs.better-strataform", "0.1.8", "3789171889"], ["sandustry-labs.gold-buffer-logistics", "0.1.6", "3791061726"],
  ["sorahn.sandustry-splitter", "0.1.3", "3792208028"], ["uolkx.atomic-age", "0.1.0", "3784544373"],
  ["overburden.probes", "0.2.0", null, "local"], ["asekhan.overburden", "0.1.1", null, "local"],
  ["overburden.testmap", "0.5.0", null, "local"], ["asekhan.cartographer", "0.1.0", null, "local"], [SELF, "0.1.0", null, "local"],
];
const DIAG = [
  { code: "incompatible_game_version", modId: "quickbars", message: "Requires game 0.5.7 or newer", workshop: { itemId: "3800000001" } },
  { code: "workshop_folder_unreadable", modId: "sirmonkz.decoration_expanded", message: "Cannot read Workshop item folder", workshop: { itemId: "3800000002" } },
];
const subscribedNow = LOADED.filter((m) => m[2]).map((m) => m[2]).concat(["3800000001", "3800000002"]);
const tidyMods = { [RT]: { version: 1, order: LOADED.map(([id, version]) => ({ id, version })) } };

// The live store of a world being loaded: the game has merged the save's order with the current mods.
function loadingStore(saveMods, bag) {
  const order = saveMods[RT].order.slice(), have = new Set(order.map((e) => e.id));
  for (const [id, version] of LOADED) if (!have.has(id)) order.push({ id, version });
  return Object.assign({ [RT]: { version: 1, order } }, bag ? { [SELF]: bag } : {});
}
const header = (id, worldId, worldName, ts, name) => ({ id, worldId, worldName, timestamp: ts, name, playTime: 1 });
const SAVES = [
  { header: header("testworld02-autosave-3", "testworld02", "Test World B", "2026-10-23T01:42:35.113Z", "Autosave 3 (Test World B)"), mods: saves.worldB.mods },
  { header: header("testworld01-exitsave", "testworld01", "Test World A", "2026-10-17T03:53:41.451Z", "Exit Save"), mods: saves.worldA.mods },
  { header: header("tidy-quicksave", "tidy", "Tidy", "2026-10-22T03:00:00.000Z", "Quick Save"), mods: tidyMods },
];
const SCENARIOS = {
  gate: { world: { worldId: "testworld02", worldName: "Test World B", mods: loadingStore(saves.worldB.mods, null) } },
  gateKnown: { world: { worldId: "testworld02", worldName: "Test World B", mods: loadingStore(saves.worldB.mods, { known: saves.worldB.mods[RT].order.map((e) => e.id) }) } },
  inSync: { world: { worldId: "tidy", worldName: "Tidy", mods: loadingStore(tidyMods, null) } },
  menu: { world: { worldId: "menu", worldName: "Main menu", mods: null }, lastPlayed: "testworld02-autosave-3" },
  menuSlow: { world: { worldId: "menu", worldName: "Main menu", mods: null }, slow: true },
};
for (const s of Object.values(SCENARIOS)) Object.assign(s, { saves: SAVES, loaded: LOADED, diagnostics: DIAG, subscribed: subscribedNow,
  installed: subscribedNow.filter((x) => x !== "3800000002"), names: { "uolkx.atomic-age": "Atomic Age" }, downloadMs: s.slow ? 20000 : 900 });

let server, base, current = null, browser;
const skip = pw ? false : "playwright not installed";
test.before(async () => {
  server = http.createServer((req, res) => {
    const file = new URL(req.url, "http://x").pathname.slice(1) || "index.html";
    if (file === "scenario.js") { res.end("window.SCENARIO = " + JSON.stringify(SCENARIOS[current]) + ";"); return; }
    const p = file === "main.js" ? path.join(root, "mod", "main.js") : path.join(__dirname, "harness", path.basename(file));
    if (!fs.existsSync(p)) { res.statusCode = 404; res.end(); return; }
    res.setHeader("content-type", p.endsWith(".html") ? "text/html" : "text/javascript");
    res.end(fs.readFileSync(p));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}/`;
  if (pw) browser = await pw.chromium.launch();
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

async function open(scenario, query) {
  current = scenario;
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(base + (query || ""));
  return page;
}
const shot = async (page, name) => { if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, name + ".png") }); };
const calls = (page, kind) => page.evaluate((k) => window.calls.filter((c) => c[0] === k).map((c) => c[1]), kind);
const field = (page) => page.textContent(".ms-field");

const dlg = (page) => page.textContent(".ms-dlg");
const row = (page, id) => page.locator(`.ms-row:has(.ms-name[title="${id}"])`);
const mem = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("asekhan.modsync.v2")));
const AMBER = "testworld02-autosave-3";

test("Sync Mods in the main menu: status, choices, sync, then the save opens after the restart", { skip }, async () => {
  const page = await open("menu", "");
  await page.waitForFunction(() => window.entryFinished === true);
  await page.evaluate(() => window.openMenu());
  // Piston and Mixed Grab by title, Nanobot from the built-in list, Decoration Expanded subscribed
  // without files; quickbars is refused by the game, Diagonal Conveyors isn't a sure title match.
  await page.waitForFunction(() => document.querySelector("[data-id='main-menu-sync-mods'] .ms-badge")?.textContent === "6");
  await shot(page, "1-menu");

  await page.click("[data-id='main-menu-sync-mods']");
  await page.waitForSelector("text=Ready to download (4)");
  const text = await dlg(page);
  assert.match(text, /Sync mods with save.*Test World B · Autosave 3/);
  assert.match(text, /▸ Correct \(\d+\)Not in save \(1\).*Ready to download \(4\).*Can't download \(2\)/, "Correct folded to one line");
  await page.click("text=Correct (");
  assert.equal(await page.locator(".ms-grid").count(), 1);
  assert.equal(await row(page, "uolkx.atomic-age").locator("input").isChecked(), false, "syncing drops mods the save doesn't have, unless kept");
  assert.equal(await row(page, "jojo5.mixedgrab").locator("input").isChecked(), true);
  assert.equal(await page.locator(".ms-confirm").getAttribute("title"), "download 4, unsubscribe 1");
  assert.equal(await page.getByLabel("Load save after sync").isChecked(), true);
  await shot(page, "2-window");

  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press("Enter");
  assert.deepEqual(await calls(page, "gameKey"), [], "keys don't reach the game under the window");

  // pick the Workshop item for the unmatched mod, leave Mixed Grab out; Atomic Age goes by default
  await page.locator(".ms-opt").getByRole("button", { name: "Use" }).first().click();
  await page.waitForSelector("text=Ready to download (5)");
  assert.match(await dlg(page), /local\.diagonal-foerderbaender.*3797382930 · your pick/);
  await row(page, "jojo5.mixedgrab").locator("input").uncheck();
  await row(page, "uolkx.atomic-age").locator("input").check();
  assert.equal(await page.locator(".ms-confirm").getAttribute("title"), "download 4");
  await row(page, "uolkx.atomic-age").locator("input").uncheck();
  assert.equal(await page.locator(".ms-confirm").getAttribute("title"), "download 4, unsubscribe 1");
  await shot(page, "3-choices");

  await page.click(".ms-confirm");
  await page.waitForSelector("text=Done.");
  assert.match(await dlg(page), /100%.*Currently downloading: nothing/);
  assert.match(await dlg(page), /restart it and this save opens by itself/);
  assert.deepEqual((await calls(page, "subscribe")).sort(), ["3793038294", "3797382930", "3822112130"]);
  assert.deepEqual(await calls(page, "unsubscribe"), ["3784544373"]);
  assert.ok((await calls(page, "download")).includes("3800000002"), "a subscribed mod without files is downloaded");
  assert.deepEqual(await calls(page, "lastPlayed"), [AMBER]);
  assert.equal((await mem(page)).autoload.saveId, AMBER);
  await shot(page, "4-done");
  assert.deepEqual(page.errors, []);

  // "restart": the next start opens the save once
  await page.goto(base);
  await page.waitForURL(new RegExp("db_load=" + AMBER), { timeout: 5000 });
  await page.waitForFunction(() => window.entryFinished === true);
  assert.equal((await mem(page)).autoload, null);
  await page.close();
});

test("Load window: status, Esc, and cancelling a sync", { skip }, async () => {
  const page = await open("menuSlow", "");
  await page.waitForFunction(() => window.entryFinished === true);
  await page.evaluate(() => window.openLoader());
  // nothing selected: the first save shown is checked right away
  await page.waitForFunction(() => /Not in sync/.test(document.querySelector(".ms-field")?.textContent));
  assert.equal(await field(page), "Mod syncAutosave 3 (Test World B)Not in sync4 ready to download2 can't be downloadedSync…", "a mod added since the save isn't mentioned");

  await page.click("[data-save='tidy-quicksave']");
  await page.waitForFunction(() => /In sync/.test(document.querySelector(".ms-field").textContent));
  assert.equal(await field(page), "Mod syncQuick Save✓ In syncSync…");

  await page.click(`[data-save='${AMBER}']`);
  await page.waitForFunction(() => /Not in sync/.test(document.querySelector(".ms-field").textContent));
  await shot(page, "5-load-window");

  await page.click(".ms-field button");
  await page.waitForSelector(".ms-dlg");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".ms-veil").count(), 0, "Esc closes the window");
  assert.deepEqual(await calls(page, "gameKey"), [], "and only the window");

  await page.click(".ms-field button");
  await page.getByLabel("Load save after sync").uncheck();
  await page.click(".ms-confirm");
  await page.waitForSelector("text=/Currently downloading: .+ · \\d+%/");
  await shot(page, "6-downloading");
  assert.equal(await page.locator(".ms-dlg button", { hasText: "Back" }).isDisabled(), true);
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.waitForSelector("text=Cancelled.");
  assert.equal((await mem(page)).autoload, null);
  await page.getByRole("button", { name: "Back" }).click();
  assert.equal(await field(page), "Mod syncAutosave 3 (Test World B)Sync cancelledRestart to applyQuit game");
  await page.click(".ms-field button");
  assert.equal((await calls(page, "quit")).length, 1);
  assert.deepEqual((await calls(page, "load")).sort(), [AMBER, "tidy-quicksave"], "each save read once");
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("syncing a save that matches: nothing to change, no way to load from here", { skip }, async () => {
  const page = await open("menuSlow", "");
  await page.waitForFunction(() => window.entryFinished === true);
  await page.evaluate(() => window.openLoader());
  await page.waitForSelector(".ms-field");
  await page.click("[data-save='tidy-quicksave']");
  await page.waitForFunction(() => /In sync/.test(document.querySelector(".ms-field").textContent));
  await page.click(".ms-field button");
  const text = await dlg(page);
  assert.match(text, new RegExp(`▾ Correct \\(${LOADED.length - 1}\\)`), "open when it's all there is");
  assert.doesNotMatch(text, /Ready to download|Can't download|Not in save|Load save after sync|Currently downloading/);
  assert.match(text, /Nothing to change: your mods match this save\./);
  assert.equal(await page.getByRole("button", { name: "Confirm" }).count(), 0);
  await shot(page, "8-nothing-to-change");
  await page.getByRole("button", { name: "Close" }).click();
  assert.equal(await page.locator(".ms-veil").count(), 0);
  assert.ok(!page.url().includes("db_load"));
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("a save recorded while it was written needs no read", { skip }, async () => {
  const page = await open("menuSlow", "");
  await page.waitForFunction(() => window.entryFinished === true);
  await page.evaluate(() => localStorage.setItem("asekhan.modsync.v2", JSON.stringify({ catalog: {}, saves: {
    "testworld01-exitsave": { order: [{ id: "laser-overcharge", version: "2.0.0" }, { id: "jojo5.compressor", version: "1.3.0" }], items: {}, local: [], known: null, savedAt: Date.parse("2026-10-17T03:53:35.000Z") } } })));
  await page.reload();
  await page.waitForFunction(() => window.entryFinished === true);
  await page.evaluate(() => window.openLoader());
  await page.waitForSelector(".ms-field");
  await page.click("[data-save='testworld01-exitsave']");
  await page.waitForFunction(() => /Exit Save.*Not in sync/.test(document.querySelector(".ms-field").textContent));
  assert.ok(!(await calls(page, "load")).includes("testworld01-exitsave"));
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("loading a save with missing mods stops; sync then quit", { skip }, async () => {
  const page = await open("gate", "?db_load=" + AMBER);
  await page.waitForSelector("text=Can't download (2)");
  assert.equal(await page.evaluate(() => !!window.entryFinished), false, "world init is held");
  const text = await dlg(page);
  assert.match(text, /This save's mods aren't all loaded.*Test World B/);
  assert.match(text, /quickbars.*the game refuses it: Requires game 0\.5\.7/);
  assert.doesNotMatch(text, /Not in save/, "unknown before this mod has saved the world once");
  await shot(page, "7-gate");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".ms-veil").count(), 1, "Esc doesn't dismiss the check");
  await page.click(".ms-confirm");
  await page.waitForSelector("text=Done.");
  await page.getByRole("button", { name: "Quit game" }).click();
  assert.deepEqual((await calls(page, "subscribe")).sort(), ["3793038294", "3816289584", "3822112130"]);
  assert.equal((await calls(page, "quit")).length, 1);
  assert.equal(await page.evaluate(() => !!window.entryFinished), false, "the world never ran");
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("on load, this PC's copy of the save's list tells the save's mods from the new ones", { skip }, async () => {
  const page = await open("gate", "");
  await page.waitForFunction(() => window.entryFinished === true);
  await page.evaluate(([order, ts]) => localStorage.setItem("asekhan.modsync.v2", JSON.stringify({ catalog: {}, saves: {
    "testworld02-autosave-3": { order, items: {}, local: [], known: null, readTs: ts } } })), [saves.worldB.mods[RT].order, SAVES[0].header.timestamp]);
  await page.goto(base + "?db_load=" + AMBER);
  await page.waitForSelector(".ms-dlg");
  assert.match(await dlg(page), /Not in save \(1\)Atomic Age/);
  assert.equal(await row(page, "uolkx.atomic-age").locator("input").isChecked(), true, "on load, mods added since the save are kept");
  assert.equal(await page.locator(".ms-confirm").getAttribute("title"), "download 4");
  await page.click("text=Correct (");
  assert.doesNotMatch(await page.textContent(".ms-grid"), /Atomic Age/);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("load anyway, then the next save records the world", { skip }, async () => {
  const page = await open("gateKnown", "?db_load=" + AMBER);
  await page.waitForSelector(".ms-dlg");
  assert.match(await dlg(page), /Not in save \(1\)Atomic Age/);
  await page.getByRole("button", { name: "Load anyway" }).click();
  await page.waitForFunction(() => window.entryFinished === true);
  assert.equal(await page.locator(".ms-veil").count(), 0);
  await page.evaluate(() => window.fireSave("testworld02-autosave-1"));
  const bag = await page.evaluate(() => window.sandkit.state.store.mods["asekhan.modsync"]);
  assert.equal(bag.items["uolkx.atomic-age"], "3784544373");
  assert.ok(bag.mods.some((e) => e.id === "uolkx.atomic-age"), "the save now needs what was loaded");
  assert.ok(!bag.mods.some((e) => e.id === "1stpo.piston"), "and no longer the mods that were missing");
  assert.ok(bag.local.includes("asekhan.cartographer"));
  assert.ok((await mem(page)).saves["testworld02-autosave-1"].savedAt > 0);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("a save in sync loads straight through", { skip }, async () => {
  const page = await open("inSync", "?db_load=tidy-quicksave");
  await page.waitForFunction(() => window.entryFinished === true);
  assert.equal(await page.locator(".ms-veil").count(), 0);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("clicking through the Load window reads only the save that stays selected", { skip }, async () => {
  const page = await open("menuSlow", "");
  await page.waitForFunction(() => window.entryFinished === true);
  await page.evaluate(() => window.openLoader());
  await page.waitForSelector(".ms-field");
  await page.click("[data-save='testworld01-exitsave']");
  await page.click("[data-save='tidy-quicksave']");
  await page.click(`[data-save='${AMBER}']`);
  await page.waitForFunction(() => /Not in sync/.test(document.querySelector(".ms-field").textContent));
  assert.deepEqual(await calls(page, "load"), [AMBER]);
  assert.deepEqual(page.errors, []);
  await page.close();
});
