#!/usr/bin/env python3
"""Improved classification of BTK/EGFR covalent hits.

Critical insight: many deposits use the POST-Michael product as their CCD entry,
so the IUPAC name reads "propanamide" (saturated) instead of "prop-2-enamide" /
"acrylamide". The fact that there's a covalent Cys-SG bond plus a "propanoyl" /
"propanamide" / "propan-1-one" group on the ligand is the F1 post-reaction
signature.

Likewise F2-extended-methyl deposits often read "4-(dimethylamino)butanamide"
or "1-propanoylpyrrolidin-3-yl" / "1-propanoylazepan" etc. — the saturated form
of the extended-methyl ynamide. Hard to distinguish from F1 by name alone in
post-reaction state. We use the FREE-DRUG dictionary to disambiguate.

Free-drug warhead chemistry per drug (Cys-binders, public knowledge):
  - F1 (acrylamide): ibrutinib, zanubrutinib, evobrutinib, osimertinib, rociletinib,
                     spebrutinib (prop-2-yn-amide, terminal, technically F2-special),
                     CL-387785, WZ4002, WZ3146, AVL-292
  - F2 (butynamide): acalabrutinib, tirabrutinib, pirtobrutinib (not covalent),
                     mobocertinib (extended), neratinib (extended-methyl 4-NMe2-but-2-en),
                     afatinib (extended-methyl 4-NMe2-but-2-en),
                     dacomitinib (extended-methyl 4-piperidinyl-but-2-en),
                     canertinib CI-1033 (extended-methyl 4-morpholin-but-2-en),
                     mobocertinib AP32788 (extended-methyl 4-NMe2-but-2-en)

Approach: when name has "propanoyl" / "propanamide" / "propan-1-one" with no other
ynamide / unsaturation marker and there's a covalent Cys-SG bond, classify as
'F1-post-product' (the saturated form of the acrylamide warhead). When name has
"butanoyl" / "butanamide" with a 4-amine substituent (NMe2 / piperidinyl /
morpholinyl / pyrrolidinyl / piperazinyl / azetidin / azepan), classify as
'F2-post-extended-methyl'.
"""
import json
import re
import sys
from collections import defaultdict

sys.path.insert(0, '/Users/hilgersmt/Moorhen/docs/covalent-ligand-survey-2026-06-05')
from analyze_warheads import classify as base_classify, PAT_F1, PAT_F2_PRE, PAT_F2_PROD

# F1-product (post-Michael acrylamide):
#   "propanamide", "propanoyl", "propan-1-one", "propanamido", "(propanoylamino)"
# We require the bonded atom to be a carbon (not S/N/etc.) and resolution exists.
PAT_F1_POST = re.compile(
    r'\b(propanamid|propanoyl|propan-1-one|propanam[io]|propanamido|propanoylamino|'
    r'propanoyl-?amino|propan-1-yl|propano[yl][\w-]*?amid)',
    re.I
)

# F2-product extended-methyl: butanamide / butanoyl WITH 4-amine substituent
# (post-Michael of extended butynamide). The vinyl C=C is reduced; we must
# infer the pre-product from the substituent pattern.
PAT_F2_POST_EXT = re.compile(
    r'\b(4-\(dimethylamino\)butanam|4-\(dimethylamino\)butanoyl|'
    r'4-\(methyl[^)]*amino\)butanam|4-\(methyl[^)]*amino\)butanoyl|'
    r'4-piperidin-?\d*-?yl[- ]?butan|4-morpholin-?\d*-?yl[- ]?butan|'
    r'4-pyrrolidin-?\d*-?yl[- ]?butan|4-piperazin-?\d*-?yl[- ]?butan|'
    r'4-azetidin-?\d*-?yl[- ]?butan|'
    r'butanam[io]de.*dimethylamin|butanoyl.*dimethylamin|'
    r'4-azet|4-pyrr|4-piperid|4-morpholin|4-piperaz)',
    re.I
)

