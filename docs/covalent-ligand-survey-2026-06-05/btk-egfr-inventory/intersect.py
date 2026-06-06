#!/usr/bin/env python3
"""Intersect the BTK / EGFR all-entry lists with the existing classified survey
to find Cys-covalent entries per target."""
import json
from collections import defaultdict

CLASSIFIED = '/Users/hilgersmt/Moorhen/docs/covalent-ligand-survey-2026-06-05/hits_classified.jsonl'

def load_target(path):
    with open(path) as f:
        return set(json.load(f)['ids'])

btk_all = load_target('/tmp/btk-egfr-inventory/BTK_all_ids.json')
egfr_all = load_target('/tmp/btk-egfr-inventory/EGFR_all_ids.json')

# Walk the classified file once, collect hits per entry for BTK and EGFR
btk_hits = defaultdict(list)
egfr_hits = defaultdict(list)
with open(CLASSIFIED) as f:
    for line in f:
        h = json.loads(line)
        ent = h['entry']
        if ent in btk_all:
            btk_hits[ent].append(h)
        if ent in egfr_all:
            egfr_hits[ent].append(h)

print(f"BTK entries with covalent hits in survey: {len(btk_hits)} / {len(btk_all)} ({100*len(btk_hits)/len(btk_all):.0f}%)")
print(f"EGFR entries with covalent hits in survey: {len(egfr_hits)} / {len(egfr_all)} ({100*len(egfr_hits)/len(egfr_all):.0f}%)")

# Save the per-target hits
def save(d, name):
    out = {ent: hits for ent, hits in sorted(d.items())}
    with open(f'/tmp/btk-egfr-inventory/{name}_hits.json', 'w') as f:
        json.dump(out, f, indent=2)
    return out

btk_out = save(btk_hits, 'BTK')
egfr_out = save(egfr_hits, 'EGFR')

# Family distribution
print("\nBTK family distribution:")
fam_btk = defaultdict(int)
for ent, hits in btk_hits.items():
    fams = sorted({h['family'] for h in hits})
    primary = fams[0] if fams else 'none'
    fam_btk[primary] += 1
for fam, n in sorted(fam_btk.items(), key=lambda x: -x[1]):
    print(f"  {fam:30} {n}")

print("\nEGFR family distribution:")
fam_egfr = defaultdict(int)
for ent, hits in egfr_hits.items():
    fams = sorted({h['family'] for h in hits})
    primary = fams[0] if fams else 'none'
    fam_egfr[primary] += 1
for fam, n in sorted(fam_egfr.items(), key=lambda x: -x[1]):
    print(f"  {fam:30} {n}")

# Print F2 entries by target
print("\nBTK F2 entries:")
for ent, hits in sorted(btk_hits.items()):
    f2 = [h for h in hits if h['family'] == 'F2']
    if f2:
        h = f2[0]
        print(f"  {ent}  lig={h['lig_comp']:6}  res={h.get('resolution')} name={(h.get('lig_chem_name') or '')[:80]}")

print("\nEGFR F2 entries:")
for ent, hits in sorted(egfr_hits.items()):
    f2 = [h for h in hits if h['family'] == 'F2']
    if f2:
        h = f2[0]
        print(f"  {ent}  lig={h['lig_comp']:6}  res={h.get('resolution')} name={(h.get('lig_chem_name') or '')[:80]}")
