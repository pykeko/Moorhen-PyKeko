#!/usr/bin/env python3
"""Re-classify FGFR Cys-covalent hits with smarter post-Michael recognition.

Background — what the upstream name-based classifier misses:

1. Many FGFR depositions encode the **post-reaction product** of an acrylamide
   warhead as `N-aryl-propanamide` (saturated; C=C → C-C with Cβ now SG-bonded).
   The upstream PAT_F1 regex looks for 'acrylamid'/'prop-2-enamid'/'acryloyl'
   etc., but NOT for the bare 'propanamide' — so propanamide-terminating PDB
   chem_comps fall through to 'unclassified' even though they are F1-products.
   At <2.0 Å from a Cys-SG, an N-aryl-propanamide bonded SG→C is unambiguously
   the F1 post-Michael product (Δ HG on Cys; sp2→sp3 on Cβ).

2. The 'propanamide' deposit convention is exactly what the upstream survey
   plan warns about (§1.6 — "deposition pipeline lossiness"): the chemistry
   is correct but the chem_comp name no longer carries the F1 reactivity tag.

3. Several entries use `-(propanoylamino)` or `propanoyl` as the
   tail substituent of a bigger scaffold — same logic.

4. Futibatinib (TZ0) is mis-described in the user's brief as "α,β-ynamide /
   butynamide-type". The ChEMBL canonical SMILES (CHEMBL3701238) is
   C=CC(=O)N1CC[C@H](n2nc(C#Cc3cc(OC)cc(OC)c3)c3c(N)ncnc32)C1 — the warhead
   is an **acrylamide on the pyrrolidine N**, and the alkyne (C#C) is a
   3,5-dimethoxyphenylethynyl linker inside the pyrazolo[3,4-d]pyrimidine
   scaffold, NOT the warhead. Futibatinib is F1, not F2.
   TZ0's PDB IUPAC name 'prop-2-en-1-one' confirms F1; the PDB deposits the
   pre-reaction form. The post-Michael product, deposited as 'propan-1-one'
   on the pyrrolidine, is A1AFR (1-pyrrolidinyl-propan-1-one).
"""
import json
import re
from collections import defaultdict

import sys
sys.path.insert(0, '/Users/hilgersmt/Moorhen/docs/covalent-ligand-survey-2026-06-05')
from analyze_warheads import classify, PAT_F1, PAT_F2_PRE, PAT_F2_PROD, PAT_F4, PAT_F5, PAT_F6

# Tighter F1-product pattern: catches saturated N-Ar-propanamide and
# propanoyl-pyrrolidine forms when bonded to Cys-SG.
# Also catches methylpropanamide (post-Michael methacrylamide product) and
# prop-2-en-1-one (acryloyl-on-piperidine pre-reaction acrylamide).
PAT_F1_PRODUCT = re.compile(
    r'(propanamide|propanamido|propanoylamino|propanoyl|propan-1-one|propan-1-on|'
    r'2-methylpropanamide|2-methylpropanoyl|methylpropanamide|prop-2-en-1-one|prop-2-en-1-on)',
    re.I,
)
# Trifluoromethyl ketone — reversible hemiketal/hemiketone (F6)
PAT_F6_TFMK = re.compile(
    r'\b(2,2,2-tris\(fluoranyl\)ethanoyl|trifluoroacetyl|trifluoromethyl[- ]keton|tris\(fluoro\)ethanoyl|2,2,2-trifluoroacetyl|2,2,2-trifluoro-1-)\b',
    re.I,
)
# 2-chloropyridine SNAr fragment (F4-like — Cl displacement by Cys)
PAT_F4_SNAR = re.compile(
    r'\b(2-chloro.*nitropyridin|3-chloranyl.*nitropyridin|2-chloranyl.*nitropyridin|chloranyl.*nitropyridin|chloro.*pyridin.*trifluoromethyl|chloranyl.*pyridin.*trifluorometh)\b',
    re.I,
)

