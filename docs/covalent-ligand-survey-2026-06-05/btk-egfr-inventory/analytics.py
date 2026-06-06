import json
from collections import Counter, defaultdict

with open('/tmp/btk-egfr-inventory/BTK_final.json') as f:
    btk = json.load(f)
with open('/tmp/btk-egfr-inventory/EGFR_final.json') as f:
    egfr = json.load(f)

def buckets(rows):
    f2_canon = [r for r in rows if r['family_final']=='F2' and 'methyl butynamide' in (r.get('warhead_chem') or '').lower() and 'extended' not in (r.get('warhead_chem') or '').lower()]
    f2_ext = [r for r in rows if r['family_final'] in ('F2','F2-extended') and ('extended' in (r.get('warhead_chem') or '').lower() or '4-' in (r.get('warhead_chem') or '').lower())]
    f2_other = [r for r in rows if r['family_final']=='F2' and r not in f2_canon and r not in f2_ext]
    f2_term = [r for r in rows if r['family_final']=='F2-terminal']
    f1 = [r for r in rows if r['family_final']=='F1']
    ambig = [r for r in rows if r['family_final']=='F1/F2-ambig']
    f3 = [r for r in rows if r['family_final']=='F3']
    f4 = [r for r in rows if r['family_final']=='F4']
    f5 = [r for r in rows if r['family_final']=='F5']
    f6 = [r for r in rows if r['family_final'].startswith('F6')]
    f7 = [r for r in rows if r['family_final'].startswith('F7')]
    metal = [r for r in rows if r['family_final']=='metal-cofactor']
    unc = [r for r in rows if r['family_final']=='unclassified']
    return {
        'F2-canonical': f2_canon,
        'F2-extended': f2_ext,
        'F2-other': f2_other,
        'F2-terminal': f2_term,
        'F1': f1,
        'F1/F2-ambig': ambig,
        'F3': f3, 'F4': f4, 'F5': f5, 'F6': f6, 'F7': f7,
        'metal': metal, 'unclassified': unc,
    }

bt = buckets(btk)
et = buckets(egfr)
print("=== HEADLINE ===")
print(f"BTK Cys-SG covalent entries:  {len(btk)} (UniProt Q06187 + P35991 union)")
print(f"EGFR Cys-SG covalent entries: {len(egfr)} (UniProt P00533)")
print()
for name in ('F2-canonical','F2-extended','F2-other','F2-terminal','F1','F1/F2-ambig','F3','F4','F5','F6','F7','metal','unclassified'):
    print(f"  {name:18}  BTK {len(bt[name]):3}  EGFR {len(et[name]):3}")

print("\n=== HIGHEST-PRIORITY SUBSET (F2 canonical + F2-extended, all resolutions) ===")
top = bt['F2-canonical'] + bt['F2-extended'] + bt['F2-other'] + et['F2-canonical'] + et['F2-extended'] + et['F2-other']
def res_of(r):
    rr = r.get('resolution')
    if isinstance(rr, list): rr = rr[0] if rr else None
    try: return float(rr) if rr is not None else 999.0
    except: return 999.0
top.sort(key=res_of)
for r in top:
    rrr = res_of(r)
    print(f"  {r['entry']:6} {r['lig_comp']:8} {r['family_final']:14} res={rrr:.2f} {r['drug_final'][:40]:40} {r.get('warhead_chem','')[:40]}")

print("\n=== EDGE CASES ===")
print("\nMulti-warhead / altloc:")
for rows, name in [(btk,'BTK'),(egfr,'EGFR')]:
    for r in rows:
        if r.get('n_distinct_warheads',1) > 1 or r.get('altloc_or_multi_cys'):
            note = []
            if r.get('n_distinct_warheads',1) > 1:
                note.append(f"{r.get('n_distinct_warheads')} distinct warheads ({','.join(r.get('all_lig_comps') or [])})")
            if r.get('cys_alt'):
                note.append(f"altloc={r['cys_alt']}")
            print(f"  {name} {r['entry']:6} {r['lig_comp']:8} {r['family_final']:14} {'; '.join(note)}")

# Metal "BTK" entries - actually PH domain + Zn, not kinase Cys
print("\nMetal-cofactor BTK entries (these are Zn-binding to PH domain, NOT Cys-warhead):")
for r in bt['metal']:
    print(f"  {r['entry']:6} {r['lig_comp']:8} title={r['title'][:90]}")
