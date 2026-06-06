#!/usr/bin/env python3
"""Final reclassifier — corrects the over-tagging of BTK propanamide deposits as
F2 terminal-propiolamide.

Rule: a post-Michael propanamide / propanoyl deposit is AMBIGUOUS between F1
(parent = acrylamide) and F2-terminal-propiolamide (parent = propynamide).
By literature prior, ~95% of BTK propanamide deposits are F1 (ibrutinib-class).
We label these 'F1/F2-ambiguous (post-product propanamide)' so the user can
make the final call from the free-drug SMILES.

Drug-dictionary entries with confirmed identity (acalabrutinib XQQ, tirabrutinib
7GB, ibrutinib 1E8 etc.) retain their hard labels.
"""
import json
import re
import sys
from collections import defaultdict

# Confirmed assignments: only the ones we KNOW the parent drug for. Everything
# else with a post-Michael propanamide stays ambiguous.
CONFIRMED = {
    # === BTK hand-curated from full IUPAC inspection ===
    'JVP': ('F7-nitrile', 'Pirtobrutinib-class', '1-cyanopiperidine (reversible nitrile-Cys)'),
    'R1L': ('F3', 'Ibrutinib (E)-pent-2-enenitrile analog', '(E)-α,β-unsat nitrile (acrylonitrile-class)'),
    '2IJ': ('F6-imine', 'Iminomethyl BTK probe', '(Z)-iminomethyl (formimidoyl)'),
    'TOO': ('F2-extended', 'Ibrutinib-PROTAC w/ extended methyl', 'extended methyl but-2-en-1-yl piperazine (PROTAC linker)'),
    '4C9': ('F7-nitrile', 'Ibrutinib pentanenitrile analog', '(2S)-pentanenitrile warhead (reversible nitrile-Cys)'),
    # === BTK confirmed ===
    'XQQ': ('F2', 'Acalabrutinib', 'methyl butynamide (canonical F2)'),
    '7GB': ('F2', 'Tirabrutinib', 'methyl butynamide (purinone scaffold)'),
    'LTJ': ('F2', 'Branebrutinib (BMS-986195)', 'methyl butynamide (indolo-pyridine)'),
    '1E8': ('F1', 'Ibrutinib', 'acrylamide (pre-reaction prop-2-en-1-one)'),
    '60K': ('F1', 'Ibrutinib analog', 'acrylamide'),
    '60Z': ('F1', 'Ibrutinib analog', 'acrylamide'),
    '6ZB': ('F1', 'Ibrutinib analog', 'acrylamide'),
    '6HL': ('F1', 'Ibrutinib analog (naphthyl)', 'acrylamide (pre)'),
    '6HJ': ('F1', 'Ibrutinib analog (indol-3-yl)', 'acrylamide (pre)'),
    'LFM': ('F1', 'Zanubrutinib', 'acrylamide'),
    'YQS': ('F2-terminal', 'Spebrutinib (CC-292)', 'terminal propiolamide (F2 special)'),
    'CT4': ('F2-terminal', 'Spebrutinib (CC-292)', 'terminal propiolamide (F2 special)'),
    # === EGFR confirmed ===
    'AHE': ('F2', 'Afatinib', 'extended methyl (4-NMe2-but-2-enamide)'),
    '0WN': ('F2', 'Canertinib (CI-1033)', 'extended methyl (4-NMe2-but-2-enamide)'),
    'P8H': ('F2', 'Afatinib analog', 'extended methyl (4-NMe2-but-2-enamide)'),
    'W2P': ('F2', 'Canertinib-like', 'extended methyl (4-NMe2-but-2-enamide)'),
    'HKI': ('F2', 'Neratinib (HKI-272)', 'extended methyl (4-NMe2-but-2-enamide)'),
    'WBJ': ('F2', 'Neratinib', 'extended methyl (4-NMe2-but-2-enamide)'),
    'XL6': ('F2', 'Dacomitinib', 'extended methyl (4-piperidinyl-but-2-enamide)'),
    'YY3': ('F2', 'Dacomitinib', 'extended methyl (4-piperidinyl-but-2-enamide)'),
    '6S3': ('F2', 'Mobocertinib (TAK-788)', 'extended methyl (4-NMe2-but-2-enamide)'),
    'OBE': ('F1', 'Osimertinib', 'acrylamide'),
    'YY8': ('F1', 'Osimertinib', 'acrylamide'),
    'P06': ('F1', 'Osimertinib (AZD9291)', 'acrylamide'),
    'P0B': ('F1', 'Osimertinib analog', 'acrylamide'),
    'P0Y': ('F1', 'Osimertinib analog', 'acrylamide'),
    '0XO': ('F1', 'WZ4002', 'acrylamide'),
    '1C9': ('F2', 'CI-1033-like extended methyl', 'extended methyl (4-piperidinyl-but-2-enamide)'),
    'A1A4E': ('F2', '3rd-gen EGFR extended-methyl', 'extended methyl (4-NMe2-but-2-en)'),
    'A1IMT': ('F2', 'Olafertinib-class extended methyl', 'extended methyl (4-NMe2-but-2-enamide)'),
    'A1IE0': ('F2', 'EGFR ethynyl extended methyl', 'extended methyl pre (ethynyl)'),
    'A1H7N': ('F2', 'EGFR ethynyl pyrimidinyl', 'extended methyl pre (ethynyl)'),
    'A1H7O': ('F2', 'EGFR ethenyl 5-cyclopropyl-oxazol', 'extended methyl pre/post'),
    'A1JLU': ('F2', 'EGFR 5-ethenyl extended methyl', 'extended methyl (vinyl, pre)'),
    'A1L8T': ('F2', 'EGFR extended methyl 3-aryl', 'extended methyl'),
    'A1BYD': ('F1', 'Oritinib', 'acrylamide'),
    'A1BYK': ('F1', 'Alflutinib (Furmonertinib)', 'acrylamide'),
    'A1BYS': ('F1', 'Lazertinib-class', 'acrylamide'),
    # EGFR hand-curated from full IUPAC inspection
    '5XH': ('F2', 'EGFR 4-(dimethylamino)but-2-enoyl-azepan-benzimidazol probe', 'extended methyl (4-NMe2-but-2-enoyl)'),
    '8LU': ('F4', 'EGFR 2-fluoroacetyl-pyrrolidine probe', '2-fluoroacetamide (haloacetyl, SN2)'),
    'A1IR8': ('F3', 'EGFR pyrido[2,3-d]pyrimidin-7-one (5-ethyl)', 'pyrido-pyrimidinone Michael acceptor (no acrylamide in name)'),
    'A1ISA': ('F3', 'EGFR pyrido[2,3-d]pyrimidin-7-one (5-ethyl, 2-methoxy)', 'pyrido-pyrimidinone Michael acceptor'),
    'YY3': ('F2', 'Dacomitinib', 'extended methyl (4-piperidinyl-but-2-enamide)'),
    'WBJ': ('F2', 'Neratinib', 'extended methyl (4-NMe2-but-2-enamide)'),
    'MWU': ('F1', 'Pyridin-2-yl-prop-2-enamide', 'acrylamide (pre)'),
    'N86': ('F1', 'Quinolin-7-yl-prop-2-enamide', 'acrylamide (pre)'),
    'N99': ('F1', 'Pyrazolopyridin-2-yl-prop-2-enamide', 'acrylamide (pre)'),
}

