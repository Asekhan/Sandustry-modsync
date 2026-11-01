# Mod Sync

A Sandustry mod that makes your Workshop mods match the save you want to play, like Factorio's
"Sync mods with save". Sandustry 0.5.6 and 0.6.0.

## Use

- **Main menu:** **Sync Mods**, under Continue, is for the save Continue opens. Its badge shows ✓,
  or how many mods that save is missing.
- **Load window:** a "Mod sync" card shows whether the selected save is in sync, with a **Sync Mods** button.
- **The sync window** lists the save's mods:
  - **Correct:** loaded and in the save.
  - **Not in save:** unsubscribed on Confirm unless you tick **Keep** (that applies to every world). Local mods stay.
  - **Ready to download:** missing, with a Workshop item found.
  - **Can't download:** refused by the game, local, or not found; the closest Workshop titles each have a **Use** button.
- **Confirm** subscribes and downloads, then quits: the game reads mods at startup only. Start it
  again and the save opens by itself.
- **On load,** a save that's missing mods stops on the same window before the world runs (**Back
  to main menu** or **Load anyway**). Options > Mods turns this off.
- Mods you added since a save never count against it.

## How it knows

- Mod Sync writes the loaded mods, with their Workshop ids, into every save
  (`store.mods["asekhan.modsync"]`). Older saves fall back to the game's own list of every mod
  the world ever had.
- Mod id → Workshop item, best source first: the subscription, the save's ids, what this PC has
  seen, `src/seed.json`, then a title match against `src/workshop.json` (a snapshot of the
  Sandustry Workshop). Only one clear winner counts; anything else goes under "Can't download".
- The menu button is a regex patch on the game's bundle (`src/patches.json`). If an update breaks
  it, the game reports the patch as failed and the rest still works.

## Build

```bash
node tools/build.cjs && npm test
```

Copy `mod/` to `%APPDATA%\sandustry\mods\asekhan.modsync\` and restart the game. The browser tests
need Playwright (`npm i -D playwright`). `node tools/workshop_catalog.cjs --versions` refreshes the
Workshop snapshot (Node 18+, network); `node tools/make_seed.cjs <item folders>` the built-in list.

## License

MIT
