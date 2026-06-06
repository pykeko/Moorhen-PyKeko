#!/usr/bin/env python3
"""For each F2 entry, parse the mmCIF, find the CYS SG and the ligand
Cβ/Cα/C7(carbonyl) atoms (using the connect_target.label_atom_id + heuristic
on the ligand to find Cα and C7), compute SG–Cβ distance, Cα=Cβ distance,
and τ(SG–Cβ=Cα–C7) dihedral.

Strategy:
 - Read the deposited _struct_conn block to find the CYS SG ↔ ligand Cβ pair.
 - Use the ligand's _chem_comp_bond table to locate the Cβ-Cα bond and the
   Cα-C7carbonyl bond.
 - Pull all four atoms' XYZ and compute distances + dihedral.

This is the rigorous version of what the user wants for the link-CIF
restraint targets.
"""
import gzip, os, sys, glob, math, json
import re
from collections import defaultdict

# Minimal mmCIF loop parser — we only need _atom_site, _struct_conn, _chem_comp_bond.

def read_cif_blocks(text):
    """Yield (block_name, body) tuples for each data_ block."""
    parts = re.split(r'(?m)^data_', text)
    for p in parts[1:]:
        nl = p.find('\n')
        name = p[:nl].strip()
        body = p[nl+1:]
        yield name, body

def parse_loop(body, want_category):
    """Return list of dicts for the named loop (e.g. '_atom_site' or '_struct_conn')."""
    # Find each "loop_\n_<cat>." header
    out = []
    i = 0
    while True:
        ix = body.find('loop_', i)
        if ix < 0: break
        # parse column names: lines starting with '_'
        j = ix + len('loop_')
        cols = []
        while True:
            # skip whitespace/newlines
            while j < len(body) and body[j] in ' \t\n\r':
                j += 1
            if j >= len(body) or body[j] != '_':
                break
            # read until whitespace
            k = j
            while k < len(body) and body[k] not in ' \t\n\r':
                k += 1
            cols.append(body[j:k])
            j = k
        i = j
        # If this loop is for the category we want, parse the rows.
        if not any(c.startswith(want_category + '.') for c in cols):
            continue
        # Strip prefix
        names = [c.split('.', 1)[1] if '.' in c else c for c in cols]
        # Parse rows until we hit the next 'loop_' or 'data_' or '_<other_category>'
        # CIF data tokens — handle quotes and ; multilines.
        tokens = []
        n_cols = len(cols)
        while j < len(body):
            # skip whitespace + comments
            while j < len(body):
                c = body[j]
                if c in ' \t\n\r':
                    j += 1
                elif c == '#':
                    while j < len(body) and body[j] != '\n':
                        j += 1
                else:
                    break
            if j >= len(body): break
            c = body[j]
            # next category or loop_ ends this loop
            if c == '_':
                # check next category prefix
                k = j
                while k < len(body) and body[k] not in ' \t\n\r':
                    k += 1
                tok = body[j:k]
                if '.' in tok:
                    cat = tok.split('.', 1)[0]
                    if cat != want_category:
                        break
                j = k
                tokens.append(tok)
                continue
            if c == 'l' and body[j:j+5] == 'loop_':
                break
            if c == 'd' and body[j:j+5] == 'data_':
                break
            # tokenize
            if c == "'":
                k = body.find("'", j+1)
                tokens.append(body[j+1:k])
                j = k + 1
            elif c == '"':
                k = body.find('"', j+1)
                tokens.append(body[j+1:k])
                j = k + 1
            elif c == ';':
                # multiline
                # newline-prefixed semi
                k = body.find('\n;', j)
                tokens.append(body[j+1:k].strip())
                j = k + 2
            else:
                k = j
                while k < len(body) and body[k] not in ' \t\n\r':
                    k += 1
                tokens.append(body[j:k])
                j = k
        # group into rows
        for ri in range(0, len(tokens), n_cols):
            row = tokens[ri:ri+n_cols]
            if len(row) == n_cols:
                out.append(dict(zip(names, row)))
        i = j
    return out


