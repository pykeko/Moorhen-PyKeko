#!/usr/bin/env python3
"""For each FGFR entry, find Cys-SG → ligand-atom covalent bonds < 2.0 Å,
identify the ligand, classify the warhead family, and emit structured rows.

Adds FGFR-specific UniProt → target label mapping, drug-name dictionary for
known FGFR covalent inhibitors, and Cys-position annotation (e.g. FGFR4 C552
selective vs FGFR1 C488, FGFR2 C491, FGFR3 C482).
"""
import json
import re
from collections import defaultdict

import sys
sys.path.insert(0, '/Users/hilgersmt/Moorhen/docs/covalent-ligand-survey-2026-06-05')
from analyze_warheads import (
    classify, PAT_F1, PAT_F2_PRE, PAT_F2_PROD,
    PAT_F4, PAT_F5, PAT_F6, NATURAL_COFACTOR_S, NATURAL_COFACTOR_PATTERNS
)

# Same patterns as BTK/EGFR classify.py
PAT_F2_EXT = re.compile(
    r'\b(4-\([^)]*amin[^)]*\)but-2-en|4-\([^)]*piperidin[^)]*\)but-2-en|'
    r'4-\([^)]*morpholin[^)]*\)but-2-en|4-\(dimethylamino\)but-2-en|'
    r'4-\(diethylamino\)but-2-en|4-piperidin.*-?but-2-en|4-morpholin.*-?but-2-en|'
    r'but-2-enoyl.*dimethylamin|but-2-enoyl.*morpholin|but-2-enoyl.*piperidin|'
    r'but-2-enamid.*dimethylamin|but-2-enamid.*morpholin|but-2-enamid.*piperidin|'
    r'but-2-enoyl.*pyrrolidin|but-2-enamid.*pyrrolidin|but-2-enoyl.*piperaz|'
    r'but-2-enamid.*piperaz|but-2-enoyl.*azetidin|but-2-enamid.*azetidin)',
    re.I,
)

# UniProt → FGFR target
UNIPROT_TARGET = {
    'P11362': 'FGFR1',
    'P21802': 'FGFR2',
    'P22607': 'FGFR3',
    'P22455': 'FGFR4',
    'P16092': 'FGFR1',  # mouse
    'P21803': 'FGFR2',  # mouse
    'Q61851': 'FGFR3',  # mouse
    'Q03142': 'FGFR4',  # mouse
}
MOUSE_UNIPROTS = {'P16092', 'P21803', 'Q61851', 'Q03142'}

# Reactive Cys in human FGFR kinase domain (UniProt numbering)
REACTIVE_CYS = {
    'FGFR1': 488,
    'FGFR2': 491,
    'FGFR3': 482,
    'FGFR4': 552,
}

# Known FGFR covalent drug ligand codes. Mostly compiled from primary
# papers + PDB lookups. We hand-curate the high-confidence ones; the
# rest get filled in from chem_comp.name pattern matching.
DRUG_NAMES = {
    # Futibatinib (TAS-120) — α,β-ynamide, FGFR1-4 covalent
    'JG3': 'Futibatinib (TAS-120)',
    # H3B-6527 — acrylamide FGFR4 selective
    'EP3': 'H3B-6527',
    '9XN': 'H3B-6527 analog',
    # Roblitinib / FGF401 — acrylamide FGFR4 selective
    '9NU': 'Roblitinib (FGF401)',
    'BV7': 'Roblitinib analog',
    # Fisogatinib / BLU-554 — acrylamide FGFR4 selective
    'GO0': 'Fisogatinib (BLU-554)',
    # FIIN series — Wang/Gray
    'FN1': 'FIIN-1',
    'FN2': 'FIIN-2',
    'FN3': 'FIIN-3',
    # Other acrylamide FGFR covalents (PDB letter codes from primary lit)
    'BGJ': 'BGJ398/Infigratinib (rev)',
    '0RY': 'PD-173074 analog',
}


