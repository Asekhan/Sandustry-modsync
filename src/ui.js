// Mod Sync: "Sync Mods" next to Continue (patches.json adds the button), a status line in the
// Load window, the "Sync mods with save" window, a check when a save loads, and the Workshop ids
// written into every save. ModSyncLogic, ModSyncBridge, VERSION, SEED and WORKSHOP come from the build.
const api = sandkit.api;
const L = ModSyncLogic, B = ModSyncBridge;
const MEM_KEY = "asekhan.modsync.v2";
const APP_ID = 2764460;
const setting = (k, d) => { try { const v = api.settings.get(k); return v === undefined || v === null ? d : v; } catch (e) { return d; } };
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

// ---------- this PC's memory (localStorage) ----------
// catalog: mod id -> {itemId, name}   picks: mod id -> {itemId, name} chosen in the window
// saves: save id -> its mod list {order, items, local, known, readTs | savedAt}
// autoload: {saveId, at}: the save to open at the next start ("Load save after sync")
function loadMem() {
  try { const m = JSON.parse(localStorage.getItem(MEM_KEY) || "null"); if (m && m.catalog && m.saves) return Object.assign({ picks: {}, autoload: null }, m); } catch (e) {}
  return { catalog: {}, saves: {}, picks: {}, autoload: null };
}
let mem = loadMem();
function saveMem() {
  const ids = Object.keys(mem.saves);
  if (ids.length > 100) {
    const age = (r) => r.savedAt || Date.parse(r.readTs) || 0;
    ids.sort((a, b) => age(mem.saves[b]) - age(mem.saves[a]));
    for (const id of ids.slice(100)) delete mem.saves[id];
  }
  try { localStorage.setItem(MEM_KEY, JSON.stringify(mem)); } catch (e) { B.log({ memError: String(e) }); }
}
const ctx = (extra) => Object.assign({ catalog: mem.catalog, seed: SEED, workshop: WORKSHOP, picks: mem.picks }, extra || {});
const asWorld = (rec) => ({ order: rec.order || [], items: rec.items || {}, local: rec.local || [], known: rec.known || null });

// ---------- what runs in this launch ----------
let live = null;
async function refreshLive() {
  const raw = await B.live();
  live = raw.available ? L.readLive(raw.discovery, raw.subscribed, raw.localList) : null;
  if (live) { mem.catalog = L.mergeCatalog(mem.catalog, live.pairs); saveMem(); }
}

// ---------- a save's mod list ----------
// Saves made with this mod are recorded as they're written; anything else is read from the file,
// one save at a time (the game has no partial read: a big world is ~100 MB of JSON, and taking it
// in stalls the game for a moment). `wanted()` false when its turn comes skips the read.
const reading = new Map();
let readChain = Promise.resolve();
const cached = (header) => { const rec = mem.saves[header.id]; return L.recordFresh(rec, header) ? rec : null; };
function modsOf(header, wanted) {
  const rec = cached(header);
  if (rec) return Promise.resolve(rec);
  if (!reading.has(header.id)) {
    const p = (readChain = readChain.then(async () => {
      if (wanted && !wanted()) return null;
      try {
        const mods = await B.saveMods(header.id);
        if (!mods) return null;
        const s = L.readSaveMods(mods);
        const r = { order: s.order, items: s.items, local: s.local, known: s.known, readTs: header.timestamp };
        mem.saves[header.id] = r;
        mem.catalog = L.mergeCatalog(mem.catalog, Object.entries(s.items).filter(([id]) => !mem.catalog[id]).map(([id, item]) => [id, item, null]));
        saveMem();
        return r;
      } catch (e) { B.log({ readError: String(e) }); return null; }
    }));
    reading.set(header.id, p);
    p.finally(() => reading.delete(header.id));
  }
  return reading.get(header.id);
}
async function headerOf(saveId) { return (await B.saves()).find((h) => h.id === saveId) || null; }
function loadSave(saveId) { const u = new URL(window.location.href); u.search = ""; u.searchParams.set("db_load", saveId); window.location.href = u.toString(); }
function backToMenu() { const u = new URL(window.location.href); u.search = ""; window.location.href = u.toString(); }

