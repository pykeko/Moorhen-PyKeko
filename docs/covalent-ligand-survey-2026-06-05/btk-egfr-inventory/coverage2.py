import json
with open('/tmp/btk-egfr-inventory/BTK_final.json') as f:
    btk = json.load(f)
for e in btk:
    if e['entry'] in {'8FD9','8FF0','8X2A','5KUP','5P9M','6O8I','9CUW','9CUX','9YSI'}:
        print(f"{e['entry']}  lig={e['lig_comp']:8} fam={e['family_final']:8} drug={e.get('drug_final','')[:30]:30} chem={e['warhead_chem']}")
print(f"\nBTK total covalent: {len(btk)}")
btk_ids = {e['entry'] for e in btk}
with open('/tmp/btk-egfr-inventory/BTK_all_ids.json') as f:
    all_ids = set(json.load(f)['ids'])
print(f"Missing from covalent (no covale row or non-covalent ligand): {len(all_ids - btk_ids)}")
key = {'5KUP','8FD9','8FF0','9CUW','9CUX'}
for k in key:
    if k in all_ids and k not in btk_ids:
        print(f"  KEY F2 missing: {k}")