# Drug-name lookup: maps ligand CCD code → known drug + warhead F-class
DRUG_INFO = {
    # === BTK ===
    'XQQ': ('Acalabrutinib', 'F2', 'methyl butynamide'),
    '7GB': ('Tirabrutinib', 'F2', 'methyl butynamide'),
    '1E8': ('Ibrutinib', 'F1', 'acrylamide'),
    '60K': ('Ibrutinib', 'F1', 'acrylamide'),
    '60Z': ('Ibrutinib', 'F1', 'acrylamide'),
    '6ZB': ('Ibrutinib', 'F1', 'acrylamide'),
    '6HL': ('Ibrutinib analog (1H-naphthyl)', 'F1', 'acrylamide'),
    '6HJ': ('Ibrutinib analog (1H-indol-3-yl)', 'F1', 'acrylamide'),
    'LFM': ('Zanubrutinib', 'F1', 'acrylamide'),
    'YQS': ('Spebrutinib (CC-292)', 'F2', 'terminal propiolamide'),
    'CT4': ('Spebrutinib (CC-292)', 'F2', 'terminal propiolamide'),
    'LTJ': ('Branebrutinib (BMS-986195)', 'F2', 'methyl butynamide'),
    '8E8': ('Ibrutinib post-product variant', 'F1', 'propanoyl (acrylamide post)'),
    '4C9': ('Ibrutinib analog (penta-2-yn or saturated)', 'F2', 'extended ynamide?'),
    '7G8': ('Spebrutinib post (propanoylamino)', 'F2', 'terminal propiolamide post'),
    '7G9': ('Spebrutinib post (propanoylamino)', 'F2', 'terminal propiolamide post'),
    'GYL': ('Branebrutinib-like (propanamide post)', 'F2', 'terminal propiolamide post'),
    'GJD': ('Branebrutinib-like (propanoyl post)', 'F2', 'terminal propiolamide post'),
    'GJ7': ('Branebrutinib-like (5-propanoyl bicycle post)', 'F2', 'terminal propiolamide post'),
    'BA0': ('Branebrutinib-like (1-propanoylpiperidine post)', 'F2', 'terminal propiolamide post'),
    'KHD': ('Spebrutinib-like (propanamide post)', 'F2', 'terminal propiolamide post'),
    'N6Z': ('Methyl-propanoyl BTK inhibitor', 'F2', 'terminal propiolamide post'),
    '0CI': ('Propanoylpyrrolidin BTK inhibitor', 'F2', 'terminal propiolamide post'),
    'TOO': ('BTK PROTAC-style with E-but-2-enoyl extension', 'F2', 'extended methyl'),
    'UB6': ('Propanoyl-cyclopentyl-thiazolopyrimidinone', 'F2', 'terminal propiolamide post'),
    'V72': ('Propanamide BTK inhibitor (pyrazolopyrazine)', 'F2', 'terminal propiolamide post'),
    'V7I': ('Propanoyl-azabicycloheptane BTK inhibitor', 'F2', 'terminal propiolamide post'),
    # === EGFR ===
    'AHE': ('Afatinib', 'F2', 'extended methyl (4-NMe2-but-2-en)'),
    '0WN': ('Canertinib (CI-1033)', 'F2', 'extended methyl (4-NMe2-but-2-en)'),
    'P8H': ('Afatinib', 'F2', 'extended methyl (4-NMe2-but-2-en)'),
    'W2P': ('Canertinib-like extended methyl', 'F2', 'extended methyl (4-NMe2-but-2-en)'),
    'HKI': ('Neratinib (HKI-272)', 'F2', 'extended methyl (4-NMe2-but-2-en)'),
    'WBJ': ('Neratinib', 'F2', 'extended methyl (4-NMe2-but-2-en)'),
    'XL6': ('Dacomitinib', 'F2', 'extended methyl (4-piperidinyl-but-2-en)'),
    'YY3': ('Dacomitinib', 'F2', 'extended methyl (4-piperidinyl-but-2-en)'),
    '6S3': ('Mobocertinib (TAK-788)', 'F2', 'extended methyl (4-NMe2-but-2-en)'),
    'OBE': ('Osimertinib', 'F1', 'acrylamide'),
    'YY8': ('Osimertinib', 'F1', 'acrylamide'),
    'P06': ('Osimertinib (AZD9291)', 'F1', 'acrylamide'),
    'P0B': ('Osimertinib analog', 'F1', 'acrylamide'),
    'P0Y': ('Osimertinib analog', 'F1', 'acrylamide'),
    '0XO': ('WZ4002', 'F1', 'acrylamide'),
    '1C9': ('Canertinib (CI-1033) Z-extended methyl', 'F2', 'extended methyl post-product'),
    'A1A4E': ('Olafertinib / 3rd-gen EGFR (extended methyl)', 'F2', 'extended methyl post-product'),
    'A1ILI': ('EGFR F1 post-product (propanoyl)', 'F1', 'acrylamide (post)'),
    'A1IMT': ('Olafertinib variant', 'F2', 'extended methyl (4-NMe2-but-2-en)'),
    'A1JLU': ('EGFR Cys covalent (5-ethenyl) extended methyl', 'F2', 'pre-reaction vinyl'),
    'A1L8T': ('EGFR Cys covalent (3-aryl extended methyl)', 'F2', 'extended methyl'),
    'A1BYD': ('Oritinib', 'F1', 'acrylamide'),
    'A1BYK': ('Alflutinib (Furmonertinib)', 'F1', 'acrylamide'),
    'A1BYS': ('Lazertinib / Almonertinib-like', 'F1', 'acrylamide'),
    'A1IUK': ('EGFR F1 propanoyl extended', 'F1', 'acrylamide (post)'),
    'A1IZ8': ('EGFR F1 propan-1-one extended', 'F1', 'acrylamide (post)'),
    'A1IE0': ('EGFR F2 ethynyl extended', 'F2', 'pre-reaction ethynyl'),
    'A1H7N': ('EGFR F2 ethynyl pyrimidinyl', 'F2', 'pre-reaction ethynyl'),
    'A1H7O': ('EGFR F2 ethenyl 5-cyclopropyl-oxazol', 'F2', 'pre-reaction ethenyl'),
    'A1ILN': ('EGFR F1 propanoyl pyridine', 'F1', 'acrylamide (post)'),
    'A1ILK': ('EGFR F1 propanoyl benzimidazole', 'F1', 'acrylamide (post)'),
    'A1ILJ': ('EGFR F1 propanoyl pyrazol', 'F1', 'acrylamide (post)'),
    'A1IR8': ('EGFR F1 pyrido[2,3-d]pyrimidinone', 'F1', 'acrylamide (post)'),
    'A1ISA': ('EGFR F1 pyrido[2,3-d]pyrimidinone analog', 'F1', 'acrylamide (post)'),
    'EVO': ('Evobrutinib', 'F1', 'acrylamide'),
    'P9X': ('Pirtobrutinib', 'non-covalent (control)', 'N/A'),
    # Common F4 / other
    '3LH': ('AG1478 / chloroacetyl?', 'F4', 'chloroacetamide'),
    '5X4': ('Trifluoromethyl-benzamide propanoyl', 'F1', 'acrylamide (post)'),
    '633': ('F1 propanamide', 'F1', 'acrylamide (post)'),
    '630': ('F1 propanoyl pyrrolidine', 'F1', 'acrylamide (post)'),
    '634': ('F1 propanamide', 'F1', 'acrylamide (post)'),
    '63A': ('F1 propan-1-one CF3 pyrrolidine', 'F1', 'acrylamide (post)'),
    '5J9Y_acryl': ('F1 prop-2-en-1-one', 'F1', 'acrylamide (pre)'),  # placeholder
    '5YU9_1E8': ('Ibrutinib pre (acrylamide)', 'F1', 'acrylamide'),
    '80U': ('F1 propanoyl piperidine (acrylamide post)', 'F1', 'acrylamide (post)'),
    '816': ('F1 propanoyl piperidine (acrylamide post)', 'F1', 'acrylamide (post)'),
    '8BP': ('F1 propanamide pyrrolidin (acrylamide post)', 'F1', 'acrylamide (post)'),
    '8AM': ('F1 propanamide methoxypyrazol (acrylamide post)', 'F1', 'acrylamide (post)'),
    '8BS': ('F1 propanamide pyrrolidin (acrylamide post)', 'F1', 'acrylamide (post)'),
    '8OV': ('F1 propanamide (acrylamide post)', 'F1', 'acrylamide (post)'),
    'FZP': ('F1 propanoylamino carbamate (acrylamide post)', 'F1', 'acrylamide (post)'),
    'N7K': ('F1 propanamide indazole (acrylamide post)', 'F1', 'acrylamide (post)'),
    'N7B': ('F1 propanamide indazole (acrylamide post)', 'F1', 'acrylamide (post)'),
    'QP1': ('F1 propanamide imidazole (acrylamide post)', 'F1', 'acrylamide (post)'),
    'QQJ': ('F1 propanamide imidazole (acrylamide post)', 'F1', 'acrylamide (post)'),
    'QQM': ('F1 propanamide imidazole (acrylamide post)', 'F1', 'acrylamide (post)'),
    'Q6K': ('F1 propanamide methylindole (acrylamide post, osim-like)', 'F1', 'acrylamide (post)'),
    'R28': ('F1 propanoylamino isopropyl ester (acrylamide post)', 'F1', 'acrylamide (post)'),
    'VO7': ('F1 propanamide methoxy (acrylamide post)', 'F1', 'acrylamide (post)'),
    'ZRT': ('F1 propanamide morpholin pyrazol (acrylamide post)', 'F1', 'acrylamide (post)'),
    'MWU': ('N-pyridin-2-yl-prop-2-enamide (acrylamide pre)', 'F1', 'acrylamide (pre)'),
    'N86': ('N-quinolin-7-yl-prop-2-enamide (acrylamide pre)', 'F1', 'acrylamide (pre)'),
    'N99': ('N-pyrazolopyridin-2-yl-prop-2-enamide (acrylamide pre)', 'F1', 'acrylamide (pre)'),
    '2I0': ('F1 propan-1-one pyrrolidin (acrylamide post)', 'F1', 'acrylamide (post)'),
    '2I6': ('F1 propan-1-one azetidin (acrylamide post)', 'F1', 'acrylamide (post)'),
    '2EI': ('F1 propanoyl pyrrolidin (acrylamide post)', 'F1', 'acrylamide (post)'),
    '2II': ('F1 propanoyl pyrrolidin (acrylamide post)', 'F1', 'acrylamide (post)'),
    '26X': ('F1 propanoyl azetidin (acrylamide post)', 'F1', 'acrylamide (post)'),
    'HZ6': ('F1 propan-1-one azetidin (acrylamide post)', 'F1', 'acrylamide (post)'),
}