// ---------- syncing ----------
const sync = { saveId: null, state: null, steps: [], cancelled: false, loadAfter: false }; // state: running | done
async function runSync(saveId, plan, loadAfter) {
  if (!plan.count || sync.state === "running") return;
  Object.assign(sync, { saveId, state: "running", steps: [], cancelled: false, loadAfter });
  paintAll();
  await B.run(plan, (s, steps) => { sync.steps = steps; paintAll(); }, () => sync.cancelled);
  await B.setLastPlayed(saveId); // Continue opens this save after the restart
  if (loadAfter && !sync.cancelled) { mem.autoload = { saveId, at: Date.now() }; saveMem(); }
  await refreshLive();
  sync.state = "done";
  paintAll();
}
const ended = (s) => s.state === "done" || s.state === "failed" || s.state === "cancelled";
const failedSteps = () => sync.steps.filter((s) => s.state === "failed");
const progressCount = () => `${sync.steps.filter(ended).length}/${sync.steps.length}`;
function progressPct() {
  if (!sync.steps.length) return 0;
  const one = (s) => (ended(s) ? 100 : s.state === "downloading" ? s.pct || 0 : 0);
  return Math.floor(sync.steps.reduce((a, s) => a + one(s), 0) / sync.steps.length);
}

// ---------- DOM ----------
function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "style") Object.assign(n.style, v);
    else if (k.startsWith("on")) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in n) n[k] = v;
    else n.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) n.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
  return n;
}
// The game's UI sounds and button looks (0.5.6: the Load window's main button and its small text
// buttons), so the mod's buttons look, move and sound like the game's.
const sound = (name, opts) => { try { api.sound.play(name, Object.assign({ ignoreMute: true }, opts)); } catch (e) {} };
const MAIN = "text-white bg-black border rounded-tr-lg rounded-bl-lg cursor-pointer shadow-md px-4 py-2 border-slate-200 border-opacity-100 " +
  "hover:border-opacity-0 item-button-transition hover:text-[#ffe700] overflow-hidden before:ease before:absolute before:right-0 before:-top-4 " +
  "before:h-20 before:w-6 before:translate-x-12 before:rotate-6 before:bg-white before:opacity-10 before:duration-700 hover:before:-translate-x-52 " +
  "relative left-0 hover:left-1 pointer-events-auto";
const MAIN_OFF = " opacity-40 cursor-not-allowed hover:border-opacity-100 hover:text-white hover:left-0";
const TEXT = "text-xs px-3 py-2 transition-colors shrink-0 ";
function btn(label, onClick, kind, props) { // kind: main | text | danger
  kind = kind || "main";
  const off = !!(props && props.disabled), main = kind === "main";
  const look = main ? MAIN + (off ? MAIN_OFF : "") : TEXT + (off ? "text-slate-700 cursor-not-allowed" : kind === "danger" ? "text-slate-400 hover:text-red-400" : "text-slate-400 hover:text-[#ffe700]");
  return el("button", Object.assign({}, props, {
    className: `ms-b ms-b-${kind} ${(props && props.className) || ""} ${look}`,
    onMouseEnter: () => { if (!off) sound("blip", main ? { volume: 0.1 } : { playbackRate: 4, volume: 0.03 }); },
    onClick: (e) => { e.stopPropagation(); if (off) return; sound(main ? "click" : "blip", main ? {} : { playbackRate: 4, volume: 0.05 }); onClick(e); },
  }), label);
}
const check = (label, checked, onChange, props) => el("label", Object.assign({ className: "ms-check" }, props && props.title ? { title: props.title } : {}),
  el("input", { type: "checkbox", checked, disabled: !!(props && props.disabled), onChange: (e) => { sound("blip", { playbackRate: 4, volume: 0.05 }); onChange(e.target.checked); } }), label);
