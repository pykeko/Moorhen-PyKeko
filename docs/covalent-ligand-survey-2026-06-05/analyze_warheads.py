#!/usr/bin/env python3
"""Classify each hit against F1-F6 warhead families using the chem_comp name
(plus a small heuristic on bonded atom + element).

This is a name-based classifier — not as good as SMARTS, but the ligand
chem_comp name from RCSB is rich enough (it embeds the IUPAC fragment) that
substring matching gives a robust first cut. We then run RDKit on a sample
to validate.
"""
import json, re
from collections import Counter, defaultdict

HITS = '/tmp/pdb_conn/hits.jsonl'
ATTRS_PATH = '/tmp/pdb_conn/chem_attrs.jsonl'  # filled in by enrich_chem.py

# Known warhead 3-letter codes (curated list — extends as we discover more)
F1_ACRYL = {
  # Acrylamide / methacrylamide / cyanoacrylamide derivatives
  # Common Cys-acrylamide warheads. We'll also auto-classify by name.
  'XQQ',  # actually F2 — but XQQ name contains 'but-2-ynamide' — let pattern match handle
}
F2_YNAMIDE = {
  'XQQ',  # acalabrutinib
  '7GB',  # tirabrutinib (per PDB 8FF0)
}
# Known F4 - chloroacetamide carriers can be many; use name-based.
F5_EPOX = set()

# Name patterns
# F2 = ynamide reacts with Cys-SH → but-2-enoyl (Z- or E-) vinyl thioether
#   The deposited *product* name will contain 'but-2-enoyl' or 'pent-2-enoyl' or 'hex-2-enoyl'
#   or 'prop-2-enoyl' (terminal propiolamide → acryloyl product).
#   We can't distinguish F1 acrylamide-product (prop-2-enamide → propanamide) from F2-product
#   by name alone for prop-2-en* cases, so we rely on the BONDED ATOM heuristic too:
#     * In F2 products the SG-Cβ bond targets a Cβ that's still sp2 (C=C remains)
#       → CCD will draw the C=C, and Cβ has 1 H
#     * In F1 products the C=C is gone → Cβ is sp3 with 2 Hs
#   We can't see Hs from this metadata directly. So we use the name regex and accept
#   that this is a heuristic upper bound on F1/F2 separation.
PAT_F2_PROD  = re.compile(r'\b(but-2-enoyl|pent-2-enoyl|hex-2-enoyl|but-2-enamid|pent-2-enamid|crotonamid|crotonoyl)', re.I)
PAT_F2_PRE   = re.compile(r'\b(but-2-yn|prop-2-yn|propynamid|propiolamid|propiolyl|pentynamid|hexynamid|ynamide|ynamid|propynoyl|propioloyl)', re.I)
PAT_F1       = re.compile(r'\b(acrylamid|prop-2-enamid|acryloyl|prop-2-enoyl|acrylo|methacryl|methacrylamid|cyanoacrylamid|acrylate|but-2-enamide.*methyl|maleimid|maleamic|fumar|prop-2-en-1-amine|allylamine|cinnamic|cinnamoyl|cinnamate|4.?hydroxycinnamic|vinylphenol|p-coumaroyl|coumaroyl|tyr.?osine.?ammonia|iminomethyl|chalcone|nitrostyrene|nitrovinyl)', re.I)
PAT_F3       = re.compile(r'\b(vinyl sulfon|vinyl sulfonamid|ethenesulfonyl|ethenesulfonamid|vinyl keton|prop-2-enenitril|acrylonitril)', re.I)
PAT_F4       = re.compile(r'\b(chloroacet|bromoacet|iodoacet|chloromethyl|bromomethyl|iodomethyl|fluoroacet|tosylmethyl|mesylmethyl|chloranyl.*ethanon|bromanyl.*ethanon|iodanyl.*ethanon|chloranyl.*propan|bromanyl.*propan|iodanyl.*propan|chloranyl.*ethan|bromanyl.*ethan|iodanyl.*ethan|chloranyl.*-propan|bromanyl.*-propan|2.?chloro.*-nitro.*benzamide|nitrohaloarene|2-chloro.*pyrimidin|2-fluoro.*pyrimidin|sulfonyloxy.*methyl)', re.I)
PAT_F5       = re.compile(r'\b(epoxid|oxiran|aziridin|azirid|beta-lactam|sultam|epoxysucc|epoxyketon|E[ -]?64)', re.I)
PAT_F6       = re.compile(r'\b(aldehyd|formyl|hemiketal|hemithio|hemiacetal|carbaldehyd|carbamaldehyd|-al\b|propanal|butanal|hexanal|pentanal|oxidanylidene|1-imino|imino-3|imino-1|imino.?propan|imino.?butan|trifluoromethyl.?keton|trifluoroketon|oxoethanal|oxopropanal|oxonitrile|nitrile.{0,40}reversibl|alpha[- ]ketoamide|alpha[- ]keto[- ]amide|alpha.ketoamide|azabicyclo.*octan-3-one|quinuclidinone|isatin)', re.I)
PAT_SUFEX    = re.compile(r'\b(sulfonyl fluorid|sulfonimid|sulfamoyl fluorid|sulphonyl fluorid)', re.I)
PAT_NITRILE  = re.compile(r'\b(carbonitril|nitrile|cyano)', re.I)
PAT_BORON    = re.compile(r'\b(boron|borate|boronic|borinic)', re.I)
PAT_ALDEHYDE_CARBO = re.compile(r'\b(carbaldehyd|carbamaldehyd)', re.I)

