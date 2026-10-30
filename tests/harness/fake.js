// A fake Sandustry 0.5.6 page for Mod Sync: the preload bridge (Steam Workshop + saves), the bits
// of sandkit the mod touches, and a copy of the Load window's DOM. Scenario: window.SCENARIO.
(function () {
  const S = window.SCENARIO;
  const calls = (window.calls = []);
  const subscribed = new Set(S.subscribed);
  const progress = new Map(); // itemId -> {t0, ms}
  const ok = (data) => ({ ok: true, data });
  const record = (name, ...args) => calls.push([name, ...args]);

  const workshop = {
    getSandkitMods: async () => ok({ mods: S.loaded.map(([id, version, itemId, via, deps]) => ({
      manifest: { id, name: S.names[id] || id, version, dependencies: deps || [] },
      workshop: { itemId: itemId || null, folder: "C:/x/" + id, discoveredVia: [via || (itemId ? "subscribed" : "local")] },
    })), diagnostics: S.diagnostics || [] }),
    getSubscribedItems: async () => ok([...subscribed]),
    subscribe: async (id) => { record("subscribe", id); subscribed.add(id); return ok(true); },
    unsubscribe: async (id) => { record("unsubscribe", id); subscribed.delete(id); return ok(true); },
    download: async (id) => { record("download", id); progress.set(id, { t0: Date.now(), ms: S.downloadMs || 900 }); return ok(true); },
    getState: async (id) => {
      const p = progress.get(id);
      if (!subscribed.has(id)) return ok(0);
      if (p && Date.now() - p.t0 < p.ms) return ok(1 | 16);
      return ok(p || S.installed.includes(id) ? 1 | 4 : 1 | 32);
    },
    downloadInfo: async (id) => { const p = progress.get(id); return ok(p ? { current: Math.min(p.ms, Date.now() - p.t0), total: p.ms } : null); },
  };
  window.electron = {
    platform: { workshop },
    localMods: { list: async () => ok(S.localList || []) },
    load: async (id) => { record("load", id); const s = S.saves.find((x) => x.header.id === id); await new Promise((r) => setTimeout(r, 150)); return s ? { success: true, data: { store: { mods: s.mods } } } : { success: false, error: "nope" }; },
    getSaveFiles: async () => S.saves.map((s) => s.header),
    getLastPlayedGameSync: () => (S.lastPlayed ? JSON.stringify({ id: S.lastPlayed }) : null),
    saveLastPlayedGame: async (g) => record("lastPlayed", g.id),
    appQuit: () => record("quit"),
    log: (lvl, tag, msg) => record("log", msg),
  };

  // sandkit: the live store holds the world being loaded (the game has already merged its order).
  const handlers = {};
  const store = { meta: { worldId: S.world.worldId, worldName: S.world.worldName }, mods: JSON.parse(JSON.stringify(S.world.mods || {})), scene: { active: 0 } };
  window.sandkit = {
    state: { store, session: { saving: null } },
    api: {
      settings: { get: () => undefined },
      storage: { ensure: (id) => (store.mods[id] = store.mods[id] || {}) },
      events: { on: (n, f) => (handlers[n] = handlers[n] || []).push(f) },
    },
  };
  window.fireSave = (saveId) => { window.sandkit.state.session.saving = { id: saveId, type: "autosave" }; for (const f of handlers["store:save"] || []) f({}); };

  // Keys that reach the game.
  window.addEventListener("keydown", (e) => record("gameKey", e.code));

  // The main menu as patches.json leaves it: Continue, then Sync Mods (same component, PR in 0.5.6).
  window.openMenu = () => {
    document.getElementById("loading").style.display = "none";
    const menu = document.createElement("div");
    menu.style.cssText = "position:fixed;left:60px;top:200px;font-family:sans-serif";
    const item = (id, text, onClick) => {
      const outer = document.createElement("div");
      outer.className = "w-60 mb-1.5 relative group cursor-pointer pointer-events-auto";
      outer.dataset.id = id;
      outer.style.cssText = "width:240px;margin-bottom:6px;cursor:pointer";
      const inner = document.createElement("div");
      inner.className = "relative left-0 w-full overflow-hidden px-3 text-3xl leading-10 tracking-[0.06em] text-white pointer-events-none";
      inner.style.cssText = "position:relative;padding:0 12px;font-size:30px;line-height:40px;letter-spacing:.06em;color:#fff;border:1px solid rgba(203,213,225,.86);border-radius:0 8px 0 8px;background:rgba(0,0,0,.86)";
      const a = document.createElement("span"), b = document.createElement("span");
      a.textContent = text.charAt(0); b.textContent = text.slice(1);
      inner.append(a, b); outer.append(inner); outer.onclick = onClick; menu.append(outer);
    };
    const n = S.lastPlayed;
    if (n) item("main-menu-continue", "Continue", () => record("continue", n));
    if (n) item("main-menu-sync-mods", "Sync Mods", () => { const f = window.__modSyncOpen; "function" == typeof f && f(n); });
    item("main-menu-new", "New Game", () => record("new"));
    document.body.append(menu);
  };

  // The Load window, with the same structure and classes as the game's (0.5.6). Save cards carry a
  // React fiber whose parent holds {game}, like the real ones.
  window.openLoader = () => {
    document.getElementById("loading").style.display = "none";
    const div = (cls, ...kids) => { const d = document.createElement("div"); d.className = cls; for (const k of kids) d.append(k); return d; };
    const cards = div("space-y-1.5");
    const worlds = div("w-52 shrink-0 border-r border-slate-700/40 flex flex-col min-h-0");
    const seen = new Set();
    for (const s of S.saves) {
      if (!seen.has(s.header.worldId)) { seen.add(s.header.worldId); const w = div(""); w.dataset.worldId = s.header.worldId; w.textContent = s.header.worldName; worlds.append(w); }
      const card = div("px-3.5 py-3 rounded-lg cursor-pointer border border-slate-700/30", s.header.name);
      card.dataset.save = s.header.id;
      card["__reactFiber$fake"] = { memoizedProps: { className: card.className }, return: { memoizedProps: { game: { id: s.header.id, metaData: s.header }, isSelected: false } } };
      card.onclick = () => {
        for (const c of cards.children) c.className = "px-3.5 py-3 rounded-lg cursor-pointer border border-slate-700/30";
        card.className = "px-3.5 py-3 rounded-lg cursor-pointer transition-all duration-150 border bg-slate-800/80 border-[#ffe700] shadow-[inset_0_0_20px_rgba(255,231,0,0.03)]";
      };
      cards.append(card);
    }
    const body = div("flex-1 min-h-0", div("flex h-full min-h-0", worlds, div("flex-1 flex flex-col min-w-0 min-h-0", cards)));
    const footer = div("border-t border-slate-700/40 flex shrink-0", div("w-52 shrink-0 border-r border-slate-700/40"),
      div("flex-1 flex items-center gap-3 px-4 py-3", Object.assign(document.createElement("button"), { textContent: "Load" })));
    const panel = div("bg-black bg-opacity-90 text-white flex flex-col", div("px-5 pt-4 pb-3 border-b", "Load Game"), body, footer);
    panel.style.cssText = "width:720px;height:500px;margin:40px auto;background:#000;color:#fff;display:flex;flex-direction:column";
    footer.style.cssText = "display:flex;border-top:1px solid #334";
    footer.firstChild.style.cssText = "width:208px;border-right:1px solid #334";
    body.style.cssText = "flex:1;overflow:auto";
    document.body.append(div("fixed inset-0", panel));
  };
})();
