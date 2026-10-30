# Mod Sync (`asekhan.modsync`)

Keeps your Workshop subscriptions matched to the save you play.

- **Mods added since a save never count against it.** Loading just adds them to the save. Only
  missing mods make a save "Not in sync" or stop a load.
- **Main menu:** **Sync Mods**, under Continue, is for the save Continue opens. Its badge shows ✓
  when every mod that save needs is loaded, or how many are missing.
- **Load window:** "Mod sync", under the world list, shows the selected save (or, before you pick
  one, the world's newest save) as "In sync" or "Not in sync", with counts, and a **Sync…** button.
- **The sync window** (modelled on Factorio's "Sync mods with save") makes your mods match the
  save. It uses the game's own window, button and sound styles.
  - **Correct:** the save's mods that are loaded (folded to one line unless it's all there is).
  - **Not in save:** loaded now, not in the save. Unsubscribed on Confirm unless **Keep** is
    ticked. Unsubscribing applies to every world, not just this save. Local mods stay.
  - **Ready to download:** missing mods with a Workshop item, ticked. Each shows the item and how
    it was found (id from the save, matched by name, built-in list…).
  - **Can't download** (red): refused by the game, local mod, or not found on the Workshop. For
    a mod with no sure match, the closest Workshop titles each have a **Use** button.
  - Progress bar, "Currently downloading", **Cancel**.
  - **Load save after sync** (ticked): after the restart, the save opens by itself (once, within
    an hour). With nothing to change, the window says so and only closes: it never loads a save.
  - The game reads mods at startup only, so a sync ends with **Quit game**; start it again.
- **On load:** a save that's missing mods stops on the same window before the world runs, with
  **Back to main menu** (nothing is saved) and **Load anyway**. Here, mods added since the save
  start ticked to **Keep**. If you only added mods since the save, it loads straight through.
- The menu button comes from `src/patches.json`, a regex patch on the game's bundle that adds a
  second copy of the Continue item. If a game update breaks it, the game reports the patch as
  failed and everything else still works.

## How it knows

- **A save needs the mods that were loaded when it was written.** Mod Sync writes that list,
  with each mod's Workshop id, into every save (`store.mods["asekhan.modsync"]`). A mod you
  dropped before saving isn't needed anymore.
- **Saves from before Mod Sync** fall back to the game's own record
  (`store.mods.__sandkitExternalRuntimeV1.order`), which keeps every mod the world ever had, so a
  dropped mod shows as missing until the world is saved once with Mod Sync.
- **Where the list comes from:** this PC keeps it as each save is written (localStorage
  `asekhan.modsync.v2`), so the Load window answers instantly. Otherwise the save file is read
  once the selection rests on it (a few seconds for a big world) and the result is cached.
- **Mod id → Workshop item**, best source first:
  1. the subscription itself;
  2. the save's own ids;
  3. what this PC has seen;
  4. `src/seed.json`;
  5. a title match against `src/workshop.json`, a snapshot of every Sandustry Workshop item.
- **Title matching:** the Workshop never shows mod ids. The game's uploader titles an item with
  the mod's name and writes its version as the change note. So the id's words are matched to the
  title, its prefix to the author, and the save's version to the change notes when the snapshot
  has them.
  - Only one clear winner counts, and items already known to hold another mod are skipped.
  - Against the 41 mods with known ids: 27 found, 0 wrong.
  - Anything unmatched goes under "Can't download", with the closest titles to pick from.

## Develop

- `node tools/build.cjs` bundles `src/` into `mod/` (main.js, modinfo.json, patches.json, preview.png). Install `mod/` as
  `%APPDATA%\sandustry\mods\asekhan.modsync\`, then restart the game.
- `npm test` runs:
  - the logic tests;
  - the browser tests: the built mod in a fake game page with copies of the main menu's and the
    Load window's DOM (`tests/harness/`). These need Playwright (`npm i -D playwright`, or
    `PLAYWRIGHT_MODULE=<path>`). `SHOTS=<dir>` saves screenshots.
- `node tools/make_seed.cjs <folders of Workshop item copies>` refreshes the built-in list.

## Refresh the Workshop snapshot

Run `node tools/workshop_catalog.cjs --versions`, then `node tools/build.cjs`.

- Needs Node 18+ and access to steamcommunity.com. A mod can't fetch Steam pages from inside the
  game: they send no CORS headers (expected, not yet checked in game).
- It refuses to write if its item count differs from the Workshop's total.
- The parser is written against Steam's markup but hasn't run against the live site yet.
- The shipped snapshot (265 items, 23 Oct 2026, no change notes) was read from the Workshop
  pages by Claude.