# F1 acrylamide pre-product: name contains "prop-2-en-1-one", "prop-2-enamide", "acrylamide"
PAT_F1_PRE = re.compile(r'\b(prop-2-en-1-one|prop-2-enamide|acrylamide|acryloyl|prop-2-enoyl|prop-2-enamid)', re.I)
# F2 pre-product: name contains "but-2-ynamide", "prop-2-ynamide" (terminal=spebrutinib), "pent-2-ynamide", etc.
PAT_F2_PRE_STRICT = re.compile(r'\b(but-2-yn|pent-2-yn|hex-2-yn|propiolamid|propynamid|prop-2-ynamid|prop-2-yne)', re.I)
# F2 post extended methyl
PAT_F2_POST_BUT2EN = re.compile(r'\b(but-2-enoyl|but-2-enam[io]de|but-2-enamid)', re.I)

def is_metal_ion(code):
    return code in {'ZN','CA','MG','MN','CU','FE','FE2','NI','CO','MO','HG','CD','NA','K','LI'}

def reclassify(h):
    code = h['lig_comp']
    name = (h.get('lig_chem_name') or '').lower()
    atom = (h.get('lig_atom') or '').upper()
    el = atom[0] if atom else ''
    # 0: metal
    if is_metal_ion(code) or atom in {'ZN','FE','MG','MN','CU','NI','CO','MO','CA','HG','CD','K','LI'}:
        return 'Natural-metal-cofactor', '', ''
    # 1: Drug dictionary first (most authoritative)
    if code in DRUG_INFO:
        drug, fam, chem = DRUG_INFO[code]
        return fam, drug, chem
    # 2: Pre-product F2 signature: but-2-yn / prop-2-yn / pent-2-yn
    if PAT_F2_PRE_STRICT.search(name):
        chem = 'methyl butynamide' if 'but-2-yn' in name else ('terminal propiolamide' if ('prop-2-yn' in name or 'propiolamid' in name) else 'ynamide')
        return 'F2', '', chem
    # 3: Post-product F2 extended methyl: but-2-enoyl / but-2-enamide AND a 4-amine
    if PAT_F2_POST_BUT2EN.search(name):
        ext = '(extended methyl)' if ('dimethylamin' in name or 'piperidin' in name or 'morpholin' in name or 'pyrrolidin' in name or 'piperaz' in name or 'azetidin' in name) else ''
        return 'F2', '', f'but-2-enoyl post {ext}'.strip()
    # 4: Post-product F2 extended methyl (saturated form): "4-(NMe2)butanamide" etc.
    if PAT_F2_POST_EXT.search(name) and 'butan' in name:
        return 'F2', '', 'extended-methyl post (saturated butanamide)'
    # 5: F1 pre-product: prop-2-enamide / acrylamide
    if PAT_F1_PRE.search(name):
        return 'F1', '', 'acrylamide (pre)'
    # 6: F1 post-product (saturated): propanoyl / propanamide / propan-1-one
    if PAT_F1_POST.search(name):
        return 'F1', '', 'acrylamide (post product, saturated)'
    # 7: F4 chloro/bromo/iodoacetamide
    if re.search(r'\b(chloroacet|bromoacet|iodoacet|chloranyl-?ethan|chloromethyl|2-chloro)', name):
        return 'F4', '', 'halo-acetamide / SNAr'
    # 8: F6 aldehyde / nitrile reversible
    if re.search(r'\b(aldehyd|formyl|nitrile|carbonitril|cyano)', name):
        return 'F6/F7', '', 'aldehyde or nitrile'
    # 9: Boron
    if 'B' == el and 'boron' in name:
        return 'Boronate', '', 'B-Cys'
    # 10: Default heuristic by atom
    if el == 'C':
        return 'unclassified-Cys-C', '', '(unknown post-Michael)'
    return 'unclassified', '', ''

