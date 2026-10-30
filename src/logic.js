// Pure logic: no DOM, no game state, no Steam. The mod and the tests both use it.
const ModSyncLogic = (() => {
  const SELF_ID = "asekhan.modsync";
  const RUNTIME_BAG = "__sandkitExternalRuntimeV1";
  // Steam EItemState bits, as returned by workshop.getState.
  const STATE = { SUBSCRIBED: 1, INSTALLED: 4, NEEDS_UPDATE: 8, DOWNLOADING: 16, DOWNLOAD_PENDING: 32 };
  // Loader codes meaning "subscribed, but the files aren't there yet".
  const NOT_DOWNLOADED = new Set(["workshop_folder_unreadable", "manifest_missing", "manifest_unreadable"]);

  const isStr = (v) => typeof v === "string" && v.length > 0;
  const isItemId = (v) => /^\d{6,20}$/.test(String(v == null ? "" : v));
  const uniq = (a) => [...new Set(a)];

  function cleanItems(v) {
    const out = {};
    if (v && typeof v === "object") for (const k of Object.keys(v)) if (isStr(k) && isItemId(v[k])) out[k] = String(v[k]);
    return out;
  }

  // What a save says about its mods. `mods` is `store.mods` of a save file or of the live store.
  //  order: the mods the save needs. With this mod's bag: the mods loaded when it was written.
  //         Without: the game's own record, every mod the world was ever played with.
  //  history: the game's own record, always
  //  items: mod id -> Workshop id, written by this mod on every save
  //  local: mod ids that were local mods (mods folder), written by this mod
  //  known: the ids in the bag's mod list (null when the save has no bag yet)
  function readSaveMods(mods) {
    mods = mods && typeof mods === "object" ? mods : {};
    const rt = mods[RUNTIME_BAG], order = [], seen = new Set();
    if (rt && rt.version === 1 && Array.isArray(rt.order)) {
      for (const e of rt.order) {
        if (!e || !isStr(e.id) || seen.has(e.id)) continue;
        seen.add(e.id);
        order.push({ id: e.id, version: typeof e.version === "string" ? e.version : "" });
      }
    }
    const bag = mods[SELF_ID] && typeof mods[SELF_ID] === "object" ? mods[SELF_ID] : {};
    const strs = (v) => (Array.isArray(v) ? v.filter(isStr) : []);
    const base = { history: order, items: cleanItems(bag.items), local: strs(bag.local) };
    if (Array.isArray(bag.mods)) {
      const saved = [], ids = new Set();
      for (const e of bag.mods) if (e && isStr(e.id) && !ids.has(e.id)) { ids.add(e.id); saved.push({ id: e.id, version: isStr(e.version) ? e.version : "" }); }
      return Object.assign(base, { order: saved, known: saved.map((e) => e.id) });
    }
    // bags from 0.1/0.2 kept the game's whole list as `known`
    return Object.assign(base, { order, known: Array.isArray(bag.known) ? strs(bag.known) : null });
  }

  // What runs in this launch.
  //  discovery: workshop.getSandkitMods().data  ({mods, diagnostics})
  //  subscribed: workshop.getSubscribedItems().data  (item ids)
  //  localList: localMods.list().data  ([{id, name, publishedFileId}])
  function readLive(discovery, subscribed, localList) {
    const loaded = new Map(), failed = new Map(), pairs = [];
    for (const r of (discovery && discovery.mods) || []) {
      const m = r && r.manifest;
      if (!m || !isStr(m.id)) continue;
      const w = r.workshop || {}, via = Array.isArray(w.discoveredVia) ? w.discoveredVia : [];
      const itemId = isItemId(w.itemId) ? String(w.itemId) : null;
      loaded.set(m.id, { id: m.id, name: isStr(m.name) ? m.name : m.id, version: isStr(m.version) ? m.version : "",
        itemId, local: via.includes("local"), deps: Array.isArray(m.dependencies) ? m.dependencies.filter(isStr) : [] });
      if (itemId) pairs.push([m.id, itemId, m.name]);
    }
    for (const d of (discovery && discovery.diagnostics) || []) {
      if (!d || !isStr(d.modId)) continue;
      const itemId = d.workshop && isItemId(d.workshop.itemId) ? String(d.workshop.itemId) : null;
      if (itemId) pairs.push([d.modId, itemId, null]);
      if (!loaded.has(d.modId) && !failed.has(d.modId)) failed.set(d.modId, { id: d.modId, itemId, code: d.code || "", message: d.message || "" });
    }
    for (const l of localList || []) if (l && isStr(l.id) && isItemId(l.publishedFileId)) pairs.push([l.id, String(l.publishedFileId), l.name]);
    const subs = new Set();
    for (const s of subscribed || []) if (isItemId(s)) subs.add(String(s));
    return { loaded, failed, subscribed: subs, pairs };
  }

  // catalog: mod id -> {itemId, name}. Every pairing this PC has seen.
  function mergeCatalog(catalog, pairs) {
    const out = Object.assign({}, catalog || {});
    for (const [id, itemId, name] of pairs || []) {
      if (!isStr(id) || !isItemId(itemId)) continue;
      const prev = out[id];
      out[id] = { itemId: String(itemId), name: name || (prev && prev.itemId === String(itemId) ? prev.name : null) || null };
    }
    return out;
  }

  // ---------- matching a mod id against Workshop titles ----------
  // The Workshop never shows a mod's id; the game's uploader titles an item with the mod's name
  // and writes its version as the change note. So "sirmonkz.decoration_expanded" is matched to
  // the title "Decoration Expanded", the id prefix to the author, the save's version to the notes.
  const FOLD = { "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss" };
  function words(s) {
    return String(s || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().replace(/[äöüß]/g, (c) => FOLD[c])
      .normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
  }
  function similarity(a, b) { // 1 - Levenshtein distance / longer length
    if (a === b) return 1;
    if (!a || !b) return 0;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return 1 - prev[b.length] / Math.max(a.length, b.length);
  }
  function matchScore(modId, version, item) {
    const segs = modId.split("."), prefix = segs.length > 1 ? segs[0] : "";
    const iw = words(segs.length > 1 ? segs.slice(1).join(" ") : modId), tw = words(item.title);
    const ij = iw.join(""), tj = tw.join("");
    if (ij.length < 3 || !tj) return 0;
    let s;
    if (ij === tj) s = 1;
    else {
      const covered = iw.filter((w) => tw.includes(w) || (w.length >= 4 && tj.includes(w))).length / iw.length;
      const titleCovered = tw.filter((w) => ij.includes(w)).length / tw.length;
      const short = Math.min(ij.length, tj.length), long = Math.max(ij.length, tj.length);
      const contained = short >= 5 && (tj.includes(ij) || ij.includes(tj)) ? 0.1 + (0.9 * short) / long : 0;
      s = Math.max(covered * (0.6 + 0.4 * titleCovered), similarity(ij, tj), contained);
    }
    const p = words(prefix).join(""), au = words(item.author).join("");
    if (p.length >= 3 && au.length >= 3 && (au.includes(p) || p.includes(au))) s += 0.15;
    if (version && Array.isArray(item.versions) && item.versions.length) s += item.versions.includes(version) ? 0.2 : -0.1;
    return s;
  }
  // Workshop items ranked for a mod id (score ≥ 0.6, best first, at most 3).
  // `owned`: Workshop id -> mod id known to hold it (skipped).
  function suggestWorkshop(modId, version, table, owned) {
    const out = [];
    for (const it of (table && table.items) || []) {
      if (!isItemId(it.id) || (owned && owned.has(it.id) && owned.get(it.id) !== modId)) continue;
      const score = matchScore(modId, version, it);
      if (score >= 0.6) out.push({ itemId: it.id, title: it.title, author: it.author, score: Math.round(score * 100) / 100 });
    }
    return out.sort((a, b) => b.score - a.score || a.itemId.localeCompare(b.itemId)).slice(0, 3);
  }
  // The Workshop item a mod id most likely is, or null: only one clear winner counts
  // (score ≥ 0.95 and 0.1 ahead of the next).
  function matchWorkshop(modId, version, table, owned) {
    const [a, b] = suggestWorkshop(modId, version, table, owned);
    return a && a.score >= 0.95 && (!b || a.score - b.score >= 0.1) ? a : null;
  }
  const owned = (world, live, ctx) => ctx.owned || (ctx.owned = ownedItems(world, live, ctx));
  function ownedItems(world, live, ctx) {
    const owned = new Map();
    const add = (itemId, modId) => { if (isItemId(itemId) && !owned.has(String(itemId))) owned.set(String(itemId), modId); };
    for (const [modId, itemId] of live.pairs || []) add(itemId, modId);
    for (const [modId, itemId] of Object.entries(world.items || {})) add(itemId, modId);
    for (const [modId, p] of Object.entries(ctx.picks || {})) add(p && p.itemId, modId);
    for (const [modId, c] of Object.entries(ctx.catalog || {})) add(c && c.itemId, modId);
    for (const [modId, s] of Object.entries(ctx.seed || {})) add(s && s[0], modId);
    return owned;
  }

  // Workshop id for a mod id, best source first. ctx: {catalog, seed, workshop, picks}
  //  picks: mod id -> {itemId, name}, Workshop items the player chose for unmatched mods
  function resolve(id, version, world, live, ctx) {
    const f = live.failed.get(id);
    if (f && f.itemId) return { itemId: f.itemId, source: "subscribed" };
    if (isItemId(world.items[id])) return { itemId: world.items[id], source: "save" };
    const pk = ctx.picks && ctx.picks[id];
    if (pk && isItemId(pk.itemId)) return { itemId: pk.itemId, name: pk.name, source: "picked" };
    const c = ctx.catalog && ctx.catalog[id];
    if (c && isItemId(c.itemId)) return { itemId: c.itemId, name: c.name, source: "seen" };
    const s = ctx.seed && ctx.seed[id];
    if (s && isItemId(s[0])) return { itemId: s[0], name: s[1], source: "known" };
    if (ctx.workshop) {
      const m = matchWorkshop(id, version, ctx.workshop, owned(world, live, ctx));
      if (m) return { itemId: m.itemId, name: m.title, source: "title" };
    }
    return null;
  }

  // Compare a save's mods with what runs now. In sync = every mod of the save is loaded; mods
  // loaded now but new to the save (extra) are added to it on load and move nothing.
  //  inWorld: the world is loading, so the game has already appended the current mods to its
  //  order; extras then come from this mod's own `known` list (null before the first save with it).
  // Missing mod status:
  //  get       on the Workshop, not subscribed
  //  download  subscribed, but Steam hasn't got the files (or subscribed after this launch)
  //  failing   subscribed, the game refuses it (game version, dependency…)
  //  local     a local mod: only its folder brings it back
  //  unknown   no Workshop item found
  function compare(world, live, ctx) {
    ctx = Object.assign({}, ctx || {});
    const missing = [];
    for (const e of world.order) {
      if (e.id === SELF_ID || live.loaded.has(e.id)) continue;
      const f = live.failed.get(e.id), local = world.local.includes(e.id);
      const res = local ? null : resolve(e.id, e.version, world, live, ctx);
      let status;
      if (f && NOT_DOWNLOADED.has(f.code) && res) status = "download";
      else if (f) status = "failing";
      else if (res && live.subscribed.has(res.itemId)) status = "download";
      else if (res) status = "get";
      else status = local ? "local" : "unknown";
      const suggest = status === "unknown" && ctx.workshop ? suggestWorkshop(e.id, e.version, ctx.workshop, owned(world, live, ctx)) : [];
      missing.push({ id: e.id, version: e.version, status, itemId: res ? res.itemId : null, name: (res && res.name) || null,
        source: res ? res.source : null, problem: f ? f.message : null, suggest });
    }
    let extra = null;
    const base = ctx.inWorld ? world.known : world.order.map((e) => e.id);
    if (base) {
      const baseSet = new Set(base), needed = new Set();
      for (const id of baseSet) { const m = live.loaded.get(id); if (m) for (const d of m.deps) needed.add(d); }
      extra = [];
      for (const m of live.loaded.values()) {
        if (m.id === SELF_ID || baseSet.has(m.id) || needed.has(m.id)) continue;
        extra.push({ id: m.id, name: m.name, itemId: m.itemId, local: m.local, canUnsubscribe: !m.local && !!m.itemId && live.subscribed.has(m.itemId) });
      }
    }
    const fixable = missing.filter((r) => r.status === "get" || r.status === "download");
    const removable = (extra || []).filter((x) => x.canUnsubscribe);
    return { missing, extra, fixable, removable, inSync: missing.length === 0 };
  }

  // The Steam actions for the player's choice: every fixable missing mod except `skip`, and the
  // extras in `unsub` (none by default).
  function plan(cmp, choice) {
    const skip = (choice && choice.skip) || new Set(), unsub = (choice && choice.unsub) || new Set();
    const get = cmp.fixable.filter((r) => !skip.has(r.id));
    const subscribe = uniq(get.filter((r) => r.status === "get").map((r) => r.itemId));
    const download = uniq(get.filter((r) => r.status === "download").map((r) => r.itemId));
    const unsubscribe = uniq(cmp.removable.filter((x) => unsub.has(x.id)).map((x) => x.itemId));
    return { subscribe, download, unsubscribe, count: subscribe.length + download.length + unsubscribe.length };
  }

  // A cached mod list fits a save header if it was read from that very file, or recorded by this
  // mod while the game was writing it (store:save fires just before the write).
  function recordFresh(rec, header) {
    if (!rec || !header) return false;
    if (rec.readTs) return rec.readTs === header.timestamp;
    const ts = Date.parse(header.timestamp) || 0;
    return !!rec.savedAt && rec.savedAt <= ts + 5000 && rec.savedAt >= ts - 600000;
  }

  // What this mod writes into the save's own bag on every save: the mods loaded right now (in the
  // game's load order) are what this save needs. A mod dropped before the save isn't needed anymore.
  function bagFor(world, live, prevBag) {
    const items = cleanItems(prevBag && prevBag.items), local = new Set(world.local), mods = [], done = new Set();
    for (const m of live.loaded.values()) {
      if (m.itemId) items[m.id] = m.itemId;
      if (m.local) local.add(m.id);
    }
    const add = (m) => { if (m && !done.has(m.id)) { done.add(m.id); mods.push({ id: m.id, version: m.version }); } };
    for (const e of world.history || world.order) add(live.loaded.get(e.id));
    for (const m of live.loaded.values()) add(m);
    return { v: 2, items, local: [...local].sort(), mods };
  }

  return { SELF_ID, RUNTIME_BAG, STATE, isItemId, readSaveMods, readLive, mergeCatalog, words, matchScore, suggestWorkshop, matchWorkshop,
    resolve, compare, plan, recordFresh, bagFor };
})();
if (typeof module !== "undefined" && module.exports) module.exports = ModSyncLogic;