def is_f2(name):
    if not name:
        return False
    n = name.lower()
    return bool(PAT_F2_PRE.search(n) or PAT_F2_PROD.search(n))


def is_f2_extended(name):
    if not name:
        return False
    return bool(PAT_F2_EXT.search(name))


def is_terminal_propiolamide(name):
    if not name:
        return False
    n = name.lower()
    return (('prop-2-yn' in n or 'propiolamid' in n or 'propynamid' in n)
            and 'but-2-yn' not in n and 'pent-2-yn' not in n)


def entry_target(entry):
    """Pick the FGFR target label (FGFR1..4) for an entry by inspecting its
    polymer_entities' UniProt accessions. Returns a sorted list of distinct
    matching FGFR labels, plus a mouse flag."""
    targets = []
    mouse = False
    for pe in (entry.get('polymer_entities') or []):
        cont = pe.get('rcsb_polymer_entity_container_identifiers') or {}
        for rs in (cont.get('reference_sequence_identifiers') or []):
            if rs.get('database_name') != 'UniProt':
                continue
            acc = rs.get('database_accession')
            if acc in UNIPROT_TARGET:
                targets.append(UNIPROT_TARGET[acc])
                if acc in MOUSE_UNIPROTS:
                    mouse = True
    return sorted(set(targets)), mouse


def process_entry(entry):
    rid = entry['rcsb_id']
    ei = entry.get('rcsb_entry_info') or {}
    res = (ei.get('resolution_combined') or [None])[0]
    method = ei.get('experimental_method')
    rel = (entry.get('rcsb_accession_info') or {}).get('initial_release_date', '')[:4]
    title = (entry.get('struct') or {}).get('title', '')
    fgfr_targets, mouse = entry_target(entry)

    lig_names = {}
    for ne in (entry.get('nonpolymer_entities') or []):
        cc = ((ne.get('nonpolymer_comp') or {}).get('chem_comp') or {})
        if cc.get('id'):
            lig_names[cc['id']] = (cc.get('name') or '', cc.get('formula') or '')

    rows = []
    for ne in (entry.get('nonpolymer_entities') or []):
        for inst in (ne.get('nonpolymer_entity_instances') or []):
            for c in (inst.get('rcsb_nonpolymer_struct_conn') or []):
                rows.append(c)
    for pe in (entry.get('polymer_entities') or []):
        for inst in (pe.get('polymer_entity_instances') or []):
            for c in (inst.get('rcsb_polymer_struct_conn') or []):
                rows.append(c)

    seen = set()
    hits = []
    for c in rows:
        d = c.get('dist_value')
        if d is None or d >= 2.0:
            continue
        p = c.get('connect_partner') or {}
        t = c.get('connect_target') or {}
        p_cys = p.get('label_atom_id') == 'SG' and p.get('label_comp_id') == 'CYS'
        t_cys = t.get('label_atom_id') == 'SG' and t.get('label_comp_id') == 'CYS'
        if not (p_cys or t_cys):
            continue
        if p_cys and t_cys:
            continue  # disulfide
        cys = p if p_cys else t
        lig = t if p_cys else p
        latom = (lig.get('label_atom_id') or '').upper()
        if latom.startswith('S') and not latom.startswith('SE'):
            continue
        cys_seq = cys.get('label_seq_id')
        cys_alt = cys.get('label_alt_id')
        lig_comp = lig.get('label_comp_id')
        lig_asym = lig.get('label_asym_id')
        lig_alt = lig.get('label_alt_id')
        key = (cys.get('label_asym_id'), cys_seq, cys_alt, lig_comp,
               lig_asym, lig_alt, latom)
        if key in seen:
            continue
        seen.add(key)
        name, formula = lig_names.get(lig_comp, ('', ''))
        hits.append({
            'entry': rid,
            'title': title,
            'release_year': rel,
            'resolution': res,
            'method': method,
            'fgfr_targets': fgfr_targets,
            'mouse': mouse,
            'cys_seq': cys_seq,
            'cys_alt': cys_alt,
            'lig_comp': lig_comp,
            'lig_atom': latom,
            'lig_chem_name': name,
            'lig_formula': formula,
            'dist': d,
        })

    for h in hits:
        latom = h['lig_atom'] or ''
        h2 = {**h, 'lig_element': latom[0] if latom else ''}
        fam = classify(h2)
        n = (h.get('lig_chem_name') or '').lower()
        if fam == 'unclassified' or fam == 'F1':
            if PAT_F2_PROD.search(n) or PAT_F2_PRE.search(n):
                fam = 'F2'
        h['family'] = fam
        h['f2_extended_methyl'] = is_f2_extended(n) and fam == 'F2'
        h['f2_terminal_propiolamide'] = is_terminal_propiolamide(n) and fam == 'F2'
        h['drug_name'] = DRUG_NAMES.get(h['lig_comp'], '')
    return hits