def main():
    for label in ('BTK', 'EGFR'):
        with open(f'/tmp/btk-egfr-inventory/{label}_per_entry.json') as f:
            rows = json.load(f)
        out = []
        fam_counts = defaultdict(int)
        f2_ext_count = 0
        f2_term_count = 0
        f2_pre_count = 0
        for r in rows:
            fam, drug, chem = reclassify(r)
            r['family_final'] = fam
            r['drug_final'] = drug or r.get('drug_name', '')
            r['warhead_chem'] = chem
            fam_counts[fam] += 1
            if fam == 'F2':
                if 'extended' in chem.lower() or '4-' in chem:
                    f2_ext_count += 1
                if 'terminal' in chem.lower() or 'propiolamid' in chem.lower():
                    f2_term_count += 1
                if 'pre' in chem.lower() or 'butynamide' in chem.lower() or 'propiolamide' in chem.lower():
                    f2_pre_count += 1
            out.append(r)
        with open(f'/tmp/btk-egfr-inventory/{label}_final.json', 'w') as fo:
            json.dump(out, fo, indent=2)
        print(f"\n=== {label} ({len(out)} entries) ===")
        for fam in sorted(fam_counts, key=lambda x: -fam_counts[x]):
            print(f"  {fam:30} {fam_counts[fam]}")
        print(f"  F2 extended-methyl count: {f2_ext_count}")
        print(f"  F2 terminal-propiolamide count: {f2_term_count}")

if __name__ == "__main__":
    main()
