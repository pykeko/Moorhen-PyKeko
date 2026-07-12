# Claude context — `pykeko/Moorhen-PyKeko`

A fork of upstream [`moorhen-coot/Moorhen`](https://github.com/moorhen-coot/Moorhen) (a Coot-based molecular graphics web app, WebAssembly) with PyKeko-specific customizations. The compiled wrapper that turns this into a desktop app lives at [`pykeko/PyKeko`](https://github.com/pykeko/PyKeko); the MCP server for Claude control lives at [`pykeko/PyKekoMCP`](https://github.com/pykeko/PyKekoMCP).

See [`pykeko/PyKeko/CLAUDE.md`](https://github.com/pykeko/PyKeko/blob/main/CLAUDE.md) for the full project family overview, naming conventions, and wire-protocol do-not-rename rules.

## What this fork adds beyond upstream Moorhen

Skim [`PROJECT-NOTES.md`](PROJECT-NOTES.md) for the implementation writeups, but at a glance:

- NCS ghost overlays
- PyMOL command translator (JS / PyMOL mode toggle in Interactive Scripting)
- MCP control surface (`MoorhenControlBridge`, `window.MoorhenControlApi`)
- Validation / peak / ligand cyclers
- Coot 0.9.x-style keyboard shortcuts and UX defaults
- 32-bit WASM enforcement in Electron renderer (see `PyKeko/preload.js`)

## Branches

| Branch | Use |
| --- | --- |
| `main` | Single trunk — development, releases, and what PyKeko packages from |

Local clones:
- `~/Moorhen` (on `main`) — what `PyKeko.app` dist builds from (`forge.config.js` hard-codes `BABY_GRU = ~/Moorhen/baby-gru`)
- `~/Moorhen-dev` (on `main`) — what `PyKekoDev.app` runs against via vite, port 5174

`upstream` remote points at `moorhen-coot/Moorhen` for pulling in upstream changes. Use real short-lived feature branches when you need isolation — merge back to `main` and delete when done.

**History note:** until 2026-06-06 there was a `ncs-ghosts` parallel
working branch that PyKeko packaged from. Every commit had to be cherry-
picked from `ncs-ghosts` to `main`, creating SHA drift and ceremony for no
functional benefit. The branch was retired and the workflow simplified to a
single trunk. The original `feedback_branch_sync_trap` memory described
the parallel-branch trap; it's been deleted because the trap no longer
applies.

## Build

This is normally built indirectly via `~/PyKeko`'s `npm run package` (which runs a vite build of `baby-gru/`). For direct work in here:

```bash
cd ~/Moorhen/baby-gru
npm install
npm run create-version
npm run transpile-ts-worker      # builds public/MoorhenAssets/wasm/CootWorker.js
npm run transpile-protobuf
npm run transpile-graphql-codegen
# Then either:
npx vite --config vite.config.mts         # dev server
# or build WASM via the cmake steps in PROJECT-NOTES.md
```

Known gotcha (the `~/bin/moorhen` shell launcher exists to work around this): running plain `npm start` triggers a prestart hook that recompiles `CootWorker.js`, which can desync from the WASM build and silently break the Coot command worker. Use `npx vite` directly to avoid the prestart, or rebuild WASM whenever `CootWorker.ts` is touched.

## Naming

- Refs to **upstream Moorhen** (project name, links to `moorhen-coot/*`, `moorhen.org`) — leave as "Moorhen"
- Refs to **this fork** — "Moorhen-PyKeko"
- Refs to the **packaged desktop app** — "PyKeko" / "PyKeko Dev"
- Wire-protocol identifiers (`MoorhenAssets/`, `MoorhenControlBridge`, etc.) — leave (see PyKeko/CLAUDE.md)

## Releases

Releases are tagged `pk-vX.Y.Z` (latest: [`pk-v0.3.14`](https://github.com/pykeko/Moorhen-PyKeko/releases/tag/pk-v0.3.14), 2026-07-12). The **`PyKeko.dmg` asset lives on _this_ repo's releases page** — that's been the convention since v0.1 and matches the org profile README's download badge / install link. The PyKeko wrapper repo (`pykeko/PyKeko`) carries a matching tag at the same version with a mirror of the dmg as a fallback, but the canonical download lives here. Version source of truth: `~/PyKeko/package.json` (currently `0.3.14`); this fork's `baby-gru/package.json` carries upstream Moorhen's version (`1.0.0-alpha.1`) and shouldn't be edited as part of PyKeko's versioning. The PyKeko wrapper's `CLAUDE.md` carries the full per-version changelog.

Note on the v0.2.7 → v0.2.9 gap: v0.2.7 shipped with a preload regression that silently broke the `__moorhenControl` IPC bridge in the packaged app. v0.2.8 was authored (and tagged briefly) but never properly released — the same preload bug was still there. v0.2.9 fixed the regression and is the first build since v0.2.6 where every Electron-only menu item works. The v0.2.7 release on this repo carries a "SUPERSEDED — please upgrade" banner in its release notes.

Note on **v0.2.18**: the dmg dropped from 226 MB to **151 MB** (−33%) after `forge.config.js` gained a `packagerConfig.ignore` array (was bundling `viewer-template/node_modules`, `.attic/`, `out/` into `Resources/app/`). v0.2.18 also patched a Coot WASM bug — `set_user_defined_atom_colour_by_selection` mis-parsed Moorhen-shorthand CIDs via mmdb's `Select`, so colour rules never reached bond/stick reps. Fix lives in `coot-patches/coot-molecule-bonds-userdef-color-cid-fix.patch` (applied via `coot-patches/apply.sh` against the WASM checkout). **v0.2.19 was closed without code** — upstream's `Validation → Water validation…` already implements Coot's `find_water_baddies` UI.

## Workflow

Single-trunk: commit to `main`, push, done.

```bash
git -C ~/Moorhen add ...
git -C ~/Moorhen commit -m "..."
git -C ~/Moorhen push origin main
git -C ~/Moorhen-dev pull --ff-only   # keep the dev clone in sync if it's checked out
```

For longer-running feature work that you don't want on `main` yet, use a real short-lived feature branch and merge back when done. Don't recreate the `ncs-ghosts` parallel-trunk pattern.

## Where to look

- [`README.md`](README.md) — top-level overview (includes upstream Moorhen's README below the PyKeko intro)
- [`README-MH.md`](README-MH.md) — features added on top of upstream
- [`PROJECT-NOTES.md`](PROJECT-NOTES.md) — implementation writeups, build steps, decisions
- [`docs/install-mac.md`](docs/install-mac.md) — end-user install guide
- [`docs/dmg-packaging-plan.md`](docs/dmg-packaging-plan.md) — the dist-variant design doc
- [`docs/pymol-translator.md`](docs/pymol-translator.md) — PyMOL command reference for the scripting modal