# Special-case codes the user enumerated
PALMITATE = {'PLM','MYR','C12','CYC','SCY'}  # palmitoyl/myristoyl S-acyl
NITROSO = {'SNN','SNC','SNO'}  # S-nitroso cys
GLUTATH = {'GTX','GSH','GTT','GTD'}  # glutathione adduct
SUGARS_S = {'NAG','MAN','GAL','GLC','FUC','RIB','BMA'}  # S-glycosyl rare

NATURAL_COFACTOR_S = {
    # heme C family (Cys-thioether linkages to porphyrin vinyls)
    'HEC','HEM','HDE','HDM','HCO','HEA','HEB','HBL','HE5','7HE',
    # bilins (phycobilins, biliverdins, phytochromobilin)
    'CYC','PEB','PUB','LBV','BLA','DBV','VRB','AX9','EL5','ISW','PBV','PΦB','PR1','P3Q','B6F',
    # iron/sulfur clusters (Cys-S coordination to FE)
    'SF4','FES','F3S','FE','3CO',
    # zinc fingers / metals
    'ZN','CA','MG','MN','CU','FE2','NI','CO','MO','HG','CD',
}
NATURAL_COFACTOR_PATTERNS = re.compile(r'\b(heme|bilin|biliverd|phyco|phycocyanob|phycoerythrob|phycourob|phytochromob|chlorophyll|cobalamin|farnesyl|geranyl|lipoyl|lipoam|iron[- ]sulfur|fe.?s cluster|porphyrin|chromophor)', re.I)

