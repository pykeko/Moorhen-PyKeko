# PyKeko session-state snapshot — 2026-06-12

Pick-up point after Claude upgrade. Captures everything material that
happened across this dev session so the next session can resume without
re-reading the entire transcript.

## Latest shipped release

**pk-v0.2.29** (2026-06-11) — live on both repos with `PyKeko.dmg`
- Canonical: https://github.com/pykeko/Moorhen-PyKeko/releases/tag/pk-v0.2.29
- Mirror:    https://github.com/pykeko/PyKeko/releases/tag/pk-v0.2.29
- Size: 150.96 MB, sha256 `c297c52e0d5e815950875debc2504f9198b44bee11765d58a2797a7e8c90e3e8`

See `RELEASE-HISTORY.md` for the full one-line-per-release log.

## What this session shipped (v0.2.20 → v0.2.29)

Ten releases over two calendar days, all driven by user-reported bugs +
follow-on feature work for the covalent-ligand workflow. The headline
arc: v0.2.20 was the embind silent-drop JS-side workarounds; v0.2.22
covalent-link button registry URL + pick fix + draggable; v0.2.24
disabled VitePWA + main-process SW cleanup (closed the stale-cache
trap); v0.2.25 PyMOL `;` separator + harder SW cleanup; v0.2.26 mmCIF
tokenizer trim (fixed "atom not found" cascade); v0.2.27 covalent
panel top-right slot + obvious drag bar; v0.2.28 PyMOL `color` recolor
of existing reps + covalent picking dismissal; v0.2.29 = the big one
(F1 + SMILES-time + live-display).

## Covalent-ligand subsystem (current architecture)

### File layout in `baby-gru/src/utils/`

| File | Role |
|---|---|
| `MoorhenCovalentLinkLibrary.ts` | Registry types, `applyAtomMap`, `buildSubstitutedLinkCif`, `buildAtomMap`, `LigandAtom/Bond` shape, `ensureRegistryLoaded` |
| `MoorhenCovalentLinkDetector.ts` | `detectWarheadFamily(lig, atoms, bonds, cbIdx, preferFamily?)` — graph walker; F1 + F2 both covered; `preferFamily` resolves bond-order-2 ambiguity (F2-post-vinyl vs F1-pre-alkene) |
| `MoorhenCovalentLinkDictParser.ts` | `parseChemCompFromDict(cifText, lig)` — extracts atoms + bonds from a ligand chem_comp dict; handles `type` vs `value_order` writer variants and SING/DOUB/TRIP/AROM tokens |
| `MoorhenCovalentLinkMod2Applier.ts` | `parseMod2(cifText)`, `applyMod2ToLigandDict(dict, mod2, lig)` — applies delete/add/change ops to `_chem_comp_atom` and `_chem_comp_bond` loops |
| `MoorhenCovalentLinkSurgery.ts` | `parseCid`, `findAtomInModel`, `appendStructConnLoop`, `tokenizeMmcifRow` (trim-quoted is the v0.2.26 fix) |
| `MoorhenCovalentLinkExecutor.ts` | `executeCovalentLink(request)` — shared end-to-end pipeline. Both right-click button and SMILES-time flow route through this. |
| `MoorhenCovalentLinkOrchestrator.ts` | Older `declareCovalentLink` — still exists but the v0.2.29 executor is the active path. Could be removed after a stale-references sweep. |

### Public assets in `baby-gru/public/MoorhenAssets/cov-links/`

| File | Family | Purpose |
|---|---|---|
| `index.json` | — | Registry: 6 entries (F2 ×3 + F1 ×3) |
| `CYS-YNA.cif` | F2 | α,β-ynamide → vinyl thioether (acalabrutinib, etc.) |
| `CYS-YNA-mod2-alkyne.cif` | F2 | Pre-reaction mod2 (C≡C → C=C + H on Cα + sp→sp²) |
| `CYS-ACR.cif` | F1 | Acrylamide → saturated β-thioether (ibrutinib, osimertinib) |
| `CYS-ACR-mod2-alkene.cif` | F1 | Pre-reaction mod2 (C=C → C-C + H on Cα + sp²→sp³) |

### Registry entries (in order of declaration)

