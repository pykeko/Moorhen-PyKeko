# 8FD9 vs 8FF0 — empirical F2 geometry analysis

Direct measurement of the vinyl-thioether-amide geometry in the two
canonical BTK + butynamide PDB entries, against the targets in
[`../../covalent-ligand-plan.md`](../../covalent-ligand-plan.md)
Appendix A.6.

- **8FD9** — BTK + acalabrutinib (XQQ), 1.70 Å (the "better" model)
- **8FF0** — BTK + tirabrutinib (7GB), 2.60 Å

Run `python3 analyze.py` to reproduce — no external deps beyond numpy.

## Results headline

|  | 8FD9 (1.70 Å) | 8FF0 (2.60 Å) | Target |
|---|---:|---:|---:|
| HG on Cys481 modelled? | no ✓ | no ✓ | (mod1 applied implicitly) |
| d(SG–Cβ) | 1.683 Å | 1.696 Å | 1.80 |
| d(Cα=Cβ) | 1.318 Å | 1.362 Å | 1.34 |
| d(Cα–C7carbonyl) | 1.347 Å (very short!) | 1.577 Å (long) | 1.48 |
| d(Cβ–Cγ methyl) | 1.496 Å | 1.557 Å | 1.50 |
| d(C7–N amide) | 1.346 Å | 1.490 Å (long) | 1.35 |
| d(C7=O) | 1.225 Å | 1.216 Å | 1.23 |
| **Angle sum at Cβ** | **312.3°** ⚠️ | 360.0° ✓ | 360 (sp2) |
| a(SG–Cβ=Cα) | 81.3° (broken!) | 128.5° | 122 |
| **τ(SG–Cβ=Cα–C7)** | **−89.2°** (perpendicular) | **+2.3°** (clean syn) | 0 (or 180) |
| **Planarity RMS {SG,Cβ,Cα,C7,O,N}** | 0.477 Å | 0.486 Å | < 0.05 |

## Headline reading

1. **8FD9 (the "better" model by resolution) is the more geometrically
   distorted of the two.** Cβ is pyramidalized (angle sum 312° instead of
   360°), τ(SG–Cβ=Cα–C7) sits at −89° (the conjugated π system isn't
   conjugated), Cα–C7 is suspiciously short at 1.35 Å (closer to a
   double-bond distance), and planarity RMS is ten times worse than a
   properly-refined conjugated system.

2. **8FF0 (2.60 Å) has cleaner local geometry at Cβ** — proper sp2 angle
   sum (360°), proper τ = +2.3° syn-addition (exactly what the Nicholls
   papers predict for syn thia-Michael) — but the bonds are systematically
   longer (Cα–C7 = 1.58 Å, C–N = 1.49 Å, drift typical of low-resolution
   under-restraint).

3. **Both have RMS planarity ~0.48 Å vs target ~0.05 Å.** Neither was
   refined with a proper link dictionary; both are concrete examples of
   the "missing link" geometric drift Nicholls 2021 quantifies. The
   PyKeko workflow (declare `_struct_conn` + load CYS-YNA link CIF +
   `refmacat`) would rescue both.

4. **Higher resolution + missing link restraints actually produces
   *worse* chemistry than lower resolution** because the high-res data
   forces refinement to follow unrestrained reality (including pocket
   distortion artifacts), whereas low-res averages over noise and lands
   closer to the geometry generic restraints want. Publishable observation
   in its own right.

## Implication for plan-doc Appendix A.1

The empirical syn-addition target `τ = 0° ± 20° period=2` from Appendix A.1
should be tightened to `0° ± 15° period=1` for actively-refined cases,
with period=2 as a fallback only when the user explicitly asks (e.g. for
re-refining a structure that's already drifted past 90°, like 8FD9).
8FF0 is the empirical evidence: when low-res data doesn't fight the
restraint, syn geometry holds at within 3° of 0°.

## "Before / after" demonstration the user could publish

Take 8FD9, declare the `_struct_conn` SG↔C19 row (already there in the
deposited mmCIF), hand-author the CYS-YNA link CIF following Plan-doc
Appendix A.1, and re-refine via `refmacat`. Predictions:
- Angle sum at C19 returns to ≈360°
- τ(SG–C19=C13–C7) swings from −89° toward 0°
- Planarity RMS drops from 0.48 Å to <0.05 Å
- C19=C13 stays at ≈1.34 Å, C13–C7 corrects from 1.35 → ≈1.48 Å
- R/Rfree holds or improves

If those predictions hold, that's a clean "before/after" figure for any
paper or talk about the PyKeko workflow — the Mpro Fig 9 in Nicholls 2021,
but for BTK + the lab's chemistry.

## Files

- `8FD9.cif` — RCSB mmCIF (804 KB, freely re-downloadable from
  https://files.rcsb.org/download/8FD9.cif)
- `8FF0.cif` — RCSB mmCIF (702 KB,
  https://files.rcsb.org/download/8FF0.cif)
- `analyze.py` — geometry analysis script (numpy only)