// Layout and the few looks the game has no class for. Colours are the game's: slate text, #ffe700
// accent, #8aff4b green, #f5a623 orange. The font is the game's (inherited).
const CSS = `
.ms-field{padding:10px 12px;line-height:1.45;font-size:11px;color:#cbd5e1}
.ms-label,.ms-sec{font-size:10px;letter-spacing:.1em;text-transform:uppercase;font-weight:600;color:#cbd5e1}
.ms-label{margin-bottom:2px}
.ms-save{color:#fff;font-weight:600;font-size:12px;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ms-ok{color:#8aff4b}.ms-off{color:#f5a623}.ms-bad{color:#f87171}.ms-dim{color:#cbd5e1}
.ms-field .ms-b{margin-top:8px}
.ms-b{font:inherit;white-space:nowrap}
.ms-field .ms-b-main{font-size:12px;padding:4px 14px}
.ms-badge{position:absolute;right:9px;top:50%;transform:translateY(-50%);min-width:22px;box-sizing:border-box;text-align:center;padding:3px 6px;border-radius:0 6px 0 6px;font-size:13px;font-weight:700;line-height:1.1;letter-spacing:0;pointer-events:none}
.ms-badge:empty{display:none}
.ms-badge.ms-off{background:#f5a623;color:#000}.ms-badge.ms-bad{background:#f87171;color:#000}.ms-badge.ms-ok,.ms-badge.ms-dim{background:none;font-size:16px}
.ms-veil{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;text-align:left;font-size:13px;line-height:1.4;color:#fff}
.ms-dlg{width:min(640px,94vw);max-height:86vh;display:flex;flex-direction:column;background:rgba(0,0,0,.9)}
.ms-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 20px 12px;flex:none}
.ms-head .ms-x{background:none;border:0;cursor:pointer;padding:0 2px}
.ms-list{flex:1;min-height:60px;overflow:auto;padding:2px 20px 12px}
.ms-sec{margin:14px 0 6px}
.ms-sec.good{color:#8aff4b}.ms-sec.bad{color:#f87171}
.ms-fold{cursor:pointer;user-select:none}.ms-fold:hover{color:#ffe700}
.ms-row{display:flex;align-items:center;gap:10px;padding:4px 0 0}
.ms-name{flex:1;min-width:0;font-size:13px;font-weight:600;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ms-col{flex:none;min-width:120px;font-size:12px;color:#cbd5e1}
.ms-sub{padding:0 0 4px;color:#cbd5e1;font-size:11px}
.ms-grid{display:grid;grid-template-columns:1fr 1fr;gap:2px 16px;font-size:12px;color:#cbd5e1}
.ms-grid span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ms-check{display:inline-flex;align-items:center;gap:6px;cursor:pointer;user-select:none;font-size:12px;color:#cbd5e1}
.ms-check input{accent-color:#ffe700;margin:0;width:14px;height:14px;cursor:pointer}
.ms-check:hover{color:#fff}
.ms-link{color:rgba(255,231,0,.8);cursor:pointer}.ms-link:hover{color:#ffe700;text-decoration:underline}
.ms-opt{display:flex;gap:6px;align-items:center;padding:1px 0 2px;font-size:12px;color:#cbd5e1}
.ms-opt .ms-b{padding:0 6px}
.ms-bottom{padding:12px 20px 16px;flex:none}
.ms-bar{display:flex;align-items:center;gap:10px}
.ms-bar .ms-track{flex:1;height:6px;background:rgba(15,23,42,.6);border:1px solid rgba(71,85,105,.6)}
.ms-bar .ms-fill{height:100%;background:#ffe700;transition:width .2s}
.ms-bar span{width:40px;text-align:right;font-variant-numeric:tabular-nums;font-size:12px;color:#cbd5e1}
.ms-now{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:4px 0;font-size:12px;color:#cbd5e1}
.ms-now span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ms-msg{margin:4px 0 2px;font-size:12px}
.ms-foot{display:flex;align-items:center;gap:4px;margin-top:12px}
.ms-confirm{margin-left:auto}
`;
function ensureCss() { if (!document.getElementById("ms-style")) document.head.appendChild(el("style", { id: "ms-style", textContent: CSS })); }
const paintKeys = new WeakMap();
function put(host, key, build) { // rebuild only when the content changed
  if (paintKeys.get(host) === key) return;
  paintKeys.set(host, key);
  host.replaceChildren(...[].concat(build()).flat(Infinity).filter((n) => n && typeof n === "object"));
}

