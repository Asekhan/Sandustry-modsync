// The game's preload bridge (window.electron): Steam Workshop, saves, quit. Every call resolves to
// null or {ok: false, error} on failure instead of throwing.
const ModSyncBridge = (() => {
  const { STATE } = ModSyncLogic;
  const electron = () => { try { return window.electron || null; } catch (e) { return null; } };
  const workshop = () => { const e = electron(); return (e && e.platform && e.platform.workshop) || null; };
  const errText = (e) => String((e && e.message) || e);
  async function attempt(fn) {
    try { const r = await fn(); return r === undefined ? null : r; } catch (e) { return { ok: false, error: errText(e) }; }
  }
  const data = (r) => (r && r.ok && r.data !== undefined ? r.data : null);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function log(obj) {
    const s = typeof obj === "string" ? obj : JSON.stringify(obj);
    try { electron().log("info", "modsync", s); } catch (e) {}
    try { console.log("[modsync]", s); } catch (e) {}
  }

  // Everything about the mods of this launch, in one go.
  async function live() {
    const w = workshop(), e = electron();
    if (!w) return { available: false, discovery: null, subscribed: [], localList: [] };
    const [disc, subs, local] = await Promise.all([
      attempt(() => w.getSandkitMods()), attempt(() => w.getSubscribedItems()), attempt(() => e.localMods.list()),
    ]);
    return { available: true, discovery: data(disc) || { mods: [], diagnostics: [] }, subscribed: (data(subs) || []).map(String), localList: data(local) || [] };
  }

  const installed = (bits) => typeof bits === "number" && (bits & STATE.INSTALLED) !== 0 &&
    (bits & (STATE.DOWNLOADING | STATE.DOWNLOAD_PENDING | STATE.NEEDS_UPDATE)) === 0;

  // Waits until Steam reports the item installed and up to date. onPct(0..100 | null).
  async function waitInstalled(itemId, onPct, timeoutMs, cancel) {
    const w = workshop(), end = Date.now() + (timeoutMs || 180000);
    while (Date.now() < end && !(cancel && cancel())) {
      const bits = data(await attempt(() => w.getState(itemId)));
      if (installed(bits)) return true;
      const info = data(await attempt(() => w.downloadInfo(itemId)));
      const cur = Number(info && info.current), tot = Number(info && info.total);
      onPct(Number.isFinite(cur) && Number.isFinite(tot) && tot > 0 ? Math.floor((100 * cur) / tot) : null);
      await sleep(700);
    }
    return false;
  }

  // Runs a plan from ModSyncLogic.plan. onStep(step) after every change; step = {kind, itemId, state, pct, error}.
  // cancel(): true stops starting new steps and waiting (Steam keeps whatever it already started).
  async function run(plan, onStep, cancel) {
    cancel = cancel || (() => false);
    const w = workshop();
    const steps = [
      ...plan.unsubscribe.map((itemId) => ({ kind: "unsubscribe", itemId })),
      ...plan.subscribe.map((itemId) => ({ kind: "subscribe", itemId })),
      ...plan.download.map((itemId) => ({ kind: "download", itemId })),
    ].map((s) => Object.assign(s, { state: "waiting", pct: null, error: null }));
    const update = (s, patch) => { Object.assign(s, patch); onStep(s, steps); };
    if (!w) { for (const s of steps) update(s, { state: "failed", error: "Steam Workshop is not available" }); return steps; }
    onStep(null, steps);
    const waits = [];
    for (const s of steps) {
      if (cancel()) { update(s, { state: "cancelled" }); continue; }
      update(s, { state: "working" });
      if (s.kind === "unsubscribe") {
        const r = await attempt(() => w.unsubscribe(s.itemId));
        update(s, r && r.ok ? { state: "done" } : { state: "failed", error: (r && r.error) || "no answer from Steam" });
        continue;
      }
      if (s.kind === "subscribe") {
        const r = await attempt(() => w.subscribe(s.itemId));
        if (!(r && r.ok)) { update(s, { state: "failed", error: (r && r.error) || "no answer from Steam" }); continue; }
      }
      await attempt(() => w.download(s.itemId, true));
      update(s, { state: "downloading" });
      waits.push(waitInstalled(s.itemId, (pct) => update(s, { pct }), 180000, cancel).then((done) =>
        update(s, done ? { state: "done", pct: 100 } : cancel() ? { state: "cancelled" } : { state: "failed", error: "still downloading after 3 min: Steam finishes it in the background" })));
    }
    await Promise.all(waits);
    log({ synced: steps.map((s) => `${s.kind} ${s.itemId}: ${s.state}${s.error ? " (" + s.error + ")" : ""}`) });
    return steps;
  }

  async function saves() {
    const e = electron();
    const r = e && (await attempt(() => e.getSaveFiles()));
    return Array.isArray(r) ? r : [];
  }

  function lastPlayedId() {
    try { const v = electron().getLastPlayedGameSync(); return v ? JSON.parse(v).id || null : null; } catch (e) { return null; }
  }

  // Reads a whole save (the game has no partial read) and keeps only store.mods.
  async function saveMods(saveId) {
    const e = electron();
    let r = e && (await attempt(() => e.load(saveId)));
    const mods = r && r.success && r.data && r.data.store ? r.data.store.mods || {} : null;
    r = null;
    return mods;
  }

  async function setLastPlayed(saveId) {
    const e = electron();
    if (e && saveId) await attempt(() => e.saveLastPlayedGame({ id: saveId }));
  }

  function quit() {
    const e = electron();
    if (e && e.appQuit) e.appQuit(); else window.close();
  }

  function openUrl(url) {
    const e = electron();
    try { if (e && e.openExternalBrowser) e.openExternalBrowser(url); else window.open(url, "_blank"); } catch (err) {}
  }

  return { available: () => !!workshop(), live, run, saves, lastPlayedId, saveMods, setLastPlayed, quit, openUrl, log };
})();