def classify(hit):
    code = hit['lig_comp']
    name = (hit.get('lig_chem_name') or '').lower()
    el = hit.get('lig_element', '')
    atom = (hit.get('lig_atom') or '').upper()

    # 0: natural-cofactor pre-filter (the dominant non-warhead category)
    if code in NATURAL_COFACTOR_S:
        if code in {'ZN','CA','MG','MN','CU','FE','FE2','NI','CO','MO','HG','CD','SF4','FES','F3S','3CO'}:
            return 'Natural-FeS/metal-cofactor'
        return 'Natural-heme/bilin-cofactor'
    if NATURAL_COFACTOR_PATTERNS.search(name):
        return 'Natural-cofactor-other'

    if not name:
        return 'unknown_no_name'

    # Order: F2-product (but-2-enoyl etc.) and F2-pre (ynamide form) BEFORE F1,
    # because F1 prop-2-enoyl would otherwise capture acryloyl (correctly F1) but
    # but-2-enoyl is unambiguous F2 (the deposited Michael product of butynamide).
    if PAT_F2_PRE.search(name) or PAT_F2_PROD.search(name):
        return 'F2'
    if PAT_F1.search(name):
        return 'F1'
    if PAT_F3.search(name):
        return 'F3'
    if PAT_F4.search(name):
        return 'F4'
    if PAT_F5.search(name):
        return 'F5'
    if PAT_F6.search(name):
        return 'F6'
    if PAT_SUFEX.search(name):
        return 'SuFEx'
    if PAT_BORON.search(name) and (el == 'B'):
        return 'Boronate'
    if el == 'B':
        return 'Boronate'
    if el == 'P':
        return 'P-modification'
    if PAT_NITRILE.search(name):
        return 'Nitrile-reversible'
    if el in ('Zn','Fe','Mg','Cu','Mn','Ni','Co','Mo','Ca','Hg','Cd','Pt','Pd','Au','Ag','Tl','Pb'):
        return 'Metal-coord-not-true-covalent'
    if code in {'FAD','FMN','FNR','6FA','FAS','FAE','FAB'} or 'flavin' in name:
        return 'PTM-flavin-8a-S-cysteinyl'
    if code in {'PLM','MYR','OCA','DGA','GER','FAR','LAU','OLA','OLE','PEC','PCA','Z41','C12','C16','C14','HEX'} or 'palmit' in name or 'myrist' in name or 'octanoyl' in name or 'lauroyl' in name or 'caprylic' in name or 'octanoic' in name or 'myristic' in name or 'palmitic' in name or 'fatty acid' in name or 'lipoyl' in name or 'lipoam' in name or 'farnes' in name or 'geranyl' in name or 'isoprenyl' in name or 'prenyl' in name or 'diacyl' in name or 'monoacyl' in name or 'palmityl' in name or 'hexadecanoyl' in name or 'tetradecanoyl' in name:
        return 'PTM-S-acyl-lipid'
    if code in {'IMP','UMP','TMP','DUP','DUR','U5P','TYS'} or 'nucleotidyl' in name or 'inosinic' in name or 'uridine' in name or 'thymidylate' in name or 'orotidine' in name:
        return 'Catalytic-Michael-nucleotide'
    if 'glutathion' in name:
        return 'PTM-S-glutathione'
    if 'nitros' in name and 'S' in atom:
        return 'PTM-S-nitroso'
    if 'cyanoacrylamid' in name:
        return 'F1-cyanoacrylamide'
    return 'unclassified'

def main():
    by_family = defaultdict(lambda: {'codes': Counter(), 'entries': set(), 'hits': 0})
    rows = []
    with open(HITS) as f:
        for line in f:
            h = json.loads(line)
            fam = classify(h)
            by_family[fam]['codes'][h['lig_comp']] += 1
            by_family[fam]['entries'].add(h['entry'])
            by_family[fam]['hits'] += 1
            h['family'] = fam
            rows.append(h)

    # Save classification
    with open('/tmp/pdb_conn/hits_classified.jsonl', 'w') as fo:
        for h in rows:
            fo.write(json.dumps(h) + '\n')

    print(f'=== FAMILY CLASSIFICATION ===')
    print(f'{"family":28} {"hits":>7} {"entries":>8} {"distinct codes":>14}   top5 codes')
    total_hits = sum(v['hits'] for v in by_family.values())
    for fam in sorted(by_family, key=lambda x: -by_family[x]['hits']):
        v = by_family[fam]
        top5 = ', '.join(c for c, _ in v['codes'].most_common(5))
        print(f'{fam:28} {v["hits"]:7} {len(v["entries"]):8} {len(v["codes"]):14}   {top5}')

    # F2 deep dive
    print('\n=== F2 (ynamide) ENTRIES ===')
    f2_hits = [h for h in rows if h['family'] == 'F2']
    print(f'F2 total hits: {len(f2_hits)}')
    print(f'F2 distinct codes: {sorted(set(h["lig_comp"] for h in f2_hits))}')
    print(f'F2 distinct entries: {sorted(set(h["entry"] for h in f2_hits))}')
    print(f'F2 geometry summary:')
    dists = [h['dist'] for h in f2_hits]
    if dists:
        mean = sum(dists)/len(dists)
        var = sum((d-mean)**2 for d in dists)/max(1, len(dists)-1)
        sd = var**0.5
        print(f'  SG-Cβ dist: mean={mean:.3f} σ={sd:.3f} min={min(dists):.3f} max={max(dists):.3f}  n={len(dists)}')

if __name__ == '__main__':
    main()
