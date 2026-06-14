# AceDRG CYS-1E8 (ibrutinib) link CIF vs my hand-authored CYS-ACR.cif

Cross-validation run 2026-06-14 against AceDRG 330, CCP4 9.
Inputs:
  * 1E8 from RCSB → `1E8-rcsb.cif` (free ibrutinib, prop-2-en-1-one
    warhead with C=C still drawn)
  * 1E8 regenerated through AceDRG → `1E8-acedrg.cif`
  * `cys-ibr-link-instructions.txt`:
    ```
    LINK: RES-NAME-1 CYS ATOM-NAME-1 SG RES-NAME-2 1E8
          ATOM-NAME-2 CAA FILE-2 1E8-acedrg.cif
          DELETE ATOM HG 1 DELETE ATOM HAA 2
    ```
  * In 1E8 atom convention: CAA = terminal CH₂ (Cβ),
    CAD = vinyl Cα, CAW = carbonyl C, OAC = carbonyl O,
    NBG = amide N.

Output: `cys-ibr_link_link.cif`.

## Headline finding — AceDRG ≠ F1 Michael product

**AceDRG kept the Cα=Cβ double bond.** Look at the link CIF bond block:

```
1E8 CAA CAD  DOUBLE  1.296 0.0149
```

After the LINK declaration (with HAA deleted from CAA), AceDRG
modelled the result as a **vinyl thioether** — `-S-CH=CH-C(=O)-N-` —
not a saturated β-thioether. This is **F2 chemistry, not F1**.

For ibrutinib specifically the bound form in 5P9I is the F1
Michael-addition product (saturated `-S-CH₂-CH₂-C(=O)-N-`).
AceDRG's output does NOT match that chemistry — it preserves the C=C
because the LINK directive doesn't tell AceDRG to add the Michael
proton on Cα.

This isn't a bug in AceDRG; it's a limitation of the LINK directive
format. AceDRG can encode bond-creation (the S-Cβ bond) and atom-
deletion (the HG and HAA), but not bond-order change (C=C → C-C) or
atom-addition (the new H on Cα). For F2 ynamide → vinyl thioether
the chemistry preserves bond orders modulo the H deletions, so
AceDRG's output matches reality. For F1 acrylamide → saturated
thioether the chemistry requires bond-order changes that AceDRG
doesn't perform.

**The F1 chemistry-aware step is what PyKeko's mod2 system
contributes** beyond AceDRG. PyKeko's CYS-ACR-mod2-alkene.cif
explicitly changes `<CB> <CA> double → single` and adds the new H
on Cα with retyping CR1 → CT. AceDRG doesn't have an analogous
mechanism in its LINK directive format.

## Side-by-side restraint comparison (vinyl-thioether geometry only)

The comparison below is **only valid for the F2-style vinyl thioether
output AceDRG produced** — not the F1 saturated product that
CYS-ACR.cif targets. Useful as a sanity check on the link
mechanics; not a substantive geometry validation.

| Restraint | CYS-ACR.cif (sat. F1) | AceDRG (vinyl F2-like) | Notes |
|---|---|---|---|
| d(SG–Cβ) | 1.81 ± 0.02 (sp³) | 1.83 ± 0.02 (sp²) | AceDRG slightly longer because the sp²-C-S bond it modelled is wider than the sp³-C-S we target |
| ∠(CB–SG–Cβ) | 100 ± 3 | 100.873 ± 3.00 | Cys side identical |
| ∠(SG–Cβ–Cα) | 113 ± 2 (sp³ tetrahedral) | 121.938 ± 3.00 (sp² trigonal) | Different hybridisation → ~9° difference |
| ∠(SG–Cβ–H) | 109.5 ± 3 (sp³ terminal) | 119.044 ± 1.67 (sp² vinyl-H) | Same as above |
| Dihedral around SG–Cβ | sp3_sp3_thioether 180.0 ± 20, period=3 | sp2_sp3_1 (CA-CB-SG-CAA) 180.0 ± 20, period=3 | AceDRG matches our soft torsion convention |
| Plane | (none — sp³ system) | plan-6 over {SG, CAA, CAD, HAAA} | AceDRG plane over the vinyl is appropriate FOR THE GEOMETRY IT MODELLED but not for the actual F1 product |

## What this means for CYS-ACR.cif

1. **AceDRG cannot be used as the reference for F1 chemistry.** Its
   LINK format produces a vinyl thioether (F2-like) regardless of
   the actual mechanism, when given a free acrylamide input. For F1,
   the canonical reference is CSD aggregate statistics on
   saturated -S-CH(R)-CH₂- thioethers plus deposited bound-state
   PDBs (5P9I, 5P9J for ibrutinib + BTK).

2. **Validate against deposited PDBs.** The 5P9I bound ibrutinib's
   ligand has the saturated -S-CH₂-CH₂-C(=O)-N- form. Measuring
   the S-Cβ distance, ∠(CB-SG-Cβ), ∠(SG-Cβ-Cα), and the Cβ-Cα-Cα-CO
   dihedral from the deposited coordinates would give an empirical
   target. Note these will reflect the refinement that produced the
   deposited structure, including whatever link CIF was used at the
   time — so they're a less independent reference than CSD means.

3. **CYS-ACR.cif's 1.81 Å S-Cβ target is plausible** vs the AceDRG
   1.83 Å for the vinyl analogue; sp³ C-S is consistently shorter
   than sp² C-S in CSD (1.81 vs 1.83 typical), so 1.81 ± 0.02 is
   the right ballpark even though AceDRG can't directly confirm.

4. **The hybridisation choice is the key F1 decision.** PyKeko's
   F1 modelling (mod2-alkene + sp³ angles + no plane) is internally
   consistent and matches the post-Michael chemistry. AceDRG's
   inability to perform the bond-order change is the gap.

## Pipeline architecture takeaway

For F-families that involve **bond-order changes** at the link site
(F1 alkene→single, F2 alkyne→double, F5 maleimide ring alkene→single,
F6 carbonyl C=O→C-O), AceDRG's LINK directive is INSUFFICIENT.
PyKeko's mod2 mechanism — applied to the ligand's chem_comp dict
both at refmacat time (via the loaded link CIF) and at live-display
time (via `read_dictionary_string` reload) — is necessary to model
the actual chemistry.

For F-families WITHOUT bond-order changes at the link site (F3
chloroacetamide SN2: Cl→S swap, F4 epoxide opening: ring bond
breaks but no order change), AceDRG would produce the correct
geometry directly. We could potentially use AceDRG to validate
F3 and F4 link CIFs once those have validation targets.

## Files

- `1E8-rcsb.cif` — Source RCSB chem_comp for free ibrutinib
- `1E8-acedrg.cif` — AceDRG-regenerated ibrutinib chem_comp
- `1E8-acedrg.pdb` — AceDRG-output 3D coords
- `cys-ibr-link-instructions.txt` — The LINK directive
- `cys-ibr_link_link.cif` — AceDRG-generated link CIF
- `acedrg-1E8.log` — Log of the ibrutinib regeneration
- `acedrg-link.log` — Log of the link generation
