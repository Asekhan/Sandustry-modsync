"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../src/logic.js");
const saves = require("./fixtures/saves.json");
const seed = require("../src/seed.json");
const table = require("../src/workshop.json");

// A discovery result shaped like workshop.getSandkitMods().data.
function discovery(mods, diagnostics) {
  return {
    mods: mods.map(([id, version, itemId, via, deps]) => ({
      manifest: { id, name: id.toUpperCase(), version, dependencies: deps || [] },
      workshop: { itemId: itemId || null, folder: "x", discoveredVia: [via || (itemId ? "subscribed" : "local")] },
    })),
    diagnostics: diagnostics || [],
  };
}
const order = (...ids) => ({ __sandkitExternalRuntimeV1: { version: 1, order: ids.map((id) => ({ id, version: "1" })) } });

test("reads the game's own mod record from a real save", () => {
  const w = L.readSaveMods(saves.worldA.mods);
  assert.equal(w.order.length, 34);
  assert.deepEqual(w.order[0], { id: "sandustry.mod-manager", version: "1.0.0" });
  assert.equal(w.known, null, "no bag before this mod ran");
  assert.deepEqual(L.readSaveMods(null).order, []);
  assert.deepEqual(L.readSaveMods({ __sandkitExternalRuntimeV1: { version: 2, order: [{ id: "a", version: "1" }] } }).order, [], "unknown bag version is ignored");
});

test("in sync, missing, extra, and every missing status", () => {
  const world = L.readSaveMods(Object.assign(order("a", "b", "c", "d", "e", "loc", "nobody", L.SELF_ID), { [L.SELF_ID]: { items: { b: "1000000002" }, local: ["loc"] } }));
  const live = L.readLive(
    discovery([["a", "1", "1000000001"], ["x", "1", "1000000009"], ["y", "1", null, "local"], [L.SELF_ID, "1", null, "local"]]),
    ["1000000001", "1000000009", "1000000003", "1000000004", "1000000005"], []);
  live.failed.set("c", { id: "c", itemId: "1000000003", code: "workshop_folder_unreadable", message: "no folder" });
  live.failed.set("d", { id: "d", itemId: "1000000004", code: "incompatible_game_version", message: "needs 0.6" });
  const cmp = L.compare(world, live, { catalog: { e: { itemId: "1000000005", name: "Eee" } } });
  assert.deepEqual(Object.fromEntries(cmp.missing.map((r) => [r.id, r.status])),
    { b: "get", c: "download", d: "failing", e: "download", loc: "local", nobody: "unknown" });
  assert.deepEqual(cmp.extra.map((x) => [x.id, x.canUnsubscribe]), [["x", true], ["y", false]]);
  assert.equal(cmp.inSync, false);
  assert.deepEqual(L.plan(cmp), { subscribe: ["1000000002"], download: ["1000000003", "1000000005"], unsubscribe: [], count: 3 }, "new mods stay by default");
  assert.deepEqual(L.plan(cmp, { skip: new Set(["b"]), unsub: new Set(["x", "y"]) }), { subscribe: [], download: ["1000000003", "1000000005"], unsubscribe: ["1000000009"], count: 3 });

  const newer = L.compare(L.readSaveMods(order("a", "y")), live, {});
  assert.equal(newer.inSync, true, "a mod new since the save doesn't break sync");
  assert.deepEqual(newer.removable.map((x) => x.id), ["x"]);
  assert.equal(L.plan(newer).count, 0);
});

test("a dependency of a save's mod is never an extra", () => {
  const live = L.readLive(discovery([["a", "1", "1000000001", "subscribed", ["lib"]], ["lib", "1", "1000000002"]]), ["1000000001", "1000000002"], []);
  const cmp = L.compare(L.readSaveMods(order("a")), live, {});
  assert.deepEqual(cmp.extra, []);
  assert.equal(cmp.inSync, true);
});

test("in a loading world, extras come from this mod's own list, not the game's merged order", () => {
  const mods = order("a", "new");
  const live = L.readLive(discovery([["a", "1", "1000000001"], ["new", "1", "1000000002"]]), ["1000000001", "1000000002"], []);
  assert.equal(L.compare(L.readSaveMods(mods), live, { inWorld: true }).extra, null, "unknown before the first save");
  mods[L.SELF_ID] = { known: ["a"] };
  assert.deepEqual(L.compare(L.readSaveMods(mods), live, { inWorld: true }).extra.map((x) => x.id), ["new"]);
});

