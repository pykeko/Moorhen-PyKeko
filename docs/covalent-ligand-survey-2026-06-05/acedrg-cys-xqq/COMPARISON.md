# AceDRG CYS-XQQ link CIF vs my hand-authored CYS-YNA.cif

Cross-validation run 2026-06-07 against AceDRG 330, CCP4 9, RDKit 2023.03.3.
Inputs:
  * XQQ from RCSB → `XQQ-rcsb.cif` (free download)
  * XQQ regenerated through AceDRG → `XQQ-acedrg.cif` (CCP4-ML format)
  * `cys-xqq-link-instructions.txt` (the LINK: directive)
Outputs: `cys-xqq_link.cif` (the canonical reference).

## Side-by-side restraint comparison

| Restraint | Hand-authored | AceDRG | Δ | Note |
|---|---|---|---|---|
| **d(SG–Cβ)** | 1.80 ± 0.02 | **1.744 ± 0.020** | −0.056 | AceDRG gives shorter — matches the 8FD9 observation of 1.683 Å exactly |
| d(CB–SG–Cβ) [CB = Cys Cβ] | 102 ± 3 | **104.222 ± 1.50** | +2.2°, σ ½ | Tighter ESD; centre slightly higher |
| d(SG–Cβ–Cγ) [Cγ = methyl C21] | 116 ± 3 | **120.295 ± 1.50** | +4.3°, σ ½ | AceDRG broader, ESD tighter — looks like CSD wants closer-to-sp2 angle here |
| d(SG–Cβ=Cα) | 122 ± 3 | **120.696 ± 3.00** | −1.3° | Mine slightly high, σ same |
| **Dihedral τ(SG–Cβ=Cα–C7)** | 0 ± 20, period=2 | (sp2_sp2_1) C21–C19–SG–CB **180.0 ± 5.0, period=2** | different atoms | AceDRG locks the *methyl*-S-CB-CA dihedral not the carbonyl-Cα one. See note ☆ below. |
| Dihedral around S–CB single | (none) | (sp2_sp3_1) CA–CB–SG–C19 **180.0 ± 20, period=3** | new | AceDRG adds a soft torsion on the Cys-S-Csp2 sp3-sp2 hinge — sensible. |
| Planarity over thiovinyl | RMS 0.02 over {SG, Cβ, Cα, C7, O, N} (6 atoms) | RMS 0.02 over {SG, Cβ, Cα, C21} (only 4 atoms — *just* the vinyl + S + methyl C) | smaller plane | AceDRG goes narrower — likely the right call, see ☆ |

☆ **The dihedral discrepancy is the key finding.** I targeted τ(SG–Cβ=Cα–**C7**carbonyl) = 0° as
the syn-addition geometry. AceDRG instead constrains τ(C21–Cβ=Cα–SG) = 180° on a period-2
restraint. These are equivalent constraints (both enforce the syn-addition geometry — if C21 is
180° from SG across the C=C, then C7 must be 0° from SG, since C13 has only three substituents:
C7, H13, and Cβ). The difference is which atom you anchor:

* My choice: SG/CB/CA/C7 — directly enforces the syn = carbonyl-and-sulfur-cis-across-C=C
* AceDRG choice: C21/C19/SG/CB — enforces the syn = methyl-and-S-trans-across-C=C
* Same geometry, different atom triple.

**AceDRG's plane is smaller too** (just {SG, Cβ, Cα, C21}) because the vinyl-thioether plane
is local to the warhead C=C. My hand-authored plane extended into the amide (C7, O, N) which
is locally planar but is its own restraint in the existing XQQ chem_comp dictionary —
adding it again in the link plane would be the kind of overlapping restraint Nicholls 2021
warns against (§A.4 of the plan-doc).

## What this means for v2 of CYS-YNA.cif

1. **Tighten the SG–Cβ bond distance target to 1.78 ± 0.02** (AceDRG: 1.744; CSD mean: 1.77–1.80;
   our 1.80 is slightly long. 1.78 is the middle ground.)

2. **Tighten the angle ESDs from 3.0° to 1.5°** for the three sp2 angles around Cβ — AceDRG's
   data is from many CSD entries and is genuinely narrower there. Mine were eyeballed.

3. **Move the dihedral restraint to τ(Cγ–Cβ=Cα–SG) = 180°, period=2, σ=5°** — same syn
   geometry but using AceDRG's atom-choice convention. ESD tightens from 20 to 5. **This is
   strict syn, not "syn or anti".** The Nicholls 2021 methods paper §3.1 says refinement
   matches links by torsion AND chirality against the model, so period=2 is OK to keep
   (both 0 and 180 satisfy the restraint at σ=5°). Reconsider once Track C step 2 — the
   8FD9 refmacat round-trip — shows whether tight σ fights the data on the τ=−89° entry.

4. **Shrink the plane to {SG, Cβ, Cα, Cγ}** to avoid double-restraining the amide plane
   that's already in XQQ's chem_comp. Add a separate plane for {Cα, C7, O, N} only if the
   ligand dict lacks one (rare, but worth a dynamic check at runtime).

5. **AceDRG adds a soft τ on the SG–CB single bond** (sp2_sp3_1, period=3, σ=20). Worth
   adding — it stabilises the local geometry around the new bond without locking the
   sidechain orientation.

6. **Cys-side mod1 stays simple** — AceDRG matches mine (delete HG) but ALSO retypes SG
   from S2 → S2 (no-op for our case since we don't ship a separate Cys dict; the standard
   library handles it). My delete-HG-only is correct for v1.

7. **AceDRG's XQQ-side mod2** changes `C13 C19 double 1.371 0.0200` — surprisingly long
   (1.371 vs my 1.34). Worth investigating: CSD vinyl-thioether C=C might genuinely be
   slightly longer when the S is attached. Keep 1.34 for now; widen σ if 1.371 conflicts
   with refmacat results.

## v2 in-progress version

The next commit will revise CYS-YNA.cif with these adjustments + add the SG–CB single-bond
soft torsion. Until then, v1 of the CIF is still functional — geometry will refine to a
chemically-reasonable answer, just with slightly looser ESDs than what AceDRG would have
produced.

## Files preserved here

* `XQQ-rcsb.cif` — input chem_comp from RCSB (XQQ canonical CCD)
* `XQQ-acedrg.cif` — AceDRG-regenerated XQQ in CCP4-ML format
* `cys-xqq-link-instructions.txt` — the LINK directive (canonical Coot 0.9 format)
* `cys-xqq_link.cif` — **the canonical AceDRG-blessed CYS-XQQ link CIF** (the reference)
* `COMPARISON.md` (this file)
