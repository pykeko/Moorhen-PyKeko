#!/usr/bin/env python3
"""Measure Cys-Cβ covalent bond geometry across F1/F4/F6 families.

Test cases:
  F1 acrylamide:   6DI9 (1.25 Å, GJJ-C33), 7JXW (2.50 Å, YY3-C9 dacomitinib)
  F4 chloroacet:   6TFV (1.50 Å, N7Q-CBI)
  F6 alpha-ketoamide:  6lu7 (2.16 Å, PJE-C20; the Nicholls 2021 Fig 9 case)
"""
import math, os
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


def find_first(atoms, **kw):
    for a in atoms:
        if all(a.get(k) == v for k, v in kw.items()):
            return np.array([float(a["Cartn_x"]), float(a["Cartn_y"]), float(a["Cartn_z"])])
    return None


def dist(a, b): return float(np.linalg.norm(a - b))
def angle(a, b, c):
    v1, v2 = a - b, c - b
    cos = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2))
    return math.degrees(math.acos(max(-1, min(1, cos))))


def neighbors_within(atoms, target, lig_code, max_dist):
    out = []
    for a in atoms:
        if a.get("auth_comp_id") != lig_code: continue
        p = np.array([float(a["Cartn_x"]), float(a["Cartn_y"]), float(a["Cartn_z"])])
        d = dist(p, target)
        if d < max_dist:
            out.append((a["label_atom_id"], a.get("type_symbol", "?"), p, d))
    return sorted(out, key=lambda x: x[3])


def go(path, cys_seq, lig_code, cb_id, label, target_dist=None):
    if not os.path.exists(path):
        print(f"  {label}: file not found ({path})"); return
    atoms = parse_atom_site(path)
    sg = find_first(atoms, auth_comp_id="CYS", auth_seq_id=cys_seq, label_atom_id="SG")
    cb_lig = find_first(atoms, auth_comp_id=lig_code, label_atom_id=cb_id)
    if sg is None or cb_lig is None:
        print(f"  {label}: missing atoms (sg={sg is not None}, cb_lig={cb_lig is not None})")
        return

    d_sg_cb = dist(sg, cb_lig)
    target_str = ""
    if target_dist:
        delta = d_sg_cb - target_dist
        target_str = f"  Δ from target {target_dist}={delta:+.3f}"

    # Find heavy and H neighbors of Cβ within 2 Å
    nbrs = neighbors_within(atoms, cb_lig, lig_code, 2.0)
    heavy_lig_nbrs = [n for n in nbrs if n[1] != "H" and n[0] != cb_id]
    h_lig_nbrs = [n for n in nbrs if n[1] == "H"]

    # Build all bond partners: SG + heavy ligand neighbors (+ H's if needed)
    partners = [(sg, "SG", "S")] + [(n[2], n[0], n[1]) for n in heavy_lig_nbrs[:4]]

    angles = []
    for i in range(len(partners)):
        for j in range(i + 1, len(partners)):
            angles.append((partners[i][1], partners[j][1],
                          angle(partners[i][0], cb_lig, partners[j][0])))

    if not angles:
        print(f"  {label:42s}  d(SG-Cβ)={d_sg_cb:.3f}{target_str}  no heavy nbrs to angle")
        return

    angle_sum = sum(a[2] for a in angles[:3])  # first 3 covers planar sp2
    n_heavy = len(partners)
    n_h = len(h_lig_nbrs)

    if n_heavy >= 3:
        sp_char = "sp2 (planar)" if abs(angle_sum - 360) < 6 else (
                  "sp3 (tet)" if abs(angle_sum - 328) < 10 else "intermediate")
    else:
        # Only 2 heavy partners (SG + 1 ligand C); H count tells us sp character
        sp_char = "sp3 (CH₂ post-Michael)" if n_h >= 2 else ("sp2 (no H added)" if n_h == 0 else "sp3 (one H)" if n_h == 1 else "?")

    print(f"  {label:42s}  d(SG-Cβ)={d_sg_cb:.3f}{target_str}  heavy_nbrs={n_heavy} ({','.join(n[0] for n in heavy_lig_nbrs[:3])})  H={n_h}  Σ3angle={angle_sum:.1f}°  → {sp_char}")


if __name__ == "__main__":
    print("=" * 90)
    print("F1 ACRYLAMIDE — sp2 (C=C) → sp3 (C-C, Cβ gains an H)")
    print("    Target d(SG-Cβ) ≈ 1.82 Å (S-Csp3 sum of covalent radii)")
    print("=" * 90)
    go("6DI9.cif",                          "481", "GJJ", "C33", "6DI9 GJJ — DEPOSIT (1.25 Å)",      target_dist=1.82)
    go("refmacat-F1-acryl-hires.mmcif",     "481", "GJJ", "C33", "6DI9 GJJ — POST refmacat",         target_dist=1.82)
    print()
    go("7JXW.cif",                          "797", "YY3", "C9",  "7JXW YY3 dacomitinib — DEPOSIT (2.5 Å)", target_dist=1.82)
    go("refmacat-F1-acryl-lowres.mmcif",    "797", "YY3", "C9",  "7JXW YY3 dacomitinib — POST",      target_dist=1.82)

    print()
    print("=" * 90)
    print("F4 CHLOROACETAMIDE — sp3 throughout (just Cl leaves, no bond order change)")
    print("    Target d(SG-Cβ) ≈ 1.81 Å (S-Csp3)")
    print("=" * 90)
    go("6TFV.cif",                          "797", "N7Q", "CBI", "6TFV N7Q — DEPOSIT (1.5 Å)",       target_dist=1.81)
    go("refmacat-F4-chloro-hires.mmcif",    "797", "N7Q", "CBI", "6TFV N7Q — POST refmacat",         target_dist=1.81)

    print()
    print("=" * 90)
    print("F6 α-KETOAMIDE (Mpro N3 — Nicholls 2021 Fig 9 case!)")
    print("    C=O → C-OH (sp2 → sp3); target d(SG-Cβ) ≈ 1.83 Å (per Nicholls 2021 Fig 6 dist)")
    print("=" * 90)
    go("6lu7.cif",                          "145", "PJE", "C20", "6lu7 PJE — DEPOSIT (2.16 Å)",      target_dist=1.83)
    go("refmacat-F6-ketoamide-Nicholls-Fig9.mmcif", "145", "PJE", "C20", "6lu7 PJE — POST refmacat", target_dist=1.83)