// ---------- "Sync Mods" next to Continue ----------
// patches.json adds the game's own menu button (shown with Continue, for the same save). This
// puts that save's status on it and opens the window when it's clicked.
const menu = { saveId: null, rec: null, state: null }; // state: checking | ready | error
async function checkContinue() {
  const id = B.lastPlayedId();
  if (!id || !live) return;
  const header = await headerOf(id);
  if (!header) return;
  Object.assign(menu, { saveId: id, state: "checking" });
  const rec = await modsOf(header);
  if (menu.saveId === id) Object.assign(menu, { rec, state: rec ? "ready" : "error" });
}
window.__modSyncOpen = async (saveId) => {
  if (!live || !saveId) return;
  openWindow({ mode: "menu", saveId, header: { id: saveId }, rec: null });
  const header = await headerOf(saveId), rec = header && (await modsOf(header));
  if (!win || win.saveId !== saveId || win.mode !== "menu") return;
  Object.assign(win, { header: header || win.header, rec, failed: !rec });
  if (rec && menu.saveId === saveId) Object.assign(menu, { rec, state: "ready" });
  paintWindow();
};
function menuButton() { // the game's menu item: div.w-60 > div (the frame) > two spans of text
  for (const d of document.querySelectorAll("div.w-60")) {
    const frame = d.firstElementChild;
    if (frame && [...frame.children].filter((c) => !c.classList.contains("ms-badge")).map((c) => c.textContent).join("").replace(/\s/g, "") === "SyncMods") return d;
  }
  return null;
}
function paintMenuButton() {
  const host = menuButton();
  if (!host) return;
  const frame = host.firstElementChild; // moves with the hover animation, so the badge goes there
  let badge = frame.querySelector(".ms-badge");
  if (!badge) {
    ensureCss(); badge = el("span", { className: "ms-badge" }); frame.appendChild(badge);
    if (getComputedStyle(frame).position === "static") frame.style.position = "relative";
  }
  let text = "", cls = "ms-dim", tip = "";
  if (menu.state === "checking") { text = ""; tip = ""; }
  else if (menu.state === "error") { text = "?"; cls = "ms-bad"; tip = "Couldn't read the save Continue opens"; }
  else if (menu.state === "ready" && live) {
    const cmp = L.compare(asWorld(menu.rec), live, ctx());
    if (cmp.inSync) { text = "✓"; cls = "ms-ok"; tip = "Every mod the save Continue opens needs is loaded"; }
    else { text = String(cmp.missing.length); cls = "ms-off"; tip = `The save Continue opens uses ${plural(cmp.missing.length, "mod")} that aren't loaded`; }
  }
  if (badge.textContent !== text) { badge.textContent = text; host.title = tip; }
  if (badge.className !== "ms-badge " + cls) badge.className = "ms-badge " + cls;
}