test("resolution order: subscribed > save > seen > seed > title", () => {
  const live = { failed: new Map(), pairs: [] };
  const ctx = { catalog: { m: { itemId: "1000000004" } }, seed: { m: ["1000000005", "M"] } };
  assert.equal(L.resolve("m", "1", { items: { m: "1000000003" } }, live, ctx).source, "save");
  assert.equal(L.resolve("m", "1", { items: {} }, live, ctx).source, "seen");
  assert.equal(L.resolve("m", "1", { items: {} }, live, { seed: ctx.seed }).name, "M");
  live.failed.set("m", { itemId: "1000000001" });
  assert.equal(L.resolve("m", "1", { items: { m: "1000000003" } }, live, ctx).itemId, "1000000001");
  assert.equal(L.resolve("jojo5.mixedgrab", "0.1.0", { items: {} }, { failed: new Map(), pairs: [] }, { seed, workshop: table }).source, "title");
  assert.equal(L.resolve("m", "1", { items: {} }, { failed: new Map(), pairs: [] }, Object.assign({ picks: { m: { itemId: "1000000006" } } }, ctx)).source, "picked", "your pick beats this PC's memory");
});

test("an unmatched mod comes with the closest Workshop titles to choose from", () => {
  const world = L.readSaveMods(order("brent.factory-diagnostics", "vacuum-tank-cycle", "zz.nothing-like-it"));
  const live = L.readLive(discovery([]), [], []);
  const cmp = L.compare(world, live, { seed, workshop: table });
  const by = Object.fromEntries(cmp.missing.map((r) => [r.id, r]));
  assert.equal(by["brent.factory-diagnostics"].status, "unknown");
  assert.equal(by["brent.factory-diagnostics"].suggest[0].title, "Factory Diagnostics Pack");
  assert.equal(by["vacuum-tank-cycle"].suggest[0].title, "Vacuum Tank Hotkeys");
  assert.deepEqual(by["zz.nothing-like-it"].suggest, []);
  const picked = L.compare(world, live, { seed, workshop: table, picks: { "brent.factory-diagnostics": { itemId: "3792437322", name: "Factory Diagnostics Pack" } } });
  assert.equal(picked.missing[0].status, "get");
  assert.equal(picked.missing[0].name, "Factory Diagnostics Pack");
});

test("the catalog learns from loaded mods, diagnostics and published local mods", () => {
  const live = L.readLive(
    { mods: discovery([["a", "1", "1000000001"]]).mods, diagnostics: [{ code: "x", modId: "b", workshop: { itemId: "1000000002" } }] },
    [], [{ id: "c", name: "C", publishedFileId: "1000000003" }]);
  assert.deepEqual(L.mergeCatalog({ b: { itemId: "1000000002", name: "Bee" } }, live.pairs),
    { a: { itemId: "1000000001", name: "A" }, b: { itemId: "1000000002", name: "Bee" }, c: { itemId: "1000000003", name: "C" } });
});

test("a cached mod list fits only the save file it came from", () => {
  const h = { id: "w-exitsave", timestamp: "2026-10-21T10:00:00.000Z" }, ts = Date.parse(h.timestamp);
  assert.ok(L.recordFresh({ readTs: h.timestamp }, h));
  assert.ok(!L.recordFresh({ readTs: "2026-10-20T10:00:00.000Z" }, h));
  assert.ok(L.recordFresh({ savedAt: ts - 8000 }, h), "recorded by store:save just before the write");
  assert.ok(!L.recordFresh({ savedAt: ts - 3600e3 }, h), "an older recording of the same slot");
});

test("the bag written on save carries Workshop ids, local mods and the mod list", () => {
  const world = L.readSaveMods(Object.assign(order("a", "loc"), { [L.SELF_ID]: { items: { gone: "1000000009" } } }));
  const live = L.readLive(discovery([["a", "2", "1000000001"], ["loc", "1", null, "local"]]), [], []);
  const bag = L.bagFor(world, live, { items: { gone: "1000000009" } });
  assert.deepEqual(bag, { v: 2, items: { gone: "1000000009", a: "1000000001" }, local: ["loc"], mods: [{ id: "a", version: "2" }, { id: "loc", version: "1" }] });
  assert.deepEqual(L.readSaveMods({ [L.SELF_ID]: bag }).known, ["a", "loc"]);
});