def find_atom_in_residue(atoms, asym_id, seq_id, comp_id, atom_id):
    for a in atoms:
        if (a.get('label_asym_id') == asym_id and
            a.get('label_seq_id') == seq_id and
            a.get('label_atom_id') == atom_id):
            return a
        if (a.get('label_asym_id') == asym_id and
            a.get('label_comp_id') == comp_id and
            a.get('label_atom_id') == atom_id):
            return a
    return None

def xyz(a):
    return float(a['Cartn_x']), float(a['Cartn_y']), float(a['Cartn_z'])

def dist(a, b):
    ax, ay, az = xyz(a); bx, by, bz = xyz(b)
    return math.sqrt((ax-bx)**2 + (ay-by)**2 + (az-bz)**2)

def dihedral(p1, p2, p3, p4):
    import numpy as np
    a = np.array(xyz(p1)); b = np.array(xyz(p2)); c = np.array(xyz(p3)); d = np.array(xyz(p4))
    b1 = b - a; b2 = c - b; b3 = d - c
    n1 = np.cross(b1, b2); n2 = np.cross(b2, b3)
    m1 = np.cross(n1, b2 / np.linalg.norm(b2))
    x = np.dot(n1, n2); y = np.dot(m1, n2)
    return math.degrees(math.atan2(y, x))

# Hits to analyze
ref_hits = {}
with open('/tmp/pdb_conn/hits_classified.jsonl') as f:
    for line in f:
        h = json.loads(line)
        if h['family'] != 'F2': continue
        # Keep the lowest-distance representative per entry
        e = h['entry']
        if e not in ref_hits or h['dist'] < ref_hits[e]['dist']:
            ref_hits[e] = h

print(f'F2 entries to analyze: {len(ref_hits)}')

# Filter to entries where we have the mmCIF file downloaded
ref_hits = {k:v for k,v in ref_hits.items() if os.path.exists(f'/tmp/pdb_conn/mmcif/{k.lower()}.cif.gz')}
print(f'  with mmCIF available: {len(ref_hits)}')