PAT_F1_POST = re.compile(r'\b(propanamid|propanoyl|propan-1-one|propanami[no]|propanoylamino|1-propanoyl)', re.I)
PAT_F2_PRE_STRICT = re.compile(r'\b(but-2-yn|pent-2-yn|hex-2-yn)', re.I)
PAT_F2_TERM_PRE = re.compile(r'\b(prop-2-yn-?am|propiolamid|propynamid|propynoyl|prop-2-ynoyl)', re.I)
PAT_F2_POST_BUT2EN = re.compile(r'\b(but-2-en[oa][ymi])', re.I)
PAT_F2_POST_EXT = re.compile(r'\b(4-\(dimethylamino\)but|4-\(diethylamino\)but|4-piperidin[\w-]*?but|4-morpholin[\w-]*?but|4-pyrrolidin[\w-]*?but|4-piperaz[\w-]*?but|4-azetidin[\w-]*?but)', re.I)
PAT_F1_PRE = re.compile(r'\b(prop-2-en-1-one|prop-2-enamide|acrylamide|acryloyl|prop-2-enoyl|prop-2-enam)', re.I)
PAT_F4 = re.compile(r'\b(chloroacet|bromoacet|iodoacet|chloranyl-?ethanon|bromanyl-?ethanon|2-chloro-?pyrimid)', re.I)
PAT_F5 = re.compile(r'\b(epoxid|oxiran|aziridin|beta-lactam)', re.I)
PAT_F6 = re.compile(r'\b(carbaldehyd|aldehyd|carbonitril\b|nitrile\b)', re.I)
PAT_METAL = re.compile(r'^(ZN|FE|MG|MN|CU|NI|CO|MO|CA|HG|CD|NA|K|LI|FE2)$', re.I)