# Heuristic ext methyl (same as classify.py)
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

# Drug-name dictionary, FGFR edition.
# IMPORTANT corrections vs user's brief:
#   - Futibatinib (TAS-120) is acrylamide on the pyrrolidine N (F1), NOT
#     α,β-ynamide (F2). The C#C in its scaffold is a 3,5-dimethoxyphenyl
#     ethynyl linker, not the warhead.
#   - Roblitinib (FGF401) is an aldehyde-tethered (formyl/methanoyl)
#     naphthyridinecarboxamide. The reactive Cys forms a hemithioacetal —
#     this is family F6 (reversible carbonyl), NOT acrylamide F1.
#   - BLU-554 / fisogatinib is acrylamide F1, but its ligand code per the
#     Mol et al. 2019 BLU-554 paper is XL9 (PDB 6NVK is BLU-554-bound).
#   - H3B-6527: looked up in PDB; binds FGFR4 with acrylamide (F1) — but
#     no clear PDB code; not in our deposited covalent set.
DRUG_NAMES = {
    'TZ0': 'Futibatinib (TAS-120) — acrylamide-on-pyrrolidine (F1)',
    'A1AFR': 'Futibatinib (TAS-120) — post-Michael propanoyl product',
    'A1LWW': 'Futibatinib analog 10h (extended acrylamide)',
    'WIQ':  'KIN-3248 / Roivant compound (prop-2-enoyl pyrrolidine, F1 pre)',
    'WGF':  'KIN-3248 (propanoyl pyrrolidine, F1 post-Michael)',
    # FGFR4-selective acrylamide / electrophile classes
    'BYU':  'Acrylamide FGFR4 — Kim 2019',
    'AWX':  'Acrylamide FGFR4 — Bertrand 2019',
    'HHL':  '2-F-acrylamide FGFR4',
    'QS7':  'Acrylamide FGFR4',
    'O1Y':  'Brameld 2019 — FGFR1-Y563C (FGFR4 surrogate) acrylamide',
    'O21':  'Brameld 2019 — FGFR1-Y563C (FGFR4 surrogate) acrylamide',
    'WFD':  'Acrylamide FGFR2',
    'WF7':  'Vinyl-styryl acrylamide FGFR2',
    # Roblitinib / FGF401 — aldehyde-tethered hemithioacetal warhead
    'FGF':  'Roblitinib (FGF401) — naphthyridinecarboxamide w/ aldehyde (F6 hemithioacetal)',
    # BLU-554 / fisogatinib has a Δ-acrylamide; PDB 6NVK uses XL9 ligand code
    'XL9':  'Fisogatinib (BLU-554) post-Michael; FGFR4-selective',
    # RLY-4008 (Lirafugratinib) — pyrrolopyrimidine, isobutyramide (post-meth)
    'WCJ':  'RLY-4008 (Lirafugratinib) — pre-clinical FGFR2-selective; isobutyramide F1 post',
    'UIM':  'RLY-4008 analog (FGFR2 cmpd 10)',
    # CXF007 — bivalent bis-acrylamide
    'A1LVQ': 'CXF007 — bivalent bis-acrylamide (FGFR1/4 dual-warhead)',
    # KIN-3248 series (8UDT/8UDU/8UDV — Kinnate/Roivant FGFR3 selective)
    # H3B-6527, FIIN-1/2/3, BLU-9931 — not in deposited covalent set
}

PRIO = {'F2': 0, 'F1': 1, 'F4': 2, 'F5': 3, 'F3': 4, 'F6': 5,
        'Nitrile-reversible': 6, 'unclassified': 9}