// ---------- the Load window ----------
// The game's Load window has an empty cell under its world list (the footer's left column); the
// status goes there. The selected save is the card with the yellow border; its React props carry
// the save's id and header.
let field = null, cur = null; // cur: {header, key, rec, state: checking | ready | error}
function findLoader() {
  for (const spacer of document.querySelectorAll("div.border-t > div.w-52.shrink-0")) {
    const body = spacer.parentElement.previousElementSibling;
    if (body && body.querySelector("[data-world-id]")) return { spacer, body };
  }
  return null;
}
function cardSave(card) {
  const key = Object.keys(card).find((k) => k.startsWith("__reactFiber$"));
  for (let f = key && card[key], i = 0; f && i < 6; f = f.return, i++) {
    const g = f.memoizedProps && f.memoizedProps.game;
    if (g && typeof g.id === "string") return Object.assign({}, g.metaData || {}, { id: g.id });
  }
  return null;
}
// The selected save, or with none selected yet, the shown world's first (newest) save: it's the
// one you're after most of the time.
function selectedHeader(body) {
  const card = body.querySelector('[class~="border-[#ffe700]"]');
  const picked = card && cardSave(card);
  if (picked) return picked;
  for (const c of body.querySelectorAll('[class~="rounded-lg"][class~="cursor-pointer"]')) { const s = cardSave(c); if (s) return s; }
  return null;
}
function tick() {
  paintMenuButton();
  const ld = findLoader();
  if (!ld) { field = null; return; }
  ensureCss();
  if (!field || !ld.spacer.contains(field)) { field = el("div", { className: "ms-field" }); ld.spacer.appendChild(field); }
  const h = selectedHeader(ld.body), key = h ? `${h.id}|${h.timestamp}` : "";
  if (!cur || cur.key !== key) {
    const rec = h && cached(h);
    cur = { header: h, key, rec, state: !h ? null : rec ? "ready" : "checking", at: Date.now(), started: !!rec };
  }
  // A save this PC hasn't seen is read only once the selection rests, so clicking or arrowing
  // through the list doesn't read every save on the way.
  if (cur.state === "checking" && !cur.started && Date.now() - cur.at >= 250) {
    const mine = cur, id = cur.header.id;
    mine.started = true;
    modsOf(mine.header, () => !!(cur && cur.header && cur.header.id === id)).then((rec) => {
      if (cur === mine) { mine.rec = rec; mine.state = rec ? "ready" : "error"; paintField(); }
    });
  }
  paintField();
}
function paintField() {
  if (!field || !cur) return;
  const h = cur.header;
  const label = [el("div", { className: "ms-label" }, "Mod sync"), h && h.name ? el("div", { className: "ms-save", title: h.name }, h.name) : null];
  if (!live) return put(field, "nolive", () => [label, el("div", { className: "ms-dim" }, "Steam Workshop unavailable")]);
  if (!h) return put(field, "none", () => [label, el("div", { className: "ms-dim" }, "Select a save")]);
  if (sync.saveId === h.id && sync.state === "running") return put(field, "run" + progressCount(), () => [label, el("div", { className: "ms-off" }, `Syncing… ${progressCount()}`)]);
  if (sync.saveId === h.id && sync.state === "done") {
    const bad = failedSteps().length;
    return put(field, "done" + bad, () => [label,
      el("div", { className: bad ? "ms-bad" : "ms-ok" }, bad ? `Synced, ${bad} failed` : sync.cancelled ? "Sync cancelled" : "Synced"),
      el("div", { className: "ms-dim" }, "Restart to apply"),
      btn("Quit game", () => B.quit())]);
  }
  if (cur.state === "checking") return put(field, "checking" + cur.key, () => [label, el("div", { className: "ms-dim" }, "Checking…")]);
  if (cur.state === "error") return put(field, "error" + cur.key, () => [label, el("div", { className: "ms-bad" }, "Couldn't read this save")]);
  // Mods added since the save don't count: loading just adds them. Sync… still offers to drop them.
  const cmp = L.compare(asWorld(cur.rec), live, ctx());
  const fetchable = cmp.fixable.length, cant = cmp.missing.length - fetchable;
  const open = () => openWindow({ mode: "loader", saveId: h.id, header: h, rec: cur.rec });
  put(field, `${cur.key}|${cmp.inSync}|${fetchable}|${cant}|${Object.keys(mem.picks).length}`, () => [label,
    cmp.inSync ? el("div", { className: "ms-ok" }, "✓ In sync") : el("div", { className: "ms-off" }, "Not in sync"),
    fetchable ? el("div", { className: "ms-dim" }, `${fetchable} ready to download`) : null,
    cant ? el("div", { className: "ms-dim" }, `${cant} can't be downloaded`) : null,
    btn("Sync…", open, cmp.inSync ? "text" : "main", cmp.inSync ? { className: "ms-quiet" } : null)]);
}

