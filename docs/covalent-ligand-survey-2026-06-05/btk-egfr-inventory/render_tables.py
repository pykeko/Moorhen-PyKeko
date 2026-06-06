#!/usr/bin/env python3
"""Render the final markdown tables.

Sort order:
  ⭐⭐⭐ F2 canonical (methyl butynamide, e.g. acalabrutinib/tirabrutinib/branebrutinib)
  ⭐⭐⭐ F2-extended (extended-methyl, the user's lab niche; afatinib/neratinib/dacomitinib/mobocertinib/canertinib etc.)
  ⭐⭐ F2-terminal (spebrutinib-class) — F2 special case
  ⭐ F1 acrylamide (medchem-adjacent)
  • F1/F2-ambig (need SMILES to disambiguate)
  · F3 / F4 / F5 / F6 / F7 / metal / unclassified (out of scope, brief note)

Within same tier: by resolution ascending, then by year descending.
"""
import json
from collections import defaultdict

def relevance(e):
    """Return (tier_int, stars, note). Tier int 0 = top."""
    fam = e['family_final']
    chem = (e.get('warhead_chem') or '').lower()
    drug = (e.get('drug_final') or '').lower()
    # F2 canonical
    if fam == 'F2' and 'methyl butynamide' in chem and 'extended' not in chem:
        return (0, '⭐⭐⭐', 'canonical F2 (methyl butynamide)')
    # F2 extended methyl
    if fam in ('F2','F2-extended') and ('extended' in chem or '4-' in chem):
        return (1, '⭐⭐⭐', 'F2 extended-methyl (your lab niche)')
    # Generic F2 (e.g. pre-reaction ethynyl, but-2-enoyl post unknown extension)
    if fam == 'F2':
        return (2, '⭐⭐⭐', 'F2 (ynamide family)')
    # F2-terminal (spebrutinib)
    if fam == 'F2-terminal':
        return (3, '⭐⭐', 'F2 terminal propiolamide (Spebrutinib-class)')
    # F1 acrylamide canonical (named drugs)
    if fam == 'F1':
        return (4, '⭐', 'F1 acrylamide (medchem-adjacent)')
    # F1/F2-ambig
    if fam == 'F1/F2-ambig':
        return (5, '·', 'post-product propanamide; need SMILES to confirm F1 vs F2-terminal')
    # Others
    note_map = {
        'F3': 'F3 (α,β-unsat non-amide)',
        'F4': 'F4 (haloacetamide / SN2)',
        'F5': 'F5 (strained ring)',
        'F6': 'F6 (carbonyl/aldehyde)',
        'F6-imine': 'F6 (imine/formimidoyl)',
        'F7-nitrile': 'F7 (reversible nitrile-Cys)',
        'metal-cofactor': 'metal cofactor (not a warhead)',
        'unclassified': 'unclassified',
    }
    return (6, ' ', note_map.get(fam, fam))

def format_res(r):
    if r is None: return '—'
    if isinstance(r, list): r = r[0] if r else None
    if r is None: return '—'
    try: return f"{float(r):.2f}"
    except: return str(r)

