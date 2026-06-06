#!/usr/bin/env python3
"""Render the final FGFR inventory markdown."""
import json
from collections import defaultdict

ROWS = json.load(open('/tmp/fgfr-inventory/FGFR_per_entry_with_cys.json'))

# Sort priority within a target:
#   ⭐⭐⭐ F2 entries (none for FGFR)
#   ⭐⭐ F1 pre-Michael acrylamide (canonical, name has prop-2-en-1-one / prop-2-enamide)
#   ⭐ F1 post-Michael propanamide (deposited saturated, F1/F2-ambig)
#   · F4, F6, Nitrile-reversible (other warhead families)

def stars(row):
    fam = row['family_refined']
    if fam == 'F2':
        return '⭐⭐⭐'
    if fam == 'F1':
        # canonical pre-Michael acrylamide form gets ⭐⭐
        if not row.get('f1_post_michael'):
            return '⭐⭐'
        return '⭐'  # post-Michael propanamide (F1/F2-ambig)
    return '·'

def cys_str(row):
    cp = row.get('cys_uniprot')
    if cp is None:
        return f"label_seq={row.get('cys_seq', '?')}"
    s = f"Cys{cp}"
    if not row.get('cys_is_reactive'):
        s += ' (off-target)'
    if row.get('cys_alt'):
        s += f" alt={row['cys_alt']}"
    return s

def render_table(rows, label):
    # Sort: stars then resolution then year
    star_rank = {'⭐⭐⭐': 0, '⭐⭐': 1, '⭐': 2, '·': 3}
    rows = sorted(rows, key=lambda r: (star_rank[stars(r)],
                                       r['resolution'] if r['resolution'] is not None else 99.0,
                                       -int(r['release_year']) if r['release_year'] else 0))
    out = []
    out.append(f"## {label} — {len(rows)} covalent entries\n")
    out.append("| ⭐ | PDB | Year | Res (Å) | Ligand | Drug / class | Family | Cys | Notes |")
    out.append("|---|-----|------|---------|--------|--------------|--------|-----|-------|")
    for r in rows:
        s = stars(r)
        res = f"{r['resolution']:.2f}" if r['resolution'] is not None else '?'
        lig = r['lig_comp']
        drug = r.get('drug_name_refined', '') or ''
        fam = r['family_refined']
        if r.get('f1_post_michael'):
            fam = 'F1 (post-Michael)'
        if r.get('f2_extended_methyl'):
            fam = 'F2-extended'
        if r.get('f2_terminal_propiolamide'):
            fam += '/term-propiolamide'
        cys = cys_str(r)
        # Build notes: title fragment + altloc + multiple warheads
        notes = []
        if r.get('n_distinct_warheads', 1) > 1:
            notes.append(f"multi-lig:{','.join(r.get('all_lig_comps', []))}")
        if r.get('altloc_or_multi_cys') and r.get('cys_alt'):
            notes.append(f"altloc {r['cys_alt']}")
        ttl = (r.get('title') or '').replace('|', ',')[:60]
        notes.append(ttl)
        notes_str = '; '.join(n for n in notes if n)
        out.append(f"| {s} | {r['entry']} | {r['release_year']} | {res} | {lig} | {drug} | {fam} | {cys} | {notes_str} |")
    return '\n'.join(out) + '\n'