// ---------- the "Sync mods with save" window ----------
// Opened from Sync Mods, from the Load window, or by itself when a save that's missing mods starts
// loading (the mod's entry is awaited during world init, so waiting holds the load before the
// world runs). Syncing makes the mods match the save: missing mods are ticked to download, and mods
// not in the save are unsubscribed unless ticked to keep (unsubscribing applies to every world).
let veil = null, win = null; // win: {mode: menu | loader | gate, saveId, header, rec | world, inWorld, release, skip, keep, loadAfter}
function openWindow(w) {
  win = Object.assign({ skip: new Set(), keep: new Set(), loadAfter: true }, w);
  paintWindow();
}
function closeWindow() {
  win = null;
  if (veil) { veil.remove(); veil = null; }
}
const why = { failing: "the game refuses it", local: "local mod: its folder isn't in the mods folder", unknown: "not found on the Workshop" };
const src = { save: "id from the save", picked: "your pick", seen: "seen on this PC", known: "built-in list", title: "matched by name", subscribed: "subscribed" };
const itemLink = (itemId) => el("span", { className: "ms-link", onClick: () => B.openUrl(`https://steamcommunity.com/sharedfiles/filedetails/?id=${itemId}`) }, itemId);
const searchTerm = (modId) => modId.replace(/^[^.]*\./, "").replace(/[-_.]+/g, " ").trim() || modId;
function nameOf(itemId) {
  if (!itemId) return null;
  for (const c of Object.values(mem.catalog)) if (c.itemId === itemId && c.name) return c.name;
  for (const p of Object.values(mem.picks)) if (p.itemId === itemId && p.name) return p.name;
  for (const s of Object.values(SEED)) if (s[0] === itemId) return s[1];
  const w = WORKSHOP.items.find((it) => it.id === itemId);
  return w ? w.title : null;
}
const sec = (cls, text, onClick) => el("div", { className: "ms-sec " + cls + (onClick ? " ms-fold" : ""), onClick }, text);
function windowList(w, world, cmp, locked) {
  const list = [];
  const base = new Set(w.inWorld && world.known ? world.known : world.order.map((e) => e.id));
  const correct = [...base].filter((id) => id !== L.SELF_ID && live.loaded.has(id)).map((id) => live.loaded.get(id).name);
  const extra = cmp.extra || [];
  if (correct.length) {
    const open = w.showCorrect !== undefined ? w.showCorrect : cmp.inSync && !extra.length; // folded unless it's all there is
    list.push(sec("good", `${open ? "▾" : "▸"} Correct (${correct.length})`, () => { w.showCorrect = !open; paintWindow(); }));
    if (open) list.push(el("div", { className: "ms-grid" }, correct.map((n) => el("span", { title: n }, n))));
  }

  if (extra.length) {
    list.push(sec("good", `Not in save (${extra.length})`));
    for (const x of extra) list.push(el("div", { className: "ms-row" }, el("span", { className: "ms-name", title: x.id }, x.name),
      el("span", { className: "ms-col" }, x.canUnsubscribe
        ? check("Keep", w.keep.has(x.id), (on) => { on ? w.keep.add(x.id) : w.keep.delete(x.id); paintWindow(); }, { disabled: locked, title: "Unticked: unsubscribed on Confirm, for every world" })
        : el("span", null, x.local ? "local mod, stays" : "not subscribed"))));
  }

  const ready = cmp.missing.filter((r) => r.status === "get" || r.status === "download");
  if (ready.length) {
    list.push(sec("good", `Ready to download (${ready.length})`));
    for (const r of ready) {
      list.push(el("div", { className: "ms-row" }, el("span", { className: "ms-name", title: r.id }, r.name || nameOf(r.itemId) || r.id),
        el("span", { className: "ms-col" }, check("Download", !w.skip.has(r.id), (on) => { on ? w.skip.delete(r.id) : w.skip.add(r.id); paintWindow(); }, { disabled: locked }))));
      list.push(el("div", { className: "ms-sub" }, r.id, r.version ? ` v${r.version}` : "", " · ", itemLink(r.itemId),
        r.status === "download" ? " · subscribed, files missing" : src[r.source] ? ` · ${src[r.source]}` : "",
        r.source === "picked" && !locked ? [" · ", el("span", { className: "ms-link", onClick: () => { delete mem.picks[r.id]; saveMem(); paintAll(); } }, "undo")] : null));
    }
  }

  const cant = cmp.missing.filter((r) => r.status !== "get" && r.status !== "download");
  if (cant.length) {
    list.push(sec("bad", `Can't download (${cant.length})`));
    for (const r of cant) {
      list.push(el("div", { className: "ms-row" }, el("span", { className: "ms-name", title: r.id }, r.name || r.id), el("span", { className: "ms-col" }, r.version ? "v" + r.version : "")));
      list.push(el("div", { className: "ms-sub" }, (r.name ? r.id + " · " : "") + why[r.status] + (r.problem ? ": " + r.problem : "")));
      if (r.status !== "unknown" || locked) continue;
      for (const s of r.suggest) list.push(el("div", { className: "ms-opt" }, "Maybe ", el("b", null, s.title), ` by ${s.author} · `, itemLink(s.itemId), " ",
        btn("Use", () => { mem.picks[r.id] = { itemId: s.itemId, name: s.title }; saveMem(); paintAll(); }, "text")));
      list.push(el("div", { className: "ms-opt" }, el("span", { className: "ms-link", onClick: () => B.openUrl(`https://steamcommunity.com/workshop/browse/?appid=${APP_ID}&searchtext=${encodeURIComponent(searchTerm(r.id))}`) }, "Search the Workshop")));
    }
  }
  if (!list.length) list.push(el("div", { className: "ms-sub", style: { marginTop: "12px" } }, "This save has no mods."));
  return list;
}
function paintWindow() {
  if (!win) return;
  ensureCss();
  if (!veil) {
    veil = el("div", { className: "ms-veil" });
    for (const ev of ["mousedown", "mouseup", "click", "pointerdown", "pointerup", "wheel", "contextmenu", "keydown", "keyup"]) veil.addEventListener(ev, (e) => e.stopPropagation());
    document.body.appendChild(veil);
    sound("blip", { volume: 0.1 });
  }
  const w = win, header = w.header || {};
  const mine = sync.saveId === w.saveId, running = mine && sync.state === "running", done = mine && sync.state === "done";
  const oldList = veil.querySelector(".ms-list"), top = oldList ? oldList.scrollTop : 0;
  const gate = w.mode === "gate";
  const back = gate ? btn("Back to main menu", backToMenu, "text", { disabled: running }) : btn("Back", closeWindow, "text", { disabled: running });
  const head = el("div", { className: "ms-head border-b border-slate-700/40" },
    el("div", null, el("div", { className: "text-lg font-bold tracking-wide" }, gate ? "This save's mods aren't all loaded" : "Sync mods with save"),
      el("div", { className: "text-[11px] text-slate-300" }, [header.worldName, header.name].filter(Boolean).join(" · ") || " ")),
    gate || running ? null : el("button", { className: "ms-x text-slate-300 hover:text-white transition-colors text-lg leading-none", title: "Close (Esc)", onClick: (e) => { e.stopPropagation(); closeWindow(); } }, "✕"));
  const panel = (...kids) => el("div", { className: "ms-dlg bg-black bg-opacity-90 shadow-lg ui-box card-2 text-white" }, kids);
  const listCls = "ms-list save-browser-scroll", bottomCls = "ms-bottom border-t border-slate-700/40";

  // still reading the save (Sync Mods on a save this PC hasn't seen yet)
  if (!w.world && !w.rec) {
    veil.replaceChildren(panel(head,
      el("div", { className: listCls }, el("div", { className: w.failed ? "ms-sub ms-bad" : "ms-sub animate-pulse", style: { marginTop: "12px" } }, w.failed ? "Couldn't read this save." : "Reading the save…")),
      el("div", { className: bottomCls }, el("div", { className: "ms-foot" }, back))));
    return;
  }

  const world = w.world || asWorld(w.rec), cmp = L.compare(world, live, ctx({ inWorld: !!w.inWorld }));
  const unsub = new Set(cmp.removable.map((x) => x.id).filter((id) => !w.keep.has(id)));
  const plan = L.plan(cmp, { skip: w.skip, unsub });
  const list = el("div", { className: listCls }, windowList(w, world, cmp, running || done));

  const bottom = [];
  if (running || done || plan.count) { // progress only when there's something to do
    const pct = running || done ? progressPct() : 0;
    const now = running && sync.steps.find((s) => s.state === "working" || s.state === "downloading");
    const verb = { unsubscribe: "unsubscribing", subscribe: "subscribing", download: "downloading" };
    const nowText = now ? `${nameOf(now.itemId) || now.itemId}${now.kind !== "download" ? ` (${verb[now.kind]})` : ""}${now.state === "downloading" && now.pct !== null ? ` · ${now.pct}%` : ""}` : "nothing";
    bottom.push(
      el("div", { className: "ms-bar" }, el("div", { className: "ms-track" }, el("div", { className: "ms-fill", style: { width: pct + "%" } })), el("span", null, String(pct).padStart(3, "0") + "%")),
      el("div", { className: "ms-now" }, el("span", null, el("b", null, "Currently downloading: "), nowText),
        btn("Cancel", () => { sync.cancelled = true; paintWindow(); }, "danger", { disabled: !running || sync.cancelled })));
  }
  const loadAnyway = (kind, cls) => btn("Load anyway", () => { const r = w.release; closeWindow(); r(); }, kind, { className: cls, disabled: running });
  if (done) {
    const bad = failedSteps();
    bottom.push(el("div", { className: "ms-msg " + (bad.length || sync.cancelled ? "ms-bad" : "ms-ok") },
      sync.cancelled ? "Cancelled. " : bad.length ? `Failed: ${bad.map((s) => `${nameOf(s.itemId) || s.itemId} (${s.error})`).join(", ")}. ` : "Done. ",
      "Sandustry reads mods at startup: restart it" + (sync.loadAfter && !sync.cancelled ? " and this save opens by itself." : ".")));
    bottom.push(el("div", { className: "ms-foot" }, back, btn("Quit game", () => B.quit(), "main", { className: "ms-confirm" })));
  } else if (plan.count) {
    const what = [plan.subscribe.length + plan.download.length && `download ${plan.subscribe.length + plan.download.length}`, plan.unsubscribe.length && `unsubscribe ${plan.unsubscribe.length}`].filter(Boolean).join(", ");
    bottom.push(check("Load save after sync", w.loadAfter, (on) => { w.loadAfter = on; paintWindow(); }, { disabled: running }));
    bottom.push(el("div", { className: "ms-foot" }, back, gate ? loadAnyway("danger") : null,
      btn("Confirm", () => runSync(w.saveId, plan, w.loadAfter), "main", { className: "ms-confirm", disabled: running, title: what })));
  } else {
    // Nothing Steam can change. This is a sync window, not a way to load the save.
    bottom.push(el("div", { className: "ms-msg ms-dim" }, cmp.missing.length ? "Nothing to download: the missing mods can't be downloaded." : "Nothing to change: your mods match this save."));
    bottom.push(el("div", { className: "ms-foot" }, gate ? [back, loadAnyway("main", "ms-confirm")] : btn("Close", closeWindow, "main", { className: "ms-confirm" })));
  }
  veil.replaceChildren(panel(head, list, el("div", { className: bottomCls }, bottom)));
  list.scrollTop = top;
}
function paintAll() { paintField(); paintWindow(); paintMenuButton(); }
// While the window is up, keys go to it, not to the game (menu navigation, Esc, hotkeys).
// Esc closes it, except while syncing or when it holds a loading save.
window.addEventListener("keydown", (e) => {
  if (!win) return;
  if (e.code === "Escape") { if (win.mode !== "gate" && sync.state !== "running") closeWindow(); }
  else if (veil && veil.contains(e.target)) return; // the window's own buttons and checkboxes
  e.stopImmediatePropagation(); e.preventDefault();
}, true);

