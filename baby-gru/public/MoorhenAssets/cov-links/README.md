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
| `<CO>` | Carbonyl-C atom-id | `C7` |
| `<N>` | Amide-N atom-id | `N1` |
| `<O>` | Carbonyl-O atom-id | `O1` |
| `<HCB>` | H to delete on Cβ (post-product input) | `H18` |
| `<HCA>` | H to add on Cα (alkyne input) | `H13` |
| `<AMIDE_PLANE>` | Original plane restraint id in the ligand monomer dict | varies; introspected at runtime |

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
- AceDRG reference values still TBD — pending CCP4 install on dev machine.
  Once available, regenerate the canonical CYS-YNA via:
  ```
  acedrg -L cys-xqq-link-instr.txt -o cys-xqq
  ```
  and diff against this hand-authored version. Tighten ESDs where AceDRG
  shows narrower distributions.

## Architecture status (phase 1, Track B in progress)

- [x] CYS-YNA hand-authored template + post-product mod2
- [x] Alkyne-input alternative mod2
- [x] index.json registry with three SMARTS patterns
- [ ] JS-side detector + atom-name substitution (next)
- [ ] UI integration (right-click on Cys SG)
- [ ] AceDRG cross-validation reference
- [ ] Refmacat round-trip on 8FD9

Other warhead families (F1 acrylamide, F4 chloroacetamide, F6 reversible
carbonyl) will be added once the F2 pipeline is end-to-end validated.
