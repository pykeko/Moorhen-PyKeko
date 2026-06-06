#!/usr/bin/env python3
"""For each BTK / EGFR entry, find Cys-SG → ligand-atom covalent bonds < 2.0 Å,
identify the ligand, classify the warhead family using the existing classifier
(plus heuristic fallbacks), and emit a structured CSV/JSON ready for the tables.
"""
import json
import re
from collections import defaultdict

# Import classifier patterns from the existing module
import sys
sys.path.insert(0, '/Users/hilgersmt/Moorhen/docs/covalent-ligand-survey-2026-06-05')
from analyze_warheads import classify, PAT_F1, PAT_F2_PRE, PAT_F2_PROD, PAT_F4, PAT_F5, PAT_F6, NATURAL_COFACTOR_S, NATURAL_COFACTOR_PATTERNS

# Identify "extended methyl" F2 by looking for substituents off the methyl
# i.e. "4-(dimethylamino)but-2-enoyl", "4-(piperidin-1-yl)but-2-enoyl", etc.
PAT_F2_EXT = re.compile(r'\b(4-\([^)]*amin[^)]*\)but-2-en|4-\([^)]*piperidin[^)]*\)but-2-en|4-\([^)]*morpholin[^)]*\)but-2-en|4-\(dimethylamino\)but-2-en|4-\(diethylamino\)but-2-en|4-piperidin.*-?but-2-en|4-morpholin.*-?but-2-en|but-2-enoyl.*dimethylamin|but-2-enoyl.*morpholin|but-2-enoyl.*piperidin|but-2-enamid.*dimethylamin|but-2-enamid.*morpholin|but-2-enamid.*piperidin|but-2-enoyl.*pyrrolidin|but-2-enamid.*pyrrolidin|but-2-enoyl.*piperaz|but-2-enamid.*piperaz|but-2-enoyl.*azetidin|but-2-enamid.*azetidin)', re.I)

# Known drug-name dictionary by ligand code
DRUG_NAMES = {
    # BTK
    'XQQ': 'Acalabrutinib',
    '7GB': 'Tirabrutinib',
    'LTJ': 'Evobrutinib analog',
    '1E8': 'Ibrutinib',
    '60K': 'Ibrutinib',
    '60Z': 'Ibrutinib (covalent)',
    '6ZB': 'Ibrutinib',
    'LFM': 'Zanubrutinib',
    'YQS': 'Spebrutinib',
    'CT4': 'Spebrutinib',
    # EGFR
    'AHE': 'Afatinib',
    '0WN': 'Afatinib',
    'P8H': 'Afatinib',
    'HKI': 'Neratinib (HKI-272)',
    'WBJ': 'Neratinib',
    'XL6': 'Dacomitinib',
    'YY3': 'Dacomitinib',
    '6S3': 'Mobocertinib',
    'OBE': 'Osimertinib',
    'YY8': 'Osimertinib',
    'P06': 'Osimertinib',
    'P0B': 'Osimertinib',
    'P0Y': 'Osimertinib',
    '0XO': 'Osimertinib analog (WZ4002)',
    'WZ4': 'WZ4002',
    'WZ3': 'WZ3146',
    '1C9': 'Canertinib (CI-1033)',
    # Other Cys-covalent EGFR / BTK lead chem
    'EVO': 'Evobrutinib',
    'P9X': 'Pirtobrutinib',
}

# Curated F2 extended-methyl tag set: by inspection of the IUPAC name patterns
def is_f2(name, code):
    if not name: return False
    return bool(PAT_F2_PRE.search(name.lower()) or PAT_F2_PROD.search(name.lower()))

def is_f2_extended(name):
    if not name: return False
    return bool(PAT_F2_EXT.search(name))

def is_f1(name):
    if not name: return False
    return bool(PAT_F1.search(name.lower()))

def is_terminal_propiolamide(name):
    """Spebrutinib-like: 'prop-2-yn' but NOT 'but-2-yn' / 'pent-2-yn' / 'hex-2-yn'."""
    if not name: return False
    n = name.lower()
    return ('prop-2-yn' in n or 'propiolamid' in n or 'propynamid' in n) and 'but-2-yn' not in n and 'pent-2-yn' not in n

# EGFR Cys797 is at sequence position 797 in UniProt P00533, but PDB numbering of the
# kinase domain typically maps it to ~Cys797. BTK Cys481 → ~Cys481 in PDB numbering
# (mostly the same since BTK PDB usually starts from M386 or thereabouts).
# We won't try to verify PDB number → UniProt mapping; we just record the auth_seq.