def main():
    out_hits = []
    cov_entries = set()
    with open('/tmp/fgfr-inventory/FGFR_raw.jsonl') as f:
        for line in f:
            e = json.loads(line)
            hits = process_entry(e)
            if hits:
                cov_entries.add(e['rcsb_id'])
                out_hits.extend(hits)
    with open('/tmp/fgfr-inventory/FGFR_classified.jsonl', 'w') as fo:
        for h in out_hits:
            fo.write(json.dumps(h) + '\n')

    per_entry = defaultdict(list)
    for h in out_hits:
        per_entry[h['entry']].append(h)
    prio = {'F2': 0, 'F1': 1, 'F4': 2, 'F5': 3, 'F3': 4, 'F6': 5}
    rows = []
    for ent, hits in per_entry.items():
        hits.sort(key=lambda h: (prio.get(h['family'], 10), h['dist']))
        primary = hits[0]
        primary['n_hits'] = len(hits)
        primary['n_distinct_warheads'] = len({h['lig_comp'] for h in hits})
        primary['altloc_or_multi_cys'] = len(hits) > 1
        primary['all_lig_comps'] = sorted({h['lig_comp'] for h in hits})
        primary['all_families'] = sorted({h['family'] for h in hits})
        rows.append(primary)

    print(f"\n=== FGFR (combined) ===")
    print(f"Covalent-Cys entries: {len(cov_entries)}")
    fam_counts = defaultdict(int)
    f2_ext = 0
    f2_term = 0
    for r in rows:
        fam_counts[r['family']] += 1
        if r.get('f2_extended_methyl'):
            f2_ext += 1
        if r.get('f2_terminal_propiolamide'):
            f2_term += 1
    for fam in sorted(fam_counts, key=lambda x: -fam_counts[x]):
        print(f"  {fam:30} {fam_counts[fam]}")
    print(f"  F2 extended-methyl subset: {f2_ext}")
    print(f"  F2 terminal-propiolamide subset: {f2_term}")

    # Per-target breakdown
    print(f"\n--- Per-target breakdown ---")
    for tgt in ('FGFR1', 'FGFR2', 'FGFR3', 'FGFR4'):
        tgt_rows = [r for r in rows if tgt in r['fgfr_targets']]
        fams = defaultdict(int)
        f2_n = 0
        for r in tgt_rows:
            fams[r['family']] += 1
            if r['family'] == 'F2':
                f2_n += 1
        print(f"  {tgt}: {len(tgt_rows)} covalent entries, F2={f2_n}, "
              + ', '.join(f"{f}={n}" for f, n in sorted(fams.items(), key=lambda x: -x[1])))

    with open('/tmp/fgfr-inventory/FGFR_per_entry.json', 'w') as fo:
        json.dump(rows, fo, indent=2)

    # Also dump all hits with target info to make later table rendering easy
    with open('/tmp/fgfr-inventory/FGFR_all_hits.json', 'w') as fo:
        json.dump(out_hits, fo, indent=2)


if __name__ == "__main__":
    main()
