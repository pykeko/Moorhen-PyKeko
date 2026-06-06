import json
print("=== BTK F2 ===")
with open('/tmp/btk-egfr-inventory/BTK_final.json') as f:
    btk = json.load(f)
for e in sorted(btk, key=lambda x: (0 if x['family_final']=='F2' else 1, x['entry'])):
    if e['family_final'] in {'F2','F2-terminal'}:
        print(f"  {e['entry']} {e['lig_comp']:8} {e['drug_final']:35} res={e['resolution']} year={e['release_year']}")
print("\n=== BTK F1 (canonical acrylamide) ===")
for e in btk:
    if e['family_final']=='F1':
        print(f"  {e['entry']} {e['lig_comp']:8} {e['drug_final']:35} res={e['resolution']} year={e['release_year']}")
print("\n=== BTK F1/F2-ambig (post-product propanamide) ===")
for e in btk:
    if e['family_final']=='F1/F2-ambig':
        n = (e.get('lig_chem_name') or '')[:70]
        print(f"  {e['entry']} {e['lig_comp']:8} res={e['resolution']} year={e['release_year']} | {n}")
print("\n=== BTK metal-cofactor (likely non-BTK proteins in mixture) ===")
for e in btk:
    if e['family_final']=='metal-cofactor':
        print(f"  {e['entry']} {e['lig_comp']:8} title={e['title'][:80]}")
print("\n=== BTK unclassified ===")
for e in btk:
    if e['family_final']=='unclassified':
        n = (e.get('lig_chem_name') or '')[:90]
        print(f"  {e['entry']} {e['lig_comp']:8} {n}")