```
CYS-YNA-post          F2  [#16][C:1]=[C:2]C(=O)N
CYS-YNA-pre           F2  [C:1]#[C:2]C(=O)N
CYS-YNA-pre-terminal  F2  [CH:1]#[C:2]C(=O)N
CYS-ACR-post          F1  [#16][C:1][C:2]C(=O)N
CYS-ACR-pre           F1  [C:1]=[C:2]C(=O)N
CYS-ACR-pre-terminal  F1  [CH2:1]=[CH:2]C(=O)N
```

### Flow integration points

- **Right-click "Declare covalent link" panel**:
  `baby-gru/src/components/context-menu/MoorhenCovalentLinkButton.tsx`
  — calls `executeCovalentLink` directly with user-typed/picked SG + Cβ
  CIDs and the selected linkId. v0.2.27 layout (fixed top-right, grey
  drag bar with ⋮⋮). v0.2.28 fix: `usePauseClickAwayListener` while
  picking Cβ so the canvas click doesn't dismiss the panel.

- **SMILES-time covalent attachment**:
  `baby-gru/src/components/menu-item/ImportLigandDictionary.tsx`
  `SMILESToLigand` — collapsible "Covalent attachment" section in
  `panelContent`. Refs (`covalentModeRef`, `covalentSgCidRef`,
  `covalentLinkIdRef`) flow through `collectedProps` into the parent
  `ImportLigandDictionary` component which arms a one-shot `atomClicked`
  listener after merge (60s timeout). Snackbar prompts the user to
  left-click Cβ on the just-merged ligand.

### Verified end-to-end against ibrutinib SMILES

- Detection: 54-atom, 58-bond dict → carbonyl C3, Cα C2, Cβ C1, picks
  `CYS-ACR-pre-terminal` correctly.
- Mod2 application: 3 atom ops + 1 bond op; C1-C2 `double → single 1.54 Å`;
  C1, C2 retype `CR1 → CT` (sp² → sp³); add HCH1 atom on Cα.

## Known followups (priority order)

1. **F1 + F2 placement-geometry seed for SMILES-time flow.** Currently
   the ligand lands at the standard "Active molecule centre" or Fo-Fc
   peak. The plan was to seed Cβ at 1.78 Å along the (Cys-CB → SG) axis
   extended so the covalent geometry is approximately right from the
   start. Skipped to keep v0.2.29 scope tractable. Tracked as v0.2.30+.

2. **F3 chloroacetamide, F4 epoxide, F5 maleimide, F6 reversible carbonyl
   warheads.** Plan-doc has all 6 families catalogued; only F1 + F2
   shipped. F3 chloroacetamide is the easiest next add (Cl leaves, S
   takes its place — pure substitution, no bond-order change). F5
   maleimide is also clean (C=C → C-C across the maleimide ring).

3. **Remove the older `MoorhenCovalentLinkOrchestrator.ts`** once a
   stale-references audit confirms nothing imports it. The executor
   superseded it in v0.2.29.

4. **Atom-map placeholder `<HCA>` derivation.** The executor passes the
   atom map from the detector through to mod2 substitution. The
   detector's `buildAtomMap` derives `hca` (the H to ADD on Cα for
   pre-reaction variants) by name pattern (e.g. H13 for C13) — but
   this name might collide with an existing H atom in the dict. Need
   to pick a guaranteed-unique name when colliding.

5. **`MoorhenCovalentLinkOrchestrator` placeholder substitution comment
   says "v2 link CIF scopes its plane narrowly… <AMIDE_PLANE>
   placeholder is no longer needed"** — but the F1 CYS-ACR.cif doesn't
   define an `<AMIDE_PLANE>` either, just like F2. Document this
   consistency check passed.

6. **Validation: pick a deposited acrylamide-warhead PDB and confirm
   the F1 link CIF produces refmacat geometry that matches.** 5P9I /
   5P9J (ibrutinib + BTK) are the natural targets. The plan-doc
   acedrg cross-validation directory at
   `~/Moorhen/docs/covalent-ligand-survey-2026-06-05/` only contains
   F2 (CYS-YNA / XQQ in 8FD9) reference outputs. F1 needs the same
   AceDRG-vs-hand-authored side-by-side.

7. **`MoorhenCovalentLinkButton.tsx` user-facing tweak**: it still
   shows a dropdown of all 6 registry entries even when only 3 make
   sense for a given chemistry. Could be improved by running the
   detector on dropdown open and pre-selecting the right entry +
   greying out the others. Low priority since the user can pick
   manually.