def reclassify(h):
    """Return a refined family label, with F1-product catching propanamide."""
    name = (h.get('lig_chem_name') or '').lower()
    code = h['lig_comp']
    latom = (h.get('lig_atom') or '').upper()
    # Re-run base classifier first
    h2 = {**h, 'lig_element': latom[0] if latom else ''}
    fam = classify(h2)

    # F2 promotion if the F2 pattern hits
    if PAT_F2_PROD.search(name) or PAT_F2_PRE.search(name):
        # Confirm it's a but/pent/hex-2-yn/en — not just 'prop-2-en' (F1)
        if re.search(r'\b(but-2-yn|but-2-en|pent-2-yn|pent-2-en|hex-2-yn|hex-2-en|propynamid|propiolamid|propynoyl|propioloyl|propiolyl)\b', name):
            fam = 'F2'

    # F1 promotion when unclassified but the ligand carries a propanamide /
    # propanoyl (post-Michael product of acrylamide on Cys-SG).
    if fam == 'unclassified' and PAT_F1_PRODUCT.search(name):
        # require a Cys-SG → C single bond geometry which we've already
        # filtered for. Tag as F1 (post-Michael).
        fam = 'F1'

    # F6 promotion for trifluoromethyl ketones (reversible hemiketal)
    if fam == 'unclassified' and PAT_F6_TFMK.search(name):
        fam = 'F6'

    # F4 promotion for SNAr 2-chloro-nitropyridine fragments
    if fam == 'unclassified' and PAT_F4_SNAR.search(name):
        fam = 'F4'

    # CXF007 (A1LVQ) is a bis-acrylamide bivalent → F1
    if code == 'A1LVQ':
        fam = 'F1'

    # Override: known futibatinib (TZ0 and post-Michael analogs) → F1
    if code in {'TZ0'}:
        fam = 'F1'
    if code in {'A1AFR'}:
        # 1-pyrrolidinyl-propan-1-one is post-Michael propanoyl pyrrolidine — F1 product
        fam = 'F1'

    # Detect terminal propiolamide (spebrutinib-like F2 sub-family)
    is_term = bool(re.search(r'\b(prop-2-yn|propynamid|propiolamid)\b', name)
                   and not re.search(r'\b(but-2-yn|pent-2-yn)\b', name))
    is_ext = bool(PAT_F2_EXT.search(name)) and fam == 'F2'
    h['family_refined'] = fam
    h['f1_post_michael'] = (fam == 'F1' and bool(PAT_F1_PRODUCT.search(name)))
    h['f2_extended_methyl'] = is_ext
    h['f2_terminal_propiolamide'] = is_term and fam == 'F2'
    h['drug_name_refined'] = DRUG_NAMES.get(code, h.get('drug_name', ''))
    return fam


def per_entry_label(rows):
    """Pick a primary FGFR target label per entry: FGFR1/2/3/4 (or comma-join
    if multiple). Mark mouse separately."""
    out = {}
    for r in rows:
        tgts = r.get('fgfr_targets') or []
        mouse = r.get('mouse', False)
        tag = '/'.join(tgts) if tgts else '?'
        if mouse:
            tag += '(m)'
        out[r['entry']] = tag
    return out