def main():
    lines = []
    lines.append("# FGFR1/2/3/4 Cys-S covalent ligand inventory")
    lines.append("")
    lines.append("Generated 2026-06-06 from RCSB Search + Data GraphQL APIs.")
    lines.append("Selection: any PDB entry whose polymer is mapped to UniProt P11362 (FGFR1),")
    lines.append("P21802 (FGFR2), P22607 (FGFR3), or P22455 (FGFR4) — plus the four mouse")
    lines.append("orthologs — *and* whose `_struct_conn` carries a Cys-SG → ligand-atom bond at")
    lines.append("distance < 2.0 Å.")
    lines.append("")
    lines.append("Family taxonomy mirrors `~/Moorhen/docs/covalent-ligand-plan.md`:")
    lines.append("")
    lines.append("- **F1** = α,β-unsaturated amide (acrylamide-style); 'pre' = deposited as")
    lines.append("  prop-2-enamide/prop-2-en-1-one (visible C=C), 'post-Michael' = deposited")
    lines.append("  as saturated propanamide / propanoyl (C=C → C-C, S adduct on Cβ).")
    lines.append("- **F2** = α,β-ynamide (butynamide / pent/hex-2-ynamide / terminal propynamide)")
    lines.append("  — the user's lab focus.")
    lines.append("- **F4** = activated CH₂-X / SNAr (Sn2 / aromatic Cl displacement).")
    lines.append("- **F6** = reversible carbonyl (aldehyde, trifluoromethyl ketone, α-ketoamide).")
    lines.append("- **Nitrile-reversible** = thiohemiamidate adduct off a benzonitrile.")
    lines.append("")
    lines.append("⭐⭐⭐ = F2 (canonical butynamide / ynamide). ⭐⭐ = F1 deposited pre-Michael")
    lines.append("(acrylamide visible). ⭐ = F1 deposited post-Michael (saturated propanamide;")
    lines.append("F1/F2-ambig without SMILES of parent compound). · = other warhead families.")
    lines.append("")

    # Headline numbers
    fam_counts = defaultdict(int)
    f1_pre = 0
    f1_post = 0
    f2_n = 0
    by_tgt = defaultdict(list)
    for r in ROWS:
        fam_counts[r['family_refined']] += 1
        if r['family_refined'] == 'F2':
            f2_n += 1
        if r['family_refined'] == 'F1':
            if r.get('f1_post_michael'):
                f1_post += 1
            else:
                f1_pre += 1
        for tgt in r.get('fgfr_targets', []):
            by_tgt[tgt].append(r)

    lines.append("## Headline numbers")
    lines.append("")
    lines.append(f"- **Total FGFR Cys-covalent entries: {len(ROWS)}**")
    lines.append(f"- F1 (acrylamide-class): **{fam_counts['F1']}** ({f1_pre} pre-Michael acrylamide visible; {f1_post} post-Michael saturated propanamide)")
    lines.append(f"- F2 (ynamide-class): **0** — no butynamide/ynamide is deposited covalently to any of the four FGFRs")
    lines.append(f"- F4 (SNAr / Sn2): {fam_counts['F4']}")
    lines.append(f"- F6 (reversible carbonyl): {fam_counts['F6']}")
    lines.append(f"- Nitrile-reversible: {fam_counts['Nitrile-reversible']}")
    lines.append("")
    lines.append("### Per-target headline")
    lines.append("")
    lines.append("| Target | Total Cys-cov | F1 pre | F1 post | F2 | F4 | F6 | Nitrile | UniProt |")
    lines.append("|--------|---------------|--------|---------|----|----|----|---------|---------|")
    UP = {'FGFR1': 'P11362', 'FGFR2': 'P21802', 'FGFR3': 'P22607', 'FGFR4': 'P22455'}
    for tgt in ('FGFR1', 'FGFR2', 'FGFR3', 'FGFR4'):
        rs = by_tgt[tgt]
        c = defaultdict(int)
        cpre = 0
        cpost = 0
        for r in rs:
            c[r['family_refined']] += 1
            if r['family_refined'] == 'F1':
                if r.get('f1_post_michael'):
                    cpost += 1
                else:
                    cpre += 1
        lines.append(f"| {tgt} | {len(rs)} | {cpre} | {cpost} | {c['F2']} | {c['F4']} | {c['F6']} | {c['Nitrile-reversible']} | {UP[tgt]} |")
    lines.append("")

    # Per-target tables
    for tgt in ('FGFR1', 'FGFR2', 'FGFR3', 'FGFR4'):
        lines.append(render_table(by_tgt[tgt], tgt))

    # Combined
    lines.append(render_table(ROWS, "All FGFR combined (dedup)"))

    # Save
    out_path = '/tmp/fgfr-inventory/inventory.md'
    with open(out_path, 'w') as f:
        f.write('\n'.join(lines))
    print(f"Wrote {out_path}")


if __name__ == '__main__':
    main()
