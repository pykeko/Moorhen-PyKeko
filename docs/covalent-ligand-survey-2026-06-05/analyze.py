#!/usr/bin/env python3
"""Analyze the bulk-fetched PDB struct_conn data for Cys-SG→non-S contacts.

Strict criteria (matches the user's request):
  - CYS SG  ↔  any atom on a DIFFERENT residue
  - Other atom is NOT a sulfur (element != S)
  - Distance < 2.0 Å (per dist_value reported in _rcsb_*_struct_conn)
  - Exclude intra-residue contacts (same chain + seq + comp)
  - Include both 'covalent bond' and any other connect_type sub-2A reading
    (so we can report the "missing link" deposition-quality split)

Counts (a) entries containing >=1 hit, (b) total hits, (c) per-ligand,
(d) per-atom-element histogram.
"""
import json, os, sys, re, math
from collections import Counter, defaultdict

INPUT = '/tmp/pdb_conn/all.jsonl'
OUT   = '/tmp/pdb_conn/hits.jsonl'

# Element heuristic from atom_name: take first letter(s).
# CIF atom_id is usually "<Element><number>" e.g. C19, OG1, ZN, FE.
# Two-letter elements we care about handling: ZN, FE, MG, CA(metal/carbon ambiguous!), CU, MN, CO(metal/carbon!), NI, MO, BR, CL.
# For the CYS-side filter (target atom not sulfur), we just need element != S.
TWO_LETTER = {'CL','BR','ZN','FE','MG','MN','CU','NI','CO','MO','CA','SI','SE','HG','CD','PT','PD','RH','RU','IR','AG','AU','PB','SN','TL','BI','BA','SR','CS','RB','LI','BE','NA','AL','GE','AS','TE','XE','KR','AR','HE','LA','CE','PR','ND','SM','EU','GD','TB','DY','HO','ER','TM','YB','LU','HF','TA','RE','OS'}

# But many ligand atoms in CCD use first letter only (C7, N1, O2, P, S, F, B, H1)
def element_from_atom_name(atom_id):
    if not atom_id: return ''
    a = atom_id.strip().upper()
    # Strip leading apostrophe/number occasionally seen
    a = a.lstrip("0123456789'")
    if not a: return ''
    # Try two-letter element first
    if len(a) >= 2 and a[:2] in TWO_LETTER:
        return a[:2]
    # Single-letter element
    return a[0]

# We need to know: when atom is on the CYS side (SG), the OTHER atom is on a non-cys residue,
# and that other atom is not a sulfur. We also need to count each unique S-X contact once,
# handling the fact that for non-polymer-struct-conn the connect_partner is the polymer
# (CYS side) and the connect_target is the ligand; for polymer_struct_conn either side
# could be CYS.

def iter_struct_conn_rows(entry):
    """Yield (origin, conn) where origin in {'nonpolymer','polymer'}."""
    for ne in entry.get('nonpolymer_entities') or []:
        cc = (ne.get('nonpolymer_comp') or {}).get('chem_comp') or {}
        for inst in ne.get('nonpolymer_entity_instances') or []:
            for c in inst.get('rcsb_nonpolymer_struct_conn') or []:
                yield 'nonpolymer', c, cc
    for pe in entry.get('polymer_entities') or []:
        for inst in pe.get('polymer_entity_instances') or []:
            for c in inst.get('rcsb_polymer_struct_conn') or []:
                yield 'polymer', c, None

CYS_RESIDUES = {'CYS'}  # strict — only canonical CYS; modres handled separately
# Modres that contain SG (so they show up with same atom name):
CYS_MODRES = {'CSO','CSD','CSX','CME','CSS','CMT','CSE','CSP','OCS','CAS','SMC','SCY','SNC','MCS','SCH','CY3','CY1','CYW','CSW','CSU','CSR','CYG','CMH','CCS','CSI','C5C','CXM','CSA','CGU','SCS','CMC','OMC','CYR','CYM','SCD'}

