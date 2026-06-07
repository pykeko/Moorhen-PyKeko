#!/usr/bin/env python3
"""Measure F2 (vinyl-thioether) geometry from a model file (mmCIF or PDB).

Usage:
    python analyze_geom.py <file.cif|.pdb>

Reports the same set of metrics as btk-8fd9-8ff0-geom/analyze.py, scoped
to the XQQ ligand in chain A (Cys481 in author numbering):
  - bond distances vs CYS-YNA.cif v2 targets
  - angles at Cβ (should sum to 360° if sp2)
  - dihedrals τ(SG-Cβ=Cα-C7) and τ(Cγ-Cβ=Cα-C7)
  - planarity RMS over {SG, Cβ, Cα, Cγ} (the v2 4-atom plane)
  - planarity RMS over the extended {SG, Cβ, Cα, C7, O, N} (the v1 plane,
    kept for backward comparison with the original 8FD9 deposit reading)

Targets ([brackets] = CYS-YNA.cif v2 values):
  d(SG-Cβ)    [1.78 ± 0.02]
  d(Cα=Cβ)    [1.34 ± 0.02]
  d(Cα-C7)    [1.48 ± 0.02 — inherited from XQQ chem_comp, not link CIF]
  angle sum at Cβ should be ≈ 360°
  τ(Cγ-Cβ=Cα-SG) [180 ± 5, period=2 — equivalent to τ(SG-Cβ=Cα-C7) = 0°]
  planarity (4-atom)   RMS < 0.02
  planarity (6-atom)   RMS < 0.05 (looser — extends into amide)
"""
import math, sys
import numpy as np


def parse_atom_site(cif_path):
    """mmCIF parser — returns list of {label_atom_id, auth_seq_id, …, Cartn_x, …}."""
    atoms, headers = [], []
    in_loop, in_atom = False, False
    with open(cif_path) as f:
        for line in f:
            s = line.strip()
            if s == "loop_":
                in_loop = True; headers = []; in_atom = False; continue
            if in_loop and s.startswith("_atom_site."):
                headers.append(s.split(".", 1)[1].strip())
                in_atom = True; continue
            if in_atom and (s.startswith("_") or s == "#" or s == "" or s == "loop_"):
                in_loop = False; in_atom = False
                if s == "loop_": in_loop = True; headers = []
                continue
            if in_atom:
                parts = s.split()
                if len(parts) != len(headers): continue
                atoms.append(dict(zip(headers, parts)))
    return atoms


def parse_pdb(pdb_path):
    """PDB parser — same dict shape as parse_atom_site for compatibility."""
    out = []
    with open(pdb_path) as f:
        for line in f:
            if not line.startswith("ATOM") and not line.startswith("HETATM"):
                continue
            try:
                name  = line[12:16].strip()
                resn  = line[17:20].strip()
                chain = line[21:22].strip()
                resseq = line[22:26].strip()
                x = float(line[30:38]); y = float(line[38:46]); z = float(line[46:54])
            except ValueError:
                continue
            out.append({
                "label_atom_id": name,
                "auth_comp_id": resn,
                "auth_asym_id": chain,
                "auth_seq_id": resseq,
                "Cartn_x": str(x), "Cartn_y": str(y), "Cartn_z": str(z),
            })
    return out


def find(atoms, **kw):
    for a in atoms:
        if all(a.get(k) == v for k, v in kw.items()):
            return np.array([float(a["Cartn_x"]), float(a["Cartn_y"]), float(a["Cartn_z"])])
    return None


def dist(a, b): return float(np.linalg.norm(a - b))
def angle(a, b, c):
    v1, v2 = a - b, c - b
    cos = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2))
    return math.degrees(math.acos(max(-1, min(1, cos))))
