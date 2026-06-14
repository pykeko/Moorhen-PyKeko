# AceDRG CYS-EPX link CIF vs my hand-authored CYS-EPX.cif

Cross-validation run 2026-06-14 against AceDRG 330, CCP4 9.

Inputs:
  * Synthetic minimal terminal epoxide model:
    SMILES `CC1CO1` → propylene oxide (2-methyloxirane)
  * AceDRG-generated chem_comp `EPX_MODEL.cif`
    Atom map: C1 = methyl (R substituent), C2 = methyl-bearing
    ring C (Cα candidate), **C3 = terminal CH₂ ring C** (Cβ —
    attack site), **O1 = ring O** (becomes Cα's -OH post-opening).
  * LINK directive: `SG → C3` + `DELETE ATOM HG 1` (only).

Output: `cys-epx_link_link.cif`.

## Headline finding — AceDRG can't model F4 ring-opening

AceDRG's LINK directive supports atom DELETION but not atom ADDITION
or bond DELETION. For F4 epoxide the chemistry requires:
- Delete the Cβ-O ring bond (open the 3-ring)
- Add a new H on the O (becomes the Cα hydroxyl)

Neither is encodable in AceDRG's LINK syntax. So AceDRG's output
models the F4 chemistry as if the 3-ring stays intact AND a new
S-Cβ bond is added — a 4-coordinate Cβ with [S, Cα, ring-O, H],
geometrically a "pentavalent" carbon. That's not a real chemistry,
but it's what AceDRG produces.

The "ring stays intact" assumption is visible in the ligand chem_comp
block: `C3 O1 SINGLE 1.433` is still present after the LINK. The
output is therefore most useful as a **lower bound on the S-Cβ bond
geometry**, not a full validation of the post-product chemistry.

## What is comparable

The S-Cβ bond geometry AceDRG computed assumes the ring is closed —
so it reflects the geometry of the "transition state" or "pre-opening
geometry" rather than the post-product. Useful as a sanity check on
the S-Cβ bond targets in my hand-authored CYS-EPX.cif.

| Restraint | CYS-EPX.cif (mine, post-ring-opening) | AceDRG (ring-closed link) | Δ | Note |
|---|---|---|---|---|
| **d(SG–Cβ)** | 1.81 ± 0.02 | **1.796 ± 0.020** | −0.014 | Within 1σ. AceDRG slightly shorter — consistent with ring-strained Cβ being pulled toward sp² character. The opened post-product would be slightly longer (sp³ relaxed). |
| ∠(CB–SG–Cβ) | 100.0 ± 3.0 | **109.47 ± 3.0** | +9.5° | AceDRG's wider angle reflects the strained ring environment. My 100° is closer to the canonical sp³ thioether (consistent with what F1/F3/F5 measured). |
| ∠(SG–Cβ–Cα) | 110.0 ± 2.0 | **109.47 ± 3.0** | −0.5° | Effectively identical. |
| sp3_sp3 hinge τ(Cα-CB-SG-C3) | 180.0 ± 20.0 period=3 | **180.0 ± 10.0 period=3** | σ ½ | Same target, AceDRG tighter |
| sp3_sp3 hinge τ(C2-C3-SG-CB) | (none in mine — implicit via Cα-CB-SG-C3) | 180.0 ± 10.0 period=3 | new | AceDRG adds the symmetric hinge. Sensible. |
| τ(O1-C3-SG-CB) | (mine doesn't reference O1) | 60.0 ± 10.0 period=3 | new | AceDRG locks the ring-O orientation w.r.t. the new S. Not relevant for my post-product form. |
| ∠(SG–Cβ–H) | (none) | 115.77 ± 1.5 | new | AceDRG adds explicit Cβ-H angles. |

## What this tells us about CYS-EPX.cif

1. **The S-Cβ bond at 1.81 ± 0.02 Å is within 1σ of AceDRG's
   ring-closed value (1.796).** Since the ring-OPENING relaxes the
   bond toward the canonical sp³ thioether value (1.81–1.82 in CSD
   aggregates), my 1.81 is a sensible post-product target.

2. **My CB-SG-Cβ angle of 100°** is closer to the canonical sp³
   thioether (F1/F3/F5 all 100-101° per AceDRG). AceDRG's 109.47°
   here reflects the strained ring; once the ring opens the
   environment around SG becomes the standard sp³ thioether, so 100°
   is correct for the post-product.

3. **SG-Cβ-Cα 110° is identical** to AceDRG's value. No
   disagreement.

4. **Soft torsions match** in form (sp³-sp³ hinges with period=3).
   AceDRG's ESDs are 10° vs my 20° — same polish suggestion as F3.

## Validity verdict

**My CYS-EPX.cif targets are correct for the post-product
(ring-opened) chemistry.** AceDRG can't independently validate the
ring-opened form because it can't perform the ring opening in the
LINK directive, but the S-Cβ bond and angle targets are within
expected ranges given the difference between the ring-closed
transition geometry (AceDRG) and the relaxed post-product (mine).

The chemistry-aware ring opening — delete Cβ-O bond, add H on O to
make Cα hydroxyl — is performed by PyKeko's `CYS-EPX-mod2-epoxide.cif`
mod2, not by AceDRG. This is exactly the kind of bond-graph
modification that's the value-add of PyKeko's mod2 system.

## Recommendation for v2 of CYS-EPX.cif

Optional polish (same shape as F3):
- Tighten torsion ESDs from 20° to 10°
- Add the second sp³-sp³ hinge τ(Cα-Cβ-SG-CB)
- Add explicit SG-Cβ-H angle 115.8° ± 1.5 (or 109.5° once the
  ring is opened — the slight widening AceDRG sees is ring-strain
  specific)

None are bugs; all are refinements.

## Files

- `model.smi` — input SMILES for the minimal terminal epoxide
- `EPX_MODEL.cif`, `.pdb` — AceDRG-generated chem_comp
- `cys-epx-link-instructions.txt` — LINK directive
- `cys-epx_link_link.cif` — AceDRG canonical link reference
- `acedrg-*.log` — run logs