8. **`SMILESToLigand` covalent placement geometry**: see item 1. Same
   thing, different name.

## Recurring traps you'll want to remember

These are all in your auto-memory (`~/.claude/projects/-Users-hilgersmt/memory/`).
Worth re-reading next session.

| Memory | What it captures |
|---|---|
| `feedback_moorhen_embind_silent_drop.md` | Any newly-added embind `.function()` silently fails to register. JS-side workarounds in `MoorhenEmbindWorkarounds.ts`. |
| `feedback_moorhen_colour_rule_cid_form.md` | `addColourRule("cid", …)` only matches short-form CIDs (`//A`, not `/1/A/*/*`). |
| `feedback_centre_on_gemmi_atoms_trap.md` | `centreOnGemmiAtoms` returns negated centroid despite its name. |
| `feedback_molstar_clip_scale_diameter.md` | Mol* clip scale is diameter, not radius (raw path); MVS layer uses radius. |
| `feedback_coot_udd_first_match_wins.md` | Coot's `apply_user_defined_atom_colour_selections` is first-match-wins, not last. |
| `feedback_pykeko_sw_stale_cache.md` | **CLOSED in v0.2.24+** but still useful for triaging ≤ v0.2.23 reports. |
| `feedback_electron_preload_require_trap.md` | preload's `require()` is locked to "electron"; any other module throws and silently kills `__moorhenControl`. |
| `feedback_covalent_link_mmcif_surgery.md` | JS-side workaround for the broken `make_covalent_link` WASM binding. |

## Quick-reference: how to test the latest

For F1 ibrutinib end-to-end (the v0.2.29 headline feature):

```
1. Open PyKeko v0.2.29.
2. Load a session with BTK or another Cys-containing protein.
3. Ligand → New Ligand from SMILES…
4. Paste: C=CC(=O)N1CCC[C@@H]1Nc2ncnc3c2cnn3-c4ccc(Oc5ccccc5)cc4
   (ibrutinib canonical SMILES)
5. Tick "Form covalent bond to Cys SG"
6. Click "Pick in viewer" → left-click a Cys SG (e.g. //A/481/SG on BTK)
7. Dropdown → CYS-ACR-pre-terminal (auto-default to first entry; pick
   this for terminal-acrylamide chemistry)
8. Submit. Watch snackbar: "Ligand placed. Left-click any Cβ atom…"
9. Left-click the terminal CH2 (atom C1 in the generated dict)
10. Verify:
    - Augmented mmCIF downloads
    - Snackbar: "Declared CYS-ACR-pre-terminal: CYS … → IBR … Bond
      orders updated in viewer."
    - The terminal C=C in the viewer becomes single (no double-bond
      mesh between C1 and C2)
    - A new H appears on Cα
```

For F2 acalabrutinib post-product (the existing v0.2.20-shipped flow):

```
1. Load 8FD9 (acalabrutinib + BTK).
2. Right-click the SG of A:481 → Declare covalent link
3. Pick C19 of XQQ as Cβ (via "Pick in viewer" or by typing //A/801/C19)
4. Dropdown → CYS-YNA-post
5. Declare + download
6. Verify: augmented mmCIF downloads, in-viewer bonds unchanged
   (post-product is already drawn; mod2 just deletes the spare H)
```

## Repo state at snapshot time

- All commits pushed to both `pykeko/Moorhen-PyKeko` and `pykeko/PyKeko`
- Backfilled the orphaned `MoorhenTimeCapsule.ts arrays:true` commit
  (had been sitting in working tree since v0.2.24 without being
  committed)
- Uncommitted but expected: `~/PyKeko/.attic/`, `~/PyKeko/7sj3.pykeko`
  (local test data), `~/Moorhen/baby-gru/static-test/` (build output),
  `~/PyKekoMCP/package-lock.json` (unrelated to this session's work)
- Both git remotes clean as of the v0.2.29 release

## Where to look first when you come back

1. `RELEASE-HISTORY.md` (in ~/PyKeko) for the one-line release log
2. `~/Desktop/covalent-reaction-chemistry-awareness.md` (status of the
   chemistry-awareness work — captures the F1/F2 design)
3. This file
4. `~/Moorhen/CLAUDE.md` + `~/PyKeko/CLAUDE.md` for the repo-level
   reference docs