import numpy as np
results = []
for entry, h in ref_hits.items():
    cif_path = f'/tmp/pdb_conn/mmcif/{entry.lower()}.cif.gz'
    if not os.path.exists(cif_path):
        continue
    with gzip.open(cif_path, 'rt') as f:
        text = f.read()
    blocks = list(read_cif_blocks(text))
    if not blocks: continue
    name, body = blocks[0]
    atoms = parse_loop(body, '_atom_site')

    # Find CYS SG (use both asym + seq + atom = unique)
    cys_sg = None
    for a in atoms:
        if (a.get('label_asym_id') == h['cys_asym']
            and a.get('label_comp_id') == 'CYS'
            and a.get('label_atom_id') == 'SG'
            and str(a.get('label_seq_id')) == str(h['cys_seq'])):
            cys_sg = a; break
    if cys_sg is None:
        print(f'  {entry}: CYS SG not found')
        continue
    # Find ALL candidate ligand-Cβ atoms (could be multiple copies in different asyms),
    # then pick the one closest to the CYS SG.
    candidates = [a for a in atoms
                  if a.get('label_comp_id') == h['lig_comp']
                  and a.get('label_atom_id') == h['lig_atom']]
    if not candidates:
        print(f'  {entry}: no ligand Cβ candidate found')
        continue
    lig_cb = min(candidates, key=lambda a: dist(a, cys_sg))
    # Use the WINNING ligand atom's asym_id for finding Cα and C7 in the same residue copy
    lig_asym = lig_cb.get('label_asym_id')

    # Find ligand Cα — use the chem_comp_bond table to locate the Cα.
    lig_bonds = parse_loop(body, '_chem_comp_bond')
    bonds_by_atom = defaultdict(list)
    for b in lig_bonds:
        if b.get('comp_id') != h['lig_comp']: continue
        bonds_by_atom[b['atom_id_1']].append((b['atom_id_2'], b.get('value_order','sing')))
        bonds_by_atom[b['atom_id_2']].append((b['atom_id_1'], b.get('value_order','sing')))

    cb_id = h['lig_atom']
    # Pick the neighbor of Cβ that is a carbon and is double-bonded
    ca_id = None
    for nb, order in bonds_by_atom.get(cb_id, []):
        if order in ('doub','DOUB','double','d'):
            # also check it's a C
            if nb.startswith('C') or nb.startswith('c'):
                ca_id = nb; break
    if ca_id is None:
        # fallback: pick any neighbor whose element is C
        for nb, order in bonds_by_atom.get(cb_id, []):
            if nb.startswith('C') or nb.startswith('c'):
                ca_id = nb; break

    # C7 = the carbonyl carbon adjacent to Cα (next neighbor after Cβ)
    co_id = None
    if ca_id:
        for nb, order in bonds_by_atom.get(ca_id, []):
            if nb == cb_id: continue
            # carbonyl: has a =O neighbor
            for nb2, ord2 in bonds_by_atom.get(nb, []):
                if (nb2.startswith('O') or nb2.startswith('o')) and ord2 in ('doub','DOUB','double','d'):
                    co_id = nb; break
            if co_id: break

    # Get atoms — use the WINNING ligand's asym_id (lig_asym from above)
    lig_ca = None; lig_co = None
    if ca_id:
        for a in atoms:
            if (a.get('label_asym_id') == lig_asym
                and a.get('label_comp_id') == h['lig_comp']
                and a.get('label_atom_id') == ca_id):
                lig_ca = a; break
    if co_id:
        for a in atoms:
            if (a.get('label_asym_id') == lig_asym
                and a.get('label_comp_id') == h['lig_comp']
                and a.get('label_atom_id') == co_id):
                lig_co = a; break

    rec = {'entry': entry, 'lig_comp': h['lig_comp'], 'cb_atom': cb_id, 'ca_atom': ca_id, 'co_atom': co_id}
    if cys_sg and lig_cb:
        rec['d_SG_Cb'] = dist(cys_sg, lig_cb)
    if lig_cb and lig_ca:
        rec['d_Cb_Ca'] = dist(lig_cb, lig_ca)
    if lig_ca and lig_co:
        rec['d_Ca_C7'] = dist(lig_ca, lig_co)
    if cys_sg and lig_cb and lig_ca and lig_co:
        rec['tau_SG_Cb_Ca_C7'] = dihedral(cys_sg, lig_cb, lig_ca, lig_co)
    results.append(rec)
    print(f"  {entry}  {h['lig_comp']:6}  d(SG-Cβ)={rec.get('d_SG_Cb','-'):.3f}  d(Cα=Cβ)={rec.get('d_Cb_Ca',0):.3f}  d(Cα-C7)={rec.get('d_Ca_C7',0):.3f}  τ={rec.get('tau_SG_Cb_Ca_C7',0):+.1f}°  (Cα={ca_id}, C7={co_id})")

# Aggregate
print('\n=== F2 GEOMETRY AGGREGATE (n entries analyzed) ===')
def stat(field):
    vals = [r[field] for r in results if field in r]
    if not vals: return None
    m = sum(vals)/len(vals)
    sd = (sum((v-m)**2 for v in vals)/max(1, len(vals)-1)) ** 0.5
    return f'n={len(vals)}  mean={m:.3f}  σ={sd:.3f}  min={min(vals):.3f}  max={max(vals):.3f}'
print(f'  d(SG-Cβ):  {stat("d_SG_Cb")}')
print(f'  d(Cα=Cβ):  {stat("d_Cb_Ca")}')
print(f'  d(Cα-C7):  {stat("d_Ca_C7")}')
# Dihedral — show distribution including signs
taus = [r['tau_SG_Cb_Ca_C7'] for r in results if 'tau_SG_Cb_Ca_C7' in r]
if taus:
    print(f'\n  τ(SG-Cβ=Cα-C7):  n={len(taus)}')
    print(f'    raw values: {[round(t,1) for t in taus]}')
    # Classify: |τ| < 30° → syn (0°), |τ| > 150° → anti (180°), else intermediate
    syn  = sum(1 for t in taus if abs(t) < 30)
    anti = sum(1 for t in taus if abs(t) > 150)
    mid  = len(taus) - syn - anti
    print(f'    syn (|τ|<30°): {syn}/{len(taus)} ({100*syn/len(taus):.0f}%)')
    print(f'    anti (|τ|>150°): {anti}/{len(taus)} ({100*anti/len(taus):.0f}%)')
    print(f'    intermediate: {mid}/{len(taus)} ({100*mid/len(taus):.0f}%)')

json.dump(results, open('/tmp/pdb_conn/f2_geom.json', 'w'), indent=2)
