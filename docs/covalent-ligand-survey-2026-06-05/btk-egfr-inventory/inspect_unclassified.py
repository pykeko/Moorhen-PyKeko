#!/usr/bin/env python3
"""Print all unclassified hits to find regex undercounts."""
import json
for label in ('BTK', 'EGFR'):
    print(f"\n===== {label} UNCLASSIFIED =====")
    with open(f'/tmp/btk-egfr-inventory/{label}_per_entry.json') as f:
        rows = json.load(f)
    unc = [r for r in rows if r['family'] == 'unclassified']
    for r in unc:
        n = (r.get('lig_chem_name') or '')[:120]
        print(f"  {r['entry']}  {r['lig_comp']:8} atom={r['lig_atom']:6} {r.get('resolution')} | {n}")