def is_cys(comp):
    return comp == 'CYS'

def is_cys_or_modres(comp):
    return comp == 'CYS' or comp in CYS_MODRES

def main():
    hits_per_entry = defaultdict(list)  # entry -> list[hit dicts]
    raw_total = 0
    bad_atom = 0
    cys_side_skip_disulfide = 0
    intra_skip = 0
    dist_missing = 0

    with open(INPUT) as f:
        for line in f:
            try:
                e = json.loads(line)
            except:
                continue
            entry = e['rcsb_id']
            seen_pair = set()
            for origin, c, cc in iter_struct_conn_rows(e):
                raw_total += 1
                p = c.get('connect_partner') or {}
                t = c.get('connect_target') or {}
                d = c.get('dist_value')
                if d is None:
                    dist_missing += 1
                    continue
                # Identify which side is CYS-SG
                p_is_cys_sg = p.get('label_atom_id') == 'SG' and is_cys(p.get('label_comp_id'))
                t_is_cys_sg = t.get('label_atom_id') == 'SG' and is_cys(t.get('label_comp_id'))
                # Also track modres
                p_is_cysmod_sg = p.get('label_atom_id') == 'SG' and is_cys_or_modres(p.get('label_comp_id'))
                t_is_cysmod_sg = t.get('label_atom_id') == 'SG' and is_cys_or_modres(t.get('label_comp_id'))

                if not (p_is_cys_sg or t_is_cys_sg):
                    continue
                # Orient: cys_side = the CYS atom; other_side = the partner
                if p_is_cys_sg:
                    cys = p; other = t
                else:
                    cys = t; other = p

                # Exclude intra-residue (same residue): compare asym + seq + comp + alt
                if (cys.get('label_asym_id') == other.get('label_asym_id') and
                    cys.get('label_seq_id') == other.get('label_seq_id') and
                    cys.get('label_comp_id') == other.get('label_comp_id') and
                    cys.get('label_atom_id') == other.get('label_atom_id')):
                    intra_skip += 1
                    continue
                # Compute other-atom element
                el = element_from_atom_name(other.get('label_atom_id'))
                if el == 'S':
                    cys_side_skip_disulfide += 1
                    continue
                # Apply 2.0 Å threshold
                if d >= 2.0:
                    continue

                # Per-altloc handling: per the user's question, count each contact once,
                # but record altloc info. Use a dedup key including altlocs and label_seq.
                key = (
                    cys.get('label_asym_id'), cys.get('label_seq_id'), cys.get('label_alt_id'),
                    other.get('label_asym_id'), other.get('label_seq_id'), other.get('label_atom_id'), other.get('label_alt_id'),
                )
                # Don't dedupe — same atom pair can show up twice if reported on both sides
                # of polymer/nonpolymer struct_conn, dedup THOSE doubles:
                if key in seen_pair:
                    continue
                seen_pair.add(key)

                hit = {
                    'entry': entry,
                    'origin': origin,                      # 'nonpolymer' or 'polymer'
                    'connect_type': c.get('connect_type'),
                    'value_order': c.get('value_order'),
                    'dist': d,
                    'cys_comp': cys.get('label_comp_id'),
                    'cys_asym': cys.get('label_asym_id'),
                    'cys_seq':  cys.get('label_seq_id'),
                    'cys_alt':  cys.get('label_alt_id'),
                    'lig_comp': other.get('label_comp_id'),
                    'lig_atom': other.get('label_atom_id'),
                    'lig_asym': other.get('label_asym_id'),
                    'lig_seq':  other.get('label_seq_id'),
                    'lig_alt':  other.get('label_alt_id'),
                    'lig_element': el,
                    'resolution': (e.get('rcsb_entry_info') or {}).get('resolution_combined'),
                    'inter_mol_covalent_bond_count': (e.get('rcsb_entry_info') or {}).get('inter_mol_covalent_bond_count'),
                    'lig_chem_name': cc.get('name') if cc else None,
                    'lig_chem_id_from_entity': cc.get('id') if cc else None,
                    'lig_formula': cc.get('formula') if cc else None,
                }
                hits_per_entry[entry].append(hit)

    # Write hits
    with open(OUT, 'w') as fo:
        for entry, hits in hits_per_entry.items():
            for h in hits:
                fo.write(json.dumps(h) + '\n')

    n_entries = len(hits_per_entry)
    n_hits = sum(len(v) for v in hits_per_entry.values())
    print(f'=== HEADLINE ===')
    print(f'Entries with >=1 Cys-SG<->non-S sub-2A contact: {n_entries}')
    print(f'Total such contacts: {n_hits}')
    print(f'Raw struct_conn rows scanned: {raw_total}')
    print(f'Skipped: intra-residue={intra_skip}, sulfur-other={cys_side_skip_disulfide}, missing_dist={dist_missing}')

    # Ligand frequency
    lig_counter = Counter()
    lig_atoms = defaultdict(Counter)
    lig_dists = defaultdict(list)
    lig_names = {}
    lig_entries = defaultdict(set)
    for hits in hits_per_entry.values():
        for h in hits:
            lc = h['lig_comp']
            lig_counter[lc] += 1
            lig_atoms[lc][h['lig_atom']] += 1
            lig_dists[lc].append(h['dist'])
            if h.get('lig_chem_name') and h['lig_chem_id_from_entity'] == lc:
                lig_names[lc] = h['lig_chem_name']
            lig_entries[lc].add(h['entry'])

    # Atom-element histogram
    elem_counter = Counter()
    elem_dists = defaultdict(list)
    for hits in hits_per_entry.values():
        for h in hits:
            elem_counter[h['lig_element']] += 1
            elem_dists[h['lig_element']].append(h['dist'])

    print(f'\n=== ATOM-ELEMENT HISTOGRAM ===')
    tot = sum(elem_counter.values())
    for e, c in elem_counter.most_common():
        mn = sum(elem_dists[e])/len(elem_dists[e])
        print(f'  {e:5} {c:7} ({100*c/tot:5.2f}%)  mean_d={mn:.3f}')

    print(f'\n=== TOP-60 LIGAND CODES ===')
    print(f'{"code":6} {"count":>5} {"entries":>7} {"bonded_atom":>12} {"med_d":>6} {"mean_d":>6}  name')
    for code, n in lig_counter.most_common(60):
        dists = lig_dists[code]
        dists_sorted = sorted(dists)
        med = dists_sorted[len(dists)//2]
        mean = sum(dists)/len(dists)
        atom_top = lig_atoms[code].most_common(1)[0][0]
        nm = (lig_names.get(code) or '')[:80]
        print(f'{code:6} {n:5} {len(lig_entries[code]):7} {atom_top:>12} {med:6.3f} {mean:6.3f}  {nm}')

    # Save summary tables to JSON for downstream queries
    summary = {
        'n_entries': n_entries,
        'n_hits': n_hits,
        'n_raw_rows': raw_total,
        'skipped': {'intra': intra_skip, 'sulfur_other': cys_side_skip_disulfide, 'missing_dist': dist_missing},
        'element_histogram': dict(elem_counter),
        'element_mean_dist': {e: sum(elem_dists[e])/len(elem_dists[e]) for e in elem_counter},
        'top_ligands': [
            {'code': c, 'count': n, 'n_entries': len(lig_entries[c]),
             'mean_dist': sum(lig_dists[c])/len(lig_dists[c]),
             'median_dist': sorted(lig_dists[c])[len(lig_dists[c])//2],
             'top_atom': lig_atoms[c].most_common(1)[0][0],
             'name': lig_names.get(c)}
            for c, n in lig_counter.most_common(200)
        ],
    }
    json.dump(summary, open('/tmp/pdb_conn/summary.json', 'w'), indent=2)
    print(f'\nWrote /tmp/pdb_conn/summary.json and {OUT}')

if __name__ == '__main__':
    main()