def process_entry(entry):
    """Return list of warhead hits for this entry."""
    rid = entry['rcsb_id']
    ei = entry.get('rcsb_entry_info') or {}
    res = (ei.get('resolution_combined') or [None])[0]
    method = ei.get('experimental_method')
    rel = (entry.get('rcsb_accession_info') or {}).get('initial_release_date', '')[:4]
    title = (entry.get('struct') or {}).get('title', '')

    # Build ligand chem_comp.name lookup: nonpolymer_entity comp_id -> name
    lig_names = {}
    for ne in (entry.get('nonpolymer_entities') or []):
        cc = ((ne.get('nonpolymer_comp') or {}).get('chem_comp') or {})
        if cc.get('id'):
            lig_names[cc['id']] = (cc.get('name') or '', cc.get('formula') or '')

    # All struct_conn rows from both polymer and nonpolymer instances.
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
        if d is None or d >= 2.0: continue
        p = c.get('connect_partner') or {}
        t = c.get('connect_target') or {}
        # Identify Cys-SG side
        p_cys = p.get('label_atom_id') == 'SG' and p.get('label_comp_id') == 'CYS'
        t_cys = t.get('label_atom_id') == 'SG' and t.get('label_comp_id') == 'CYS'
        if not (p_cys or t_cys): continue
        if p_cys and t_cys: continue  # disulfide, skip
        cys = p if p_cys else t
        lig = t if p_cys else p
        # Exclude lig sulfur (disulfide-like)
        latom = (lig.get('label_atom_id') or '').upper()
        if latom.startswith('S') and not latom.startswith('SE'):
            # Could be another Cys-S, or thiol → skip
            continue
        cys_seq = cys.get('label_seq_id')
        cys_alt = cys.get('label_alt_id')
        lig_comp = lig.get('label_comp_id')
        lig_asym = lig.get('label_asym_id')
        lig_alt = lig.get('label_alt_id')
        key = (cys.get('label_asym_id'), cys_seq, cys_alt, lig_comp, lig_asym, lig_alt, latom)
        if key in seen: continue
        seen.add(key)
        name, formula = lig_names.get(lig_comp, ('', ''))
        hits.append({
            'entry': rid,
            'title': title,
            'release_year': rel,
            'resolution': res,
            'method': method,
            'cys_seq': cys_seq,
            'cys_alt': cys_alt,
            'lig_comp': lig_comp,
            'lig_atom': latom,
            'lig_chem_name': name,
            'lig_formula': formula,
            'dist': d,
        })
    # Add a classified version per hit
    for h in hits:
        # Pretend we have lig_element for the classifier
        latom = (h['lig_atom'] or '')
        h2 = {**h, 'lig_element': latom[0] if latom else ''}
        fam = classify(h2)
        # Override: if classifier said unclassified but name contains an obvious pattern
        n = (h.get('lig_chem_name') or '').lower()
        if fam == 'unclassified' or fam == 'F1':
            if PAT_F2_PROD.search(n) or PAT_F2_PRE.search(n):
                fam = 'F2'
        # F2-extended subflag
        ext = is_f2_extended(n)
        # Terminal propiolamide subflag
        term = is_terminal_propiolamide(n)
        h['family'] = fam
        h['f2_extended_methyl'] = ext and fam == 'F2'
        h['f2_terminal_propiolamide'] = term and fam == 'F2'
        h['drug_name'] = DRUG_NAMES.get(h['lig_comp'], '')
    return hits

def main():
    for label in ('BTK', 'EGFR'):
        out_hits = []
        cov_entries = set()
        with open(f'/tmp/btk-egfr-inventory/{label}_raw.jsonl') as f:
            for line in f:
                e = json.loads(line)
                hits = process_entry(e)
                if hits:
                    cov_entries.add(e['rcsb_id'])
                    out_hits.extend(hits)
        with open(f'/tmp/btk-egfr-inventory/{label}_classified.jsonl', 'w') as fo:
            for h in out_hits:
                fo.write(json.dumps(h) + '\n')
        # Per-entry primary classification (highest-relevance family wins per entry)
        per_entry = defaultdict(list)
        for h in out_hits:
            per_entry[h['entry']].append(h)
        # Family priority for choosing the "headline" hit per entry
        prio = {'F2': 0, 'F1': 1, 'F4': 2, 'F5': 3, 'F3': 4, 'F6': 5}
        rows = []
        for ent, hits in per_entry.items():
            # Choose hit by family priority, then by lower dist
            hits.sort(key=lambda h: (prio.get(h['family'], 10), h['dist']))
            primary = hits[0]
            extras = [h for h in hits[1:] if h['lig_comp'] != primary['lig_comp']]
            primary['n_distinct_warheads'] = len({h['lig_comp'] for h in hits})
            primary['altloc_or_multi_cys'] = len(hits) > 1
            primary['all_lig_comps'] = sorted({h['lig_comp'] for h in hits})
            rows.append(primary)
        # Family summary
        print(f"\n=== {label} ===")
        print(f"Covalent-Cys entries: {len(cov_entries)}")
        fam_counts = defaultdict(int)
        f2_ext = 0
        f2_term = 0
        for r in rows:
            fam_counts[r['family']] += 1
            if r.get('f2_extended_methyl'): f2_ext += 1
            if r.get('f2_terminal_propiolamide'): f2_term += 1
        for fam in sorted(fam_counts, key=lambda x: -fam_counts[x]):
            print(f"  {fam:30} {fam_counts[fam]}")
        print(f"  F2 extended-methyl subset: {f2_ext}")
        print(f"  F2 terminal-propiolamide subset: {f2_term}")
        with open(f'/tmp/btk-egfr-inventory/{label}_per_entry.json', 'w') as fo:
            json.dump(rows, fo, indent=2)

if __name__ == "__main__":
    main()
