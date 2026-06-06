#!/usr/bin/env python3
"""Measure F2 (vinyl-thioether) geometry in 8FD9 + 8FF0.

Atom-name maps (warhead atoms):
  XQQ (acalabrutinib): C19=Cβ  C13=Cα  C7=carbonyl  C21=methyl  N1=amideN  O1=O
  7GB (tirabrutinib):  C19=Cβ  C18=Cα  C16=carbonyl C20=methyl  N14=amideN O17=O
"""
import math
import numpy as np

def parse_atom_site(cif_path):
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

# (cb_atom, ca_atom, c7_atom, cgamma_atom, ng_atom, o_atom, h_ca, h_cb)
NAMES = {
    "XQQ": ("C19", "C13", "C7",  "C21", "N1",  "O1",  "H13", "H18"),
    "7GB": ("C19", "C18", "C16", "C20", "N14", "O17", None,  None ),
}

for code, ligand in [("8FD9", "XQQ"), ("8FF0", "7GB")]:
    cb_n, ca_n, c7_n, cg_n, n_n, o_n, hca_n, hcb_n = NAMES[ligand]
    print(f"\n{'='*72}\n{code} (BTK Cys481 + {ligand})")
    with open(f"/tmp/pdb-btk/{code}.cif") as f:
        for line in f:
            if line.startswith("_refine.ls_d_res_high"):
                print(f"  resolution: {line.split()[1]} Å")
                break
    print('='*72)

    atoms = parse_atom_site(f"/tmp/pdb-btk/{code}.cif")
    sg  = find(atoms, auth_comp_id="CYS", auth_seq_id="481", label_atom_id="SG")
    cb  = find(atoms, auth_comp_id="CYS", auth_seq_id="481", label_atom_id="CB")
    hg  = find(atoms, auth_comp_id="CYS", auth_seq_id="481", label_atom_id="HG")
    C_b = find(atoms, auth_comp_id=ligand, label_atom_id=cb_n)
    C_a = find(atoms, auth_comp_id=ligand, label_atom_id=ca_n)
    C_7 = find(atoms, auth_comp_id=ligand, label_atom_id=c7_n)
    C_g = find(atoms, auth_comp_id=ligand, label_atom_id=cg_n)
    N_  = find(atoms, auth_comp_id=ligand, label_atom_id=n_n)
    O_  = find(atoms, auth_comp_id=ligand, label_atom_id=o_n)
    H_a = find(atoms, auth_comp_id=ligand, label_atom_id=hca_n) if hca_n else None
    H_b = find(atoms, auth_comp_id=ligand, label_atom_id=hcb_n) if hcb_n else None

    print(f"  Cys 481 HG modeled: {hg is not None}")
    found = {f"Cβ ({cb_n})": C_b is not None, f"Cα ({ca_n})": C_a is not None,
             f"C7 ({c7_n})": C_7 is not None, f"Cγ ({cg_n})": C_g is not None,
             f"N ({n_n})": N_ is not None,    f"O ({o_n})": O_ is not None}
    print(f"  Found: {found}")

    print(f"\n  --- Bond distances (target [Plan-doc A.6]) ---")
    print(f"    d(SG–Cβ)      = {dist(sg, C_b):.3f} Å    [target 1.80, σ=0.02]")
    print(f"    d(Cα=Cβ)      = {dist(C_a, C_b):.3f} Å    [target 1.34, σ=0.02 — sp2=sp2 vinyl]")
    print(f"    d(Cα–C7)      = {dist(C_a, C_7):.3f} Å    [target 1.48, σ=0.02 — conjugated]")
    print(f"    d(Cβ–Cγ)      = {dist(C_b, C_g):.3f} Å    [target 1.50, σ=0.02 — sp2-Csp3]")
    print(f"    d(C7–N)       = {dist(C_7, N_):.3f} Å    [target 1.35, σ=0.02 — amide C-N]")
    print(f"    d(C7=O)       = {dist(C_7, O_):.3f} Å    [target 1.23, σ=0.02 — carbonyl]")

    print(f"\n  --- Angles around Cβ (sp2 carbon, should sum to ≈360°) ---")
    print(f"    a(CB–SG–Cβ)   = {angle(cb, sg, C_b):.1f}°    [target 102° — sp3-S-Csp2]")
    a1 = angle(sg, C_b, C_a); a2 = angle(sg, C_b, C_g); a3 = angle(C_a, C_b, C_g)
    print(f"    a(SG–Cβ=Cα)   = {a1:.1f}°    [target 122° — sp2 carbon]")
    print(f"    a(SG–Cβ–Cγ)   = {a2:.1f}°    [target 116° — sp2 carbon]")
    print(f"    a(Cα=Cβ–Cγ)   = {a3:.1f}°    [target 122° — sp2 carbon]")
    print(f"    [sum @ Cβ     = {a1+a2+a3:.1f}° — sp2 expects 360]")
    print(f"    a(Cβ=Cα–C7)   = {angle(C_b, C_a, C_7):.1f}°    [target 122° — sp2 carbon]")

    print(f"\n  --- Critical dihedrals ---")
    t1 = dihedral(sg, C_b, C_a, C_7)
    t2 = dihedral(C_g, C_b, C_a, C_7)
    print(f"    τ(SG–Cβ=Cα–C7) = {t1:+7.1f}°  [syn ≈0; anti ≈180; -89° at 8FD9 published]")
    print(f"    τ(Cγ–Cβ=Cα–C7) = {t2:+7.1f}°  [trans ≈180; cis ≈0]")
    print(f"    sum |τ1|+|τ2|  = {abs(t1)+abs(t2):.1f}°    [planar sp2 expects ~180]")

    # Planarity over the vinyl-thioether-amide system
    pts = np.array([sg, C_b, C_a, C_7, O_, N_])
    centroid = pts.mean(axis=0)
    _, _, vt = np.linalg.svd(pts - centroid)
    normal = vt[-1]
    devs = np.abs(np.dot(pts - centroid, normal))
    labels = ["SG", "Cβ", "Cα", "C7", "O", "N"]
    print(f"\n  --- Planarity of {{SG, Cβ, Cα, C7, O, N}} (good plane: RMS < 0.05 Å) ---")
    for lbl, d in zip(labels, devs):
        print(f"    {lbl:3s} deviation = {d:.3f} Å")
    print(f"    RMS deviation = {np.sqrt((devs**2).mean()):.3f} Å")
    print(f"    Max deviation = {devs.max():.3f} Å")
    if devs.max() > 0.2:
        print(f"    ↑ FAR FROM PLANAR — conjugated π system is broken in this model")

print()
