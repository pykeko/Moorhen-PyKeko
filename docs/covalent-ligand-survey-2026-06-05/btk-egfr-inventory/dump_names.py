import json
print("=== BTK unclassified + ambig full names ===")
with open('/tmp/btk-egfr-inventory/BTK_final.json') as f:
    btk = json.load(f)
for e in btk:
    if e['family_final'] in {'unclassified','F1/F2-ambig'}:
        n = e.get('lig_chem_name','')
        print(f"{e['entry']} {e['lig_comp']:8}: {n}")
