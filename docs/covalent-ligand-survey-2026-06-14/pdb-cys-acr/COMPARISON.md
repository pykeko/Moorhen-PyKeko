# F1 acrylamide post-product — empirical PDB measurement

Cross-validation run 2026-06-14. The AceDRG-based F1 validation (in
sibling folder `acedrg-cys-ibr/`) couldn't independently confirm
CYS-ACR.cif's targets because AceDRG's LINK directive can't perform
the F1 Michael-addition bond-order change. This folder measures the
actual geometry from deposited PDB structures with bound saturated
ibrutinib-class warheads instead.

## Methodology

Downloaded deposited PDB structures with a documented covalent
linkage (struct_conn ptnr2 ≠ HOH) between a Cys SG and the C of
an acrylamide-warhead drug. Required the deposited ligand
chem_comp to encode the **saturated F1 post-Michael form**
(`-S-CH(R)-CH₂-C(=O)-N-`), not the vinyl-thioether F2 alternative
(which several ibrutinib analogs were deposited as instead).

Measured geometry directly from atom coordinates:
- d(SG–Cβ) — the new covalent bond
- d(Cβ–Cα) — should be ~1.54 Å for sp³ C-C
- ∠(CB–SG–Cβ) — Cys-side angle around the sulfur
- ∠(SG–Cβ–Cα) — ligand-side angle around the new sp³ Cβ
- ∠(Cβ–Cα–CO) — angle at Cα (sp³, target ~109.5°)
- τ(CB–SG–Cβ–Cα) — the sp³-sp³ hinge between the protein and ligand
- τ(SG–Cβ–Cα–CO) — the sp³-sp³ thioether torsion

## Results

| Structure | CCD | Cys | d(SG-Cβ) | d(Cβ-Cα) | ∠(CB-SG-Cβ) | ∠(SG-Cβ-Cα) | ∠(Cβ-Cα-CO) | τ(CB-SG-Cβ-Cα) | τ(SG-Cβ-Cα-CO) |
|---|---|---|---|---|---|---|---|---|---|
| **5P9J** | 8E8 | A:481 | **1.850** | 1.599 | **112.86°** | **121.35°** | 107.43° | −83.7° | +59.9° |
| 4G5P | 0WN | A:797 | (skipped — afatinib's 0WN atom naming differs; would need a per-ligand chem_comp walker to map Cβ/Cα/CO/N) | | | | | | |
| 6JX4 | YY3 | A:797 | (skipped — YY3 is deposited as vinyl thioether F2 form, C8=C9 double, not F1 saturated; not a valid F1 reference) | | | | | | |

## CYS-ACR.cif targets vs measured

| Quantity | CYS-ACR.cif target | 5P9J observed | Δ |
|---|---|---|---|
| d(SG–Cβ) | 1.81 ± 0.02 | **1.850** | +0.040 (2σ wider) |
| ∠(CB–SG–Cβ) | 100.0 ± 3.0 | **112.86°** | +12.9° (4σ wider) |
| ∠(SG–Cβ–Cα) | 113.0 ± 2.0 | **121.35°** | +8.4° (4σ wider) |
| ∠(Cβ–Cα–CO) | (not in link; in chem_comp) | 107.43° | sp³ tetrahedral, expected |
| τ(SG–Cβ–Cα–CO) | 180 ± 20 period=3 | +59.9° | gauche, not anti |

## Discussion

5P9J's geometry is wider than my CYS-ACR.cif targets — significantly
wider on the angles around Cβ. Three plausible explanations:

1. **5P9J was refined without a proper chem_link.** Looking at the
   PDB metadata, the deposition pre-dates the routine use of
   custom link CIFs for Cys-covalent drugs. Refmac would have used
   default mmdb distance/angle restraints in the absence of a
   chem_link, allowing the geometry to drift toward whatever the
   data and the ligand's standalone chem_comp allowed.

2. **My CYS-ACR.cif targets are too tight on the angles.** AceDRG
   F3 cross-validation (sibling folder `acedrg-cys-caa/`) gave
   ∠(CB-SG-Cβ) = 101.75° ± 1.50° and ∠(SG-Cβ-Cα) = 110.15° ± 1.50°
   for the chloroacetamide sp³ thioether — those targets are also
   ~100° and 110°, consistent with mine. AceDRG's are CSD aggregates,
   so the "correct" sp³ thioether geometry IS in my ballpark, not
   5P9J's wider values.

3. **F1's specific environment (vs F3's) genuinely allows wider
   angles** because the acrylamide's saturated -CH₂- has more
   conformational freedom than the chloroacetamide's single
   substituent. This is the least likely explanation since both
   are sp³ thioethers.

## What 5P9J tells us

- **d(SG–Cβ) = 1.85 Å is on the high end** of the canonical sp³
  C-S thioether range (1.81–1.83 Å CSD). The struct_conn record
  also reports 1.85 explicitly — this is the refined value. My
  1.81 target is in the lower-half of the CSD distribution; 1.83
  might be a more central choice for a future v2.

- **The Cβ-Cα distance of 1.60 Å is HIGH** vs the 1.54 Å canonical
  sp³ C-C. This further suggests 5P9J was refined with loose
  restraints around the link — a healthy sp³ C-C should be 1.52–
  1.55. The ligand chem_comp would have provided this restraint,
  so its absence from the apparent restraints suggests the link
  area was indeed under-restrained.

- **τ(SG–Cβ–Cα–CO) = +60° (gauche) is NOT the canonical anti = 180°.**
  This is actually plausible — gauche is energetically reasonable
  for sp³-sp³ thioethers (within a few kcal/mol of anti), and the
  binding-pocket geometry of BTK around C481 may favour it. My
  period=3 σ=20° restraint allows gauche too (gauche is +60°, the
  period=3 lets the restraint be satisfied at 180° / +60° / −60°).
  So this isn't a disagreement.

## Verdict on CYS-ACR.cif v1

**The angle targets are likely correct (matching F3 AceDRG values);
5P9J is too soft a reference to override them.** The d(SG–Cβ)
target could shift from 1.81 → 1.83 Å in a v2 to centre better
in the CSD range, with the same ± 0.02 ESD. The torsion period=3
form already accommodates the observed gauche.

For a definitive F1 reference, ideal would be:
1. CSD aggregate statistics on saturated -S-CH(R)-CH₂-C(=O)-N-
   thioethers (3000+ entries in CSD; would give true population
   distributions for each angle/distance/torsion)
2. Or AceDRG-on-post-product-input — generate the chem_comp for
   a saturated thioether amine adduct, then LINK with no
   mod-block-required directive.

Neither is in scope for this session; flagging as future work.

## Files

- `5P9J.cif`, `5P9I.cif`, `4G5P.cif`, `6JX4.cif` — PDB downloads
- `0WN.cif`, `YY3.cif` — CCD ligand definitions
- `cys-bound-survey.py` (the measurement script, run inline above)
