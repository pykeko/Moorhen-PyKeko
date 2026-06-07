# Pre-baked Cys-warhead link CIF library

PyKeko ships hand-authored CCP4 Monomer Library link dictionaries for the
common Cys-covalent warhead families, so the runtime detector can declare a
covalent bond + emit the right `_struct_conn` row + load the matching
chem_link in one step — no AceDRG round-trip needed for the supported
chemistries. See [`covalent-ligand-plan.md`](../../../../docs/covalent-ligand-plan.md)
for the full architecture and rationale.

## File layout

| File | Purpose |
|---|---|
| `index.json` | Registry: SMARTS patterns → link template + mod2 variant. The renderer reads this to drive the auto-detector. |
| `CYS-YNA.cif` | Family F2 link (α,β-ynamide, post-Michael product); contains the link block, the conjugated-plane restraint, mod1 (delete HG on Cys), and the post-product mod2 (delete spare H on Cβ + delete original amide plane). |
| `CYS-YNA-mod2-alkyne.cif` | Alternative mod2 block for when the user uploaded the alkyne pre-Michael form (free drug SMILES). Triggered by SMARTS variant `pre` or `pre_terminal`. |

## Placeholder tokens

The CIFs contain placeholder tokens that the runtime substitutes with the
user's actual ligand atom names + 3/5-char CCD code before emitting the
final CIF blob for `import_cif_dictionary`. The tokens are:

| Token | What it becomes | Example (XQQ in 8FD9) |
|---|---|---|
| `<LIG>` | Ligand CCD code | `XQQ` |
| `<CB>` | Cβ atom-id | `C19` |
| `<CA>` | Cα atom-id | `C13` |
| `<CG>` | Cγ atom-id (substituent on Cβ opposite Cα; H for terminal propiolamide) | `C21` |
| `<CO>` | Carbonyl-C atom-id | `C7` |
| `<N>` | Amide-N atom-id | `N1` |
| `<O>` | Carbonyl-O atom-id | `O1` |
| `<HCB>` | H to delete on Cβ (post-product input) | `H18` |
| `<HCA>` | H to add on Cα (alkyne input) | `H13` |

The atom-name mapping is built by RDKit-WASM SMARTS substructure match — the
SMARTS in `index.json` carries atom-mapping numbers like `[#16][C:1]=[C:2]C(=O)N`
where `:1` and `:2` mark the atoms to extract. The detector walks the
ligand's mmdb residue, finds the carbonyl-C/N/O by following bonds from Cα,
and finds the H-on-Cβ by walking Cβ's hydrogen neighbours.

## Provenance for the CYS-YNA values

Geometry targets in `CYS-YNA.cif` are drawn from:

- Cambridge Structural Database means for vinyl thioether + α,β-unsat amide
  patterns (S–Csp2 1.77–1.80 Å, Csp2=Csp2 1.33–1.34 Å)
- Direct measurement on PDB 8FD9 (acalabrutinib + BTK, 1.70 Å) and 8FF0
  (tirabrutinib + BTK, 2.60 Å) at
  [`../../../../docs/covalent-ligand-survey-2026-06-05/btk-8fd9-8ff0-geom/`](../../../../docs/covalent-ligand-survey-2026-06-05/btk-8fd9-8ff0-geom/)
- The Nicholls & Murshudov 2021 "missing link" methods paper at
  [`../../../../docs/refs/nicholls-modelling-2021.pdf`](../../../../docs/refs/nicholls-modelling-2021.pdf)
- AceDRG cross-validation (2026-06-07): the full canonical reference is at
  [`../../../../docs/covalent-ligand-survey-2026-06-05/acedrg-cys-xqq/`](../../../../docs/covalent-ligand-survey-2026-06-05/acedrg-cys-xqq/)
  including the side-by-side `COMPARISON.md` and the generated `cys-xqq_link.cif`.
  CYS-YNA.cif v2 incorporates AceDRG's tighter sp2-angle ESDs (1.5° instead of
  3.0°), narrower plane scope ({SG, Cβ, Cα, Cγ} not the wider 6-atom plane),
  and the sp3-sp2 soft torsion on the SG–CB hinge.

## Architecture status (phase 1, Track B mostly complete)

- [x] CYS-YNA hand-authored template + post-product mod2 + v2 AceDRG-adjusted
- [x] Alkyne-input alternative mod2
- [x] index.json registry with three SMARTS patterns
- [x] JS-side detector + atom-name substitution + orchestrator
- [x] AceDRG cross-validation reference
- [ ] UI integration (right-click on Cys SG)
- [ ] Refmacat round-trip on 8FD9 (Track C step 2)

Other warhead families (F1 acrylamide, F4 chloroacetamide, F6 reversible
carbonyl) will be added once the F2 pipeline is end-to-end validated.
