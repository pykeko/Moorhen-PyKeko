import json
with open('/tmp/btk-egfr-inventory/EGFR_final.json') as f:
    egfr = json.load(f)
print(f"=== EGFR unclassified ({sum(1 for e in egfr if e['family_final']=='unclassified')}) ===")
for e in egfr:
    if e['family_final'] in {'unclassified'}:
        n = e.get('lig_chem_name','')
        print(f"{e['entry']} {e['lig_comp']:8} res={e['resolution']}: {n[:140]}")
print(f"\n=== EGFR F2 ({sum(1 for e in egfr if e['family_final']=='F2')}) — first 25 ===")
seen = 0
for e in egfr:
    if e['family_final']=='F2':
        seen += 1
        if seen > 25: break
        print(f"{e['entry']} {e['lig_comp']:8} {e['drug_final'][:30]:30} res={e['resolution']}")
# F2 by year and resolution
print("\n=== EGFR F2 by year ===")
from collections import Counter
years = Counter(e['release_year'] for e in egfr if e['family_final']=='F2')
for y in sorted(years):
    print(f"  {y}: {years[y]}")