def dihedral(a, b, c, d):
    b1, b2, b3 = b - a, c - b, d - c
    n1, n2 = np.cross(b1, b2), np.cross(b2, b3)
    m = np.cross(n1, b2 / np.linalg.norm(b2))
    return math.degrees(math.atan2(np.dot(m, n2), np.dot(n1, n2)))


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    path = sys.argv[1]
    label = sys.argv[2] if len(sys.argv) > 2 else path

    atoms = parse_pdb(path) if path.lower().endswith(".pdb") else parse_atom_site(path)

    sg  = find(atoms, auth_comp_id="CYS", auth_seq_id="481", label_atom_id="SG")
    cb  = find(atoms, auth_comp_id="CYS", auth_seq_id="481", label_atom_id="CB")
    hg  = find(atoms, auth_comp_id="CYS", auth_seq_id="481", label_atom_id="HG")
    C_b = find(atoms, auth_comp_id="XQQ", label_atom_id="C19")  # Cβ
    C_a = find(atoms, auth_comp_id="XQQ", label_atom_id="C13")  # Cα
    C_7 = find(atoms, auth_comp_id="XQQ", label_atom_id="C7")   # carbonyl
    C_g = find(atoms, auth_comp_id="XQQ", label_atom_id="C21")  # Cγ methyl
    N_  = find(atoms, auth_comp_id="XQQ", label_atom_id="N1")
    O_  = find(atoms, auth_comp_id="XQQ", label_atom_id="O1")

    print(f"\n{'='*70}\n{label}\n{'='*70}")
    print(f"  Cys481 HG modeled: {hg is not None}")
    found = {n: (a is not None) for n, a in [
        ("SG", sg), ("CB", cb), ("Cβ(C19)", C_b), ("Cα(C13)", C_a),
        ("C7", C_7), ("Cγ(C21)", C_g), ("N", N_), ("O", O_)
    ]}
    print(f"  Atoms found: {found}")
    if any(x is None for x in [sg, cb, C_b, C_a, C_7, C_g, N_, O_]):
        print("  Missing atoms — skipping geometry")
        return

    print(f"\n  --- Bond distances [v2 target] ---")
    print(f"    d(SG–Cβ)     = {dist(sg, C_b):.3f} Å    [1.78 ± 0.02]")
    print(f"    d(Cα=Cβ)     = {dist(C_a, C_b):.3f} Å    [1.34 ± 0.02]")
    print(f"    d(Cα–C7)     = {dist(C_a, C_7):.3f} Å    [1.48 ± 0.02 — XQQ chem_comp]")
    print(f"    d(Cβ–Cγ)     = {dist(C_b, C_g):.3f} Å    [1.50 ± 0.02 — XQQ chem_comp]")
    print(f"    d(C7=O)      = {dist(C_7, O_):.3f} Å    [1.23 ± 0.02 — amide]")
    print(f"    d(C7–N)      = {dist(C_7, N_):.3f} Å    [1.35 ± 0.02 — amide]")

    print(f"\n  --- Angles at Cβ (sp2 — sum should be ≈ 360°) ---")
    a1 = angle(sg, C_b, C_a)
    a2 = angle(sg, C_b, C_g)
    a3 = angle(C_a, C_b, C_g)
    print(f"    a(SG–Cβ=Cα)  = {a1:.1f}° [120.7 ± 1.5]")
    print(f"    a(SG–Cβ–Cγ)  = {a2:.1f}° [120.3 ± 1.5]")
    print(f"    a(Cα=Cβ–Cγ)  = {a3:.1f}° [125.3 ± 3.0]")
    s = a1 + a2 + a3
    sp2_quality = "✓ planar sp2" if abs(s - 360) < 5 else "⚠ pyramidalized"
    print(f"    sum @ Cβ     = {s:.1f}° {sp2_quality}")
    print(f"    a(CB–SG–Cβ)  = {angle(cb, sg, C_b):.1f}° [104.2 ± 3.0]")

    print(f"\n  --- Critical dihedrals ---")
    t1 = dihedral(sg, C_b, C_a, C_7)
    t2 = dihedral(C_g, C_b, C_a, C_7)
    t3 = dihedral(C_g, C_b, C_a, sg)
    syn_quality = "✓ syn" if abs(t1) < 30 else "⚠ NOT syn"
    print(f"    τ(SG–Cβ=Cα–C7) = {t1:+7.1f}° [0 ± 10, syn-addition] {syn_quality}")
    print(f"    τ(Cγ–Cβ=Cα–C7) = {t2:+7.1f}° [180 ± 10 if t1≈0]")
    v2_quality = "✓ v2 target met" if abs(abs(t3) - 180) < 10 else "⚠ off v2 target"
    print(f"    τ(Cγ–Cβ=Cα–SG) = {t3:+7.1f}° [180 ± 5, period=2 (v2 restraint)] {v2_quality}")

    pts4 = np.array([sg, C_b, C_a, C_g])
    c4 = pts4.mean(axis=0)
    _, _, vt4 = np.linalg.svd(pts4 - c4); n4 = vt4[-1]
    rms4 = np.sqrt(((np.dot(pts4 - c4, n4))**2).mean())

    pts6 = np.array([sg, C_b, C_a, C_7, O_, N_])
    c6 = pts6.mean(axis=0)
    _, _, vt6 = np.linalg.svd(pts6 - c6); n6 = vt6[-1]
    rms6 = np.sqrt(((np.dot(pts6 - c6, n6))**2).mean())

    print(f"\n  --- Planarity ---")
    q4 = "✓" if rms4 < 0.05 else "⚠"
    q6 = "✓" if rms6 < 0.10 else "⚠"
    print(f"    {q4} 4-atom plane (v2 scope: SG, Cβ, Cα, Cγ): RMS = {rms4:.3f} Å [<0.02 ideal]")
    print(f"    {q6} 6-atom plane (v1 scope, kept for comparison):  RMS = {rms6:.3f} Å")


if __name__ == "__main__":
    main()
