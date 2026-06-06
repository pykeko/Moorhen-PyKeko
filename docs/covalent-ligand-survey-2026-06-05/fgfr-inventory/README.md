# FGFR1/2/3/4 Cys-covalent PDB inventory

RCSB-wide inventory of covalent-ligand structures bound to FGFR1
(UniProt P11362), FGFR2 (P21802), FGFR3 (P22607), and FGFR4 (P22455),
classified by the F1–F6 warhead-family taxonomy in
[`../../covalent-ligand-plan.md`](../../covalent-ligand-plan.md) §2.0.

## Headline finding: zero F2 entries

| Target | Total Cys-cov | F1 (acrylamide) | F2 (ynamide) | F4 | F6 | Nitrile | Reactive Cys |
|--------|---:|---:|---:|---:|---:|---:|---|
| FGFR1  | 11 | 11 | **0** | 0 | 0 | 0 | 8/11 Cys488; 3 Cys563 (Y563C mutant) |
| FGFR2  | 11 | 11 | **0** | 0 | 0 | 0 | 11/11 Cys491 |
| FGFR3  |  5 |  5 | **0** | 0 | 0 | 0 | 5/5 Cys482 |
| FGFR4  | 31 | 15 | **0** | 7 | 4 | 5 | 26/31 Cys552; 5 Cys477 |
| **All**| **58** | **42** | **0** | **7** | **4** | **5** | |

**Across all 58 FGFR Cys-covalent deposits, NO α,β-ynamide / butynamide /
propynamide is present.** The whole FGFR covalent-drug landscape went
acrylamide (FIIN series, BLU-554/fisogatinib, H3B-6527, futibatinib) or
aldehyde-reversible (roblitinib), not ynamide.

If the lab develops FGFR-targeting F2 inhibitors, **the first deposit
would be the first FGFR ynamide structure in the PDB** — a publishable
provenance angle.

## Two important reclassifications discovered during this work

1. **Futibatinib (TAS-120, FDA 2022) is acrylamide F1, not butynamide
   F2** as initially assumed. Canonical SMILES
   `C=CC(=O)N1CC[C@H](n2nc(C#Cc3cc(OC)cc(OC)c3)c3c(N)ncnc32)C1` — the
   `C=C` near the carbonyl is the reactive warhead (standard acrylamide);
   the `C#C` is a 3,5-dimethoxyphenyl-ethynyl scaffold linker, not the
   warhead. PDB ligand codes: **TZ0** (pre-Michael acrylamide) and
   **A1AFR** (post-Michael propanoyl).
2. **Roblitinib (FGF401, ligand FGF, PDBs 6JPJ/6YI8) is F6 aldehyde
   hemithioacetal, not F1 acrylamide.** IUPAC name
   "7-methanoyl-naphthyridine" has a formyl/aldehyde, not an acrylamide.

## Small relevant subset (the FGFR slice worth pulling)

Even without F2 hits, the highest-resolution F1 acrylamides in the same
target space are the closest geometry analogs for a re-refinement test:

| ⭐ | PDB | Year | Res | Target / Cys | Ligand | Drug | Why |
|---|---|---|---|---|---|---|---|
| ⭐⭐⭐ | **8W3D** | 2025 | 2.04 Å | FGFR2 / Cys491 | TZ0 | Futibatinib (pre-Michael) | The FDA-approved drug the user initially thought was butynamide; highest-res Futibatinib deposit |
| ⭐⭐⭐ | **6JPE** | 2019 | 1.60 Å | FGFR4 / Cys552 | BYU | Hagel-class acrylamide | Highest-res FGFR4; Cys552 is the unique selectivity opportunity |
| ⭐⭐ | **6MZW** | 2019 | 2.20 Å | FGFR1 / Cys488 | TZ0 | Futibatinib (pre-Michael) | Second Futibatinib; cross-target FGFR1 vs FGFR2 comparison |
| ⭐⭐ | **8XLQ** | 2024 | 1.95 Å | FGFR4 / Cys552 | A1LVQ | CXF007 bivalent bis-acrylamide | Unusual two-warhead topology test case |

## Futibatinib deposit roster (all 5)

| PDB | Year | Res | Target | Lig | State | Cys |
|---|---|---|---|---|---|---|
| 8W3D | 2025 | 2.04 Å | FGFR2 | TZ0 | pre | Cys491 |
| 8W3B | 2025 | 2.23 Å | FGFR2 | TZ0 | pre | Cys491 |
| 8W38 | 2025 | 2.60 Å | FGFR2 | TZ0 | pre | Cys491 |
| 8W2X | 2025 | 2.98 Å | FGFR2 | A1AFR | post | Cys491 |
| 6MZW | 2019 | 2.20 Å | FGFR1 | TZ0 | pre | Cys488 |

The TZ0 ≠ A1AFR dual-encoding for the same drug pre- vs post-Michael is
a textbook plan-doc §1.6 deposition-lossiness case.

## FGFR4 Cys552 — the unique selectivity opportunity

26 of 31 (84%) FGFR4 covalent entries hit Cys552. FGFR1/2/3 have Gly at
the equivalent position, so any drug exploiting Cys552 gets FGFR4
selectivity for free. 5 FGFR4 entries hit Cys477 instead (4QQ5, 4QQC,
4R6V, 5NWZ, 6IUO — Bertrand 2014+ acrylamides binding a different
surface Cys).

**No butynamide hits Cys552 in any deposit.** A lab F2 inhibitor
targeting Cys552 would be a genuinely novel deposit.

## Edge cases worth flagging

1. **Futibatinib double-encoding** (TZ0 ≠ A1AFR for same drug) —
   deposition-state inconsistency that PyKeko's auto-detection should
   collapse.
2. **CXF007 (A1LVQ)** bivalent bis-acrylamide on 8XLQ (FGFR4) + 8XLO
   (FGFR1) — two warheads, only one engaged per entry; needs a two-headed
   link template for future generalization.
3. **Roblitinib mis-classified upstream** as F1 in some literature — it's
   F6 aldehyde.
4. **5-char chem_comp codes** (A1AFR, A1LVQ, A1LWW, etc.) — 13 FGFR
   entries; PyKeko covalent-link runtime must handle ≤5-char resnames
   and mmCIF-only output.
5. **5NUD / 99K**: 2-chloro-3-CF₃-pyridine at 1.67 Å from Cys-SG with no
   acrylamide visible — possible SNAr fragment hit; needs manual
   inspection before training-set inclusion.
6. **FGFR1-Y563C surrogate construct** (5VND, 6P68, 6P69) — engineered
   mutation to mimic FGFR4 Cys552; not actually FGFR1 covalent chemistry
   per se.

## Files

- `inventory.md` — full markdown inventory
- `FGFR_per_entry_with_cys.json` — final per-entry rollup with Cys-UniProt
  mapping
- `FGFR_per_entry_refined.json` — pre-Cys-mapping per-entry rollup
- `FGFR_classified_refined.jsonl` — per-hit lines (one row per Cys-SG bond)
- `ALL_FGFR_ids.json`, `FGFR{1,2,3,4}_all_ids.json` — input PDB ID lists
- `*.py` — reproducing pipeline (query, fetch, classify, refine, cys_map)

Reproducing: `query_rcsb.py` → `fetch_entries.py` → `classify.py` →
`cys_mapping.py` → `append_analysis.py`. ~3 min wallclock at API limits.