def reclassify(h):
    code = h['lig_comp']
    name = (h.get('lig_chem_name') or '')
    name_lower = name.lower()
    atom = (h.get('lig_atom') or '').upper()
    el = atom[0] if atom else ''

    if PAT_METAL.match(code):
        return 'metal-cofactor', 'metal ion (non-warhead)', ''

    # 1. Confirmed drug dictionary
    if code in CONFIRMED:
        return CONFIRMED[code]

    # 2. Pre-reaction signatures (most authoritative — alkyne vs alkene)
    if PAT_F2_TERM_PRE.search(name_lower):
        return 'F2-terminal', '', 'terminal propiolamide (free drug pre-reaction)'
    if PAT_F2_PRE_STRICT.search(name_lower):
        return 'F2', '', 'methyl butynamide (free drug pre-reaction)'
    if PAT_F1_PRE.search(name_lower):
        return 'F1', '', 'acrylamide (free drug pre-reaction)'

    # 3. Post-reaction but-2-enoyl → F2
    if PAT_F2_POST_BUT2EN.search(name_lower):
        if PAT_F2_POST_EXT.search(name_lower):
            return 'F2', '', 'extended methyl post (but-2-enoyl with 4-amine)'
        return 'F2', '', 'methyl butynamide post (but-2-enoyl)'

    # 4. Post-product saturated 4-(amine)-butanamide → F2 extended methyl post
    if PAT_F2_POST_EXT.search(name_lower) and ('butan' in name_lower or 'butyl' in name_lower):
        return 'F2', '', 'extended methyl post-product (saturated butanamide)'

    # 5. Post-product propanamide / propan-1-one → ambiguous (mostly F1 in practice)
    if PAT_F1_POST.search(name_lower):
        return 'F1/F2-ambig', '', 'post-product propanamide (parent: acrylamide F1 or terminal propiolamide F2)'

    # 6. F4 / F5 / F6
    if PAT_F4.search(name_lower):
        return 'F4', '', 'halo-acetamide / S_NAr'
    if PAT_F5.search(name_lower):
        return 'F5', '', 'strained ring (epoxide/aziridine/beta-lactam)'
    if PAT_F6.search(name_lower):
        return 'F6/F7', '', 'aldehyde or nitrile-reversible'
    if el == 'B':
        return 'Boronate', '', 'B–Cys (boronate)'
    return 'unclassified', '', '(unknown)'

def main():
    for label in ('BTK','EGFR'):
        with open(f'/tmp/btk-egfr-inventory/{label}_per_entry.json') as f:
            rows = json.load(f)
        out = []
        fam_counts = defaultdict(int)
        f2_ext = 0
        f2_butynamide = 0
        f2_terminal = 0
        f1_count = 0
        for r in rows:
            fam, drug, chem = reclassify(r)
            r['family_final'] = fam
            r['drug_final'] = drug
            r['warhead_chem'] = chem
            fam_counts[fam] += 1
            if fam == 'F2':
                if 'extended' in chem.lower():
                    f2_ext += 1
                else:
                    f2_butynamide += 1
            if fam == 'F2-terminal':
                f2_terminal += 1
            if fam == 'F1':
                f1_count += 1
            out.append(r)
        with open(f'/tmp/btk-egfr-inventory/{label}_final.json', 'w') as fo:
            json.dump(out, fo, indent=2)
        print(f"\n=== {label} — {len(out)} Cys-SG covalent entries ===")
        for fam in sorted(fam_counts, key=lambda x: -fam_counts[x]):
            print(f"  {fam:30} {fam_counts[fam]}")
        print(f"  F2 methyl-butynamide canonical: {f2_butynamide}")
        print(f"  F2 extended-methyl: {f2_ext}")
        print(f"  F2-terminal (spebrutinib-class): {f2_terminal}")
        print(f"  F1 (acrylamide): {f1_count}")

if __name__ == "__main__":
    main()