test("a save needs the mods loaded when it was written, not every mod it ever had", () => {
  // played with a, b and c; b dropped, then saved with this mod: b isn't needed anymore
  const live = L.readLive(discovery([["a", "1", "1000000001"], ["c", "1", "1000000003"], ["d", "1", "1000000004"]]), ["1000000001", "1000000003", "1000000004"], []);
  const inWorld = L.readSaveMods(order("a", "b", "c", "d"));
  const bag = L.bagFor(inWorld, live, null);
  assert.deepEqual(bag.mods.map((e) => e.id), ["a", "c", "d"]);
  const saved = Object.assign(order("a", "b", "c", "d"), { [L.SELF_ID]: bag });
  const cmp = L.compare(L.readSaveMods(saved), live, {});
  assert.equal(cmp.inSync, true);
  assert.deepEqual(cmp.extra, []);
  // later, without c: c is missing, b still isn't
  const later = L.readLive(discovery([["a", "1", "1000000001"], ["d", "1", "1000000004"]]), ["1000000001", "1000000004"], []);
  assert.deepEqual(L.compare(L.readSaveMods(saved), later, { inWorld: true }).missing.map((r) => r.id), ["c"]);
  // a save from before this mod still needs its whole history
  assert.deepEqual(L.compare(L.readSaveMods(order("a", "b")), live, {}).missing.map((r) => r.id), ["b"]);
});

// ---------- Workshop title matching ----------
const seedOwned = (except) => new Map(Object.entries(seed).filter(([id]) => id !== except).map(([id, s]) => [s[0], id]));

test("title matching never picks a wrong item (41 mods with known Workshop ids)", () => {
  let found = 0;
  for (const [id, [itemId]] of Object.entries(seed)) {
    const m = L.matchWorkshop(id, null, table, seedOwned(id));
    if (m) { found++; assert.equal(m.itemId, itemId, id); }
  }
  assert.ok(found >= 25, `only ${found} matches`);
});

test("the unresolved mods of the real saves match their real Workshop items", () => {
  // Real ids, confirmed by a save the game wrote with these mods subscribed.
  for (const [id, item] of [["1stpo.piston", "3822112130"], ["jojo5.mixedgrab", "3816289584"], ["quickbars", "3784657908"],
    ["sirmonkz.decoration_expanded", "3788112728"], ["paragax.enable-achievements", "3789619665"], ["shander.filtered-launcher", "3799721620"]]) {
    const m = L.matchWorkshop(id, null, table, seedOwned(null));
    assert.equal(m && m.itemId, item, id);
  }
  assert.equal(L.matchWorkshop("brent.factory-diagnostics", "1.0.0", table, seedOwned(null)), null, "Factory Diagnostics Pack is too unsure");
  const withNotes = { items: table.items.map((it) => (it.id === "3792437322" ? Object.assign({}, it, { versions: ["1.0.0"] }) : it)) };
  assert.equal(L.matchWorkshop("brent.factory-diagnostics", "1.0.0", withNotes, seedOwned(null)).itemId, "3792437322", "the version in the change notes settles it");
  assert.equal(L.matchWorkshop("laser-overcharge", null, table, new Map()), null, "a mod and its translation tie");
  assert.equal(L.matchWorkshop("jojo5.mixedgrab", null, table, new Map([["3816289584", "someone.else"]])), null, "an item known to hold another mod is skipped");
});

test("the catalog tool parses Workshop listing and change-note markup", () => {
  const { parseListing, parseChangelog } = require("../tools/workshop_catalog.cjs");
  const item = (id, title, author) => `<div class="workshopItem"><a href="https://steamcommunity.com/sharedfiles/filedetails/?id=${id}&searchtext=" class="ugc" data-appid="2764460" data-publishedfileid="${id}"><div class="workshopItemPreviewHolder"></div></a>` +
    `<a href="https://steamcommunity.com/sharedfiles/filedetails/?id=${id}"><div class="workshopItemTitle ellipsis">${title}</div></a>` +
    `<div class="workshopItemAuthorName ellipsis">by&nbsp;<a class="workshop_author_link" href="https://steamcommunity.com/id/x/myworkshopfiles/?appid=2764460">${author}</a></div></div>`;
  const page = `<div class="workshopBrowsePagingInfo">Showing 1-2 of 265 entries</div>` + item("3816289584", "Mixed Grab", "Shikkaku") + item("3796826248", "Day &amp; Night", "thatsmaik");
  assert.deepEqual(parseListing(page), { items: [{ id: "3816289584", title: "Mixed Grab", author: "Shikkaku" }, { id: "3796826248", title: "Day & Night", author: "thatsmaik" }], total: 265 });
  const notes = `<div class="detailBox workshopAnnouncement noFooter changeLogCtn"><div class="headline">Update: Oct 3 @ 10:25am</div><p id="1">0.1.7</p></div>` +
    `<div class="detailBox workshopAnnouncement noFooter changeLogCtn"><div class="headline">Update: Sep 30</div><p id="2">v0.1.6 - fixes</p></div>`;
  assert.deepEqual(parseChangelog(notes), ["0.1.7", "0.1.6"]);
});
