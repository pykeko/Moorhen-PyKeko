#!/usr/bin/env python3
"""Inspect unclassified FGFR hits — drug names, IUPAC names — to find F2."""
import json
from collections import defaultdict

with open('/tmp/fgfr-inventory/FGFR_per_entry.json') as f:
    rows = json.load(f)

print("=== Per-entry primary rows by ligand code ===")
by_lig = defaultdict(list)
for r in rows:
    by_lig[r['lig_comp']].append(r)

for lig, ents in sorted(by_lig.items(), key=lambda x: -len(x[1])):
    r = ents[0]
    print(f"\n{lig} ({len(ents)} entry/ies, family={r['family']}, drug={r['drug_name'] or '?'})")
    print(f"  name: {(r['lig_chem_name'] or '')[:160]}")
    print(f"  formula: {r['lig_formula']}")
    print(f"  entries: {[e['entry'] for e in ents]}")
    print(f"  targets: {r['fgfr_targets']}, cys_seq(label_seq)={r['cys_seq']}, dist={r['dist']:.2f}")