// ---------- the Workshop ids written into every save ----------
// store:save fires synchronously before the game copies the store, so the bag lands in this save.
function hookSave() {
  api.events.on("store:save", () => {
    try {
      if (!live) return;
      const st = sandkit.state, world = L.readSaveMods(st.store.mods);
      const bag = L.bagFor(world, live, st.store.mods[L.SELF_ID]);
      const target = api.storage.ensure(L.SELF_ID);
      for (const k of Object.keys(target)) delete target[k];
      Object.assign(target, bag);
      const saveId = st.session.saving && st.session.saving.id;
      if (saveId) {
        mem.saves[saveId] = { order: bag.mods, items: bag.items, local: bag.local, known: bag.mods.map((e) => e.id), savedAt: Date.now() };
        saveMem();
      }
    } catch (e) { B.log({ saveHookError: String((e && e.stack) || e) }); }
  });
}

// ---------- entry ----------
async function start() {
  try {
    await refreshLive();
    hookSave();
    setInterval(tick, 300);
    const params = new URLSearchParams(window.location.search), saveId = params.get("db_load");
    if (!saveId) {
      // "Load save after sync": open that save once, at the first start after the sync.
      const a = mem.autoload;
      if (a) {
        mem.autoload = null; saveMem();
        if (!params.toString() && Date.now() - a.at < 3600e3 && (await headerOf(a.saveId))) { B.log({ autoload: a.saveId }); setTimeout(() => loadSave(a.saveId), 1000); return; }
      }
      setTimeout(checkContinue, 1500); // after the menu is up: an unseen save takes a moment to read
      return;
    }
    if (!live || !setting("gate", true)) return;
    const st = sandkit.state, meta = st.store.meta || {}, world = L.readSaveMods(st.store.mods);
    const header = (await headerOf(saveId)) || { id: saveId, worldName: meta.worldName };
    // The game has already appended the mods new to this save to its order; this PC may know the
    // save's own list (read in the Load window or recorded when it was written).
    const rec = mem.saves[saveId];
    if (!world.known && header.timestamp && L.recordFresh(rec, header)) world.known = rec.order.map((e) => e.id);
    const cmp = L.compare(world, live, ctx({ inWorld: true }));
    B.log({ load: saveId, world: meta.worldName, missing: cmp.missing.map((r) => `${r.id}:${r.status}`) });
    if (cmp.missing.length) {
      // This window wasn't asked for: it's about the missing mods, so mods added since the save
      // start ticked to keep (Sync Mods and Sync… start them unticked).
      const keep = new Set((cmp.extra || []).map((x) => x.id));
      await new Promise((release) => openWindow({ mode: "gate", saveId, header, world, inWorld: true, release, keep }));
    }
  } catch (e) {
    B.log({ startError: String((e && e.stack) || e) });
    if (win && win.release) win.release();
  }
}

window.modSync = { version: VERSION, get mem() { return mem; }, get live() { return live; }, logic: L };
B.log({ loaded: VERSION });
await start();