def render_table(target_label, entries):
    rows = []
    for e in entries:
        tier, stars, note = relevance(e)
        # Cys position: from cys_seq (which is label_seq_id, not auth_seq).
        # The user's target is Cys481 (BTK) / Cys797 (EGFR). label_seq_id is
        # 1-based within the polymer entity — not the canonical auth_seq. We
        # report label_seq for honesty and flag known canonical Cys.
        cys = f"Cys{e.get('cys_seq')}" if e.get('cys_seq') else '?'
        ext_note = ''
        if e.get('altloc_or_multi_cys') and e.get('n_distinct_warheads', 1) > 1:
            ext_note = ' (multi-ligand)'
        elif e.get('cys_alt'):
            ext_note = ' (altloc)'
        # Resolution: take first of list if a list
        res = e.get('resolution')
        res_s = format_res(res)
        drug = e.get('drug_final','') or '—'
        chem = e.get('warhead_chem','') or '—'
        # Year
        yr = e.get('release_year','—')
        rows.append({
            'tier': tier,
            'stars': stars,
            'note': note,
            'pdb': e['entry'],
            'year': yr,
            'res_s': res_s,
            'res_f': float(res[0]) if isinstance(res, list) and res else (float(res) if res else 999.0),
            'lig': e['lig_comp'],
            'family': e['family_final'],
            'drug': drug,
            'chem': chem,
            'cys': cys,
            'ext_note': ext_note,
        })
    # Sort by tier ascending, then by resolution ascending, then by year descending
    rows.sort(key=lambda r: (r['tier'], r['res_f'], -int(r['year']) if r['year'] not in ('','—') else 0))
    # Render
    lines = []
    lines.append(f"## {target_label}")
    lines.append("")
    lines.append(f"**{len(rows)} entries** with a Cys-SG → ligand covalent bond < 2.0 Å detected.")
    lines.append("")
    lines.append("| ⭐ | PDB | Year | Res (Å) | Ligand | Family | Drug name (if any) | Warhead chemistry | Cys |")
    lines.append("|---|---|---|---|---|---|---|---|---|")
    for r in rows:
        # Limit drug + chem column widths
        drug = (r['drug'] or '—')[:55]
        chem = (r['chem'] or '—')[:60]
        lines.append(f"| {r['stars']} | {r['pdb']} | {r['year']} | {r['res_s']} | {r['lig']} | {r['family']} | {drug} | {chem} | {r['cys']}{r['ext_note']} |")
    return '\n'.join(lines), rows

def main():
    with open('/tmp/btk-egfr-inventory/BTK_final.json') as f:
        btk = json.load(f)
    with open('/tmp/btk-egfr-inventory/EGFR_final.json') as f:
        egfr = json.load(f)
    btk_md, btk_rows = render_table("BTK (UniProt Q06187 + P35991, Cys481)", btk)
    egfr_md, egfr_rows = render_table("EGFR (UniProt P00533, Cys797)", egfr)
    out = []
    out.append("# BTK + EGFR Cys-S-Covalent PDB Inventory")
    out.append("")
    out.append("Source: 2026-06-06 RCSB Search + Data GraphQL query, intersected with")
    out.append("Cys-SG ↔ non-S < 2.0 Å covalent-bond filter (same as the 2026-06-05")
    out.append("survey at `~/Moorhen/docs/covalent-ligand-survey-2026-06-05/`).")
    out.append("")
    out.append("Family classification per `analyze_warheads.py` + a hand-curated drug")
    out.append("dictionary (acalabrutinib/tirabrutinib/branebrutinib for F2 canonical;")
    out.append("afatinib/neratinib/dacomitinib/mobocertinib/canertinib for F2 extended-")
    out.append("methyl; ibrutinib/zanubrutinib/osimertinib/oritinib/alflutinib for F1).")
    out.append("")
    out.append("Relevance stars:")
    out.append("- ⭐⭐⭐ F2 canonical or F2 extended-methyl (the user's lab niche)")
    out.append("- ⭐⭐ F2 terminal-propiolamide (Spebrutinib-class)")
    out.append("- ⭐ F1 acrylamide (medchem-adjacent, ibrutinib/osimertinib class)")
    out.append("- · F1/F2-ambig — saturated post-Michael propanamide; need SMILES")
    out.append("- (blank) F3 / F4 / F5 / F6 / F7 / metal / unclassified (out of scope)")
    out.append("")
    out.append(btk_md)
    out.append("")
    out.append(egfr_md)
    md = '\n'.join(out)
    with open('/tmp/btk-egfr-inventory/inventory.md', 'w') as f:
        f.write(md)
    print(md[:500] + '\n...')
    print(f"\nFull table at /tmp/btk-egfr-inventory/inventory.md ({len(md)} chars)")
    return btk_rows, egfr_rows

if __name__ == "__main__":
    main()