def main():
    hits = []
    with open('/tmp/fgfr-inventory/FGFR_classified.jsonl') as f:
        for line in f:
            hits.append(json.loads(line))
    for h in hits:
        reclassify(h)

    # Per-entry primary row (lowest family priority, then dist)
    per_entry = defaultdict(list)
    for h in hits:
        per_entry[h['entry']].append(h)
    rows = []
    for ent, hh in per_entry.items():
        hh.sort(key=lambda x: (PRIO.get(x['family_refined'], 10), x['dist']))
        primary = hh[0]
        primary['n_hits'] = len(hh)
        primary['n_distinct_warheads'] = len({x['lig_comp'] for x in hh})
        primary['altloc_or_multi_cys'] = len(hh) > 1
        primary['all_lig_comps'] = sorted({x['lig_comp'] for x in hh})
        primary['all_families'] = sorted({x['family_refined'] for x in hh})
        rows.append(primary)

    # Family summary, per FGFR
    print(f"=== FGFR (combined) Cys-covalent inventory ===")
    print(f"Total entries with at least one Cys-SG covalent bond (<2.0 Å): {len(rows)}\n")

    def summarize(label, subset):
        fams = defaultdict(int)
        f2_n = 0
        f1_n = 0
        f1_post = 0
        for r in subset:
            fams[r['family_refined']] += 1
            if r['family_refined'] == 'F2':
                f2_n += 1
            if r['family_refined'] == 'F1':
                f1_n += 1
                if r.get('f1_post_michael'):
                    f1_post += 1
        fam_str = ', '.join(f"{f}={n}" for f, n in sorted(fams.items(), key=lambda x: -x[1]))
        print(f"{label:18}: n={len(subset):3}  F1={f1_n} (post-Michael={f1_post})  F2={f2_n}   [{fam_str}]")

    summarize('All FGFR', rows)
    for tgt in ('FGFR1', 'FGFR2', 'FGFR3', 'FGFR4'):
        subset = [r for r in rows if tgt in r.get('fgfr_targets', [])]
        summarize(tgt, subset)

    # Cys position — group by the auth_seq region (label_seq is internal;
    # use the dist + ligand identity to characterize Cys context)
    # We don't have UniProt-mapped auth_seq from this query, so we infer
    # which Cys it is by FGFR target: FGFR1=488, FGFR2=491, FGFR3=482, FGFR4=552
    print("\n=== FGFR4 Cys552 vs other Cys positions ===")
    fgfr4 = [r for r in rows if 'FGFR4' in r.get('fgfr_targets', [])]
    print(f"FGFR4 entries: {len(fgfr4)} — all assumed to hit Cys552 (the kinase-domain reactive Cys)")

    # F2 entries (if any)
    f2_rows = [r for r in rows if r['family_refined'] == 'F2']
    print(f"\n=== F2 (α,β-ynamide / butynamide) entries — user's lab focus ===")
    print(f"Count: {len(f2_rows)}")
    for r in f2_rows:
        print(f"  {r['entry']}  lig={r['lig_comp']:6}  {r['lig_chem_name'][:80]}")

    # F1 + F1 post-Michael per target
    print(f"\n=== F1 (acrylamide / post-Michael propanamide) entries ===")
    f1_rows = [r for r in rows if r['family_refined'] == 'F1']
    print(f"Count: {len(f1_rows)} (post-Michael saturated: {sum(1 for r in f1_rows if r.get('f1_post_michael'))})")

    # Save
    with open('/tmp/fgfr-inventory/FGFR_per_entry_refined.json', 'w') as fo:
        json.dump(rows, fo, indent=2)
    with open('/tmp/fgfr-inventory/FGFR_classified_refined.jsonl', 'w') as fo:
        for h in hits:
            fo.write(json.dumps(h) + '\n')

    # Cross-reference with the 2026-06-05 survey
    print(f"\n=== Cross-reference with covalent-ligand-survey-2026-06-05 ===")
    survey_path = '/Users/hilgersmt/Moorhen/docs/covalent-ligand-survey-2026-06-05/hits_classified.jsonl'
    survey_entries = defaultdict(list)
    fgfr_set = {r['entry'] for r in rows}
    with open(survey_path) as f:
        for line in f:
            h = json.loads(line)
            if h['entry'] in fgfr_set:
                survey_entries[h['entry']].append(h)
    print(f"FGFR entries in 2026-06-05 survey: {len(survey_entries)}/{len(fgfr_set)}")
    survey_fams = defaultdict(int)
    for ent, hh in survey_entries.items():
        primary_fam = sorted({h['family'] for h in hh})
        survey_fams[','.join(primary_fam)] += 1
    for fam, n in sorted(survey_fams.items(), key=lambda x: -x[1]):
        print(f"  survey-fam '{fam}': {n}")


if __name__ == "__main__":
    main()
