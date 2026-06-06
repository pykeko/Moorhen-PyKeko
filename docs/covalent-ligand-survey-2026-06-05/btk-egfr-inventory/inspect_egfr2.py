import json
with open('/tmp/btk-egfr-inventory/EGFR_final.json') as f:
    egfr = json.load(f)

print("=== EGFR F1/F2-ambig (first 30) ===")
ambig = [e for e in egfr if e['family_final']=='F1/F2-ambig']
print(f"Total: {len(ambig)}")
for e in ambig[:30]:
    n = (e.get('lig_chem_name') or '')[:110]
    print(f"  {e['entry']} {e['lig_comp']:8} res={e['resolution']}: {n}")

print(f"\n=== EGFR F1 confirmed ({sum(1 for e in egfr if e['family_final']=='F1')}) ===")
for e in egfr:
    if e['family_final']=='F1':
        print(f"  {e['entry']} {e['lig_comp']:8} {e['drug_final'][:35]:35} res={e['resolution']}")
