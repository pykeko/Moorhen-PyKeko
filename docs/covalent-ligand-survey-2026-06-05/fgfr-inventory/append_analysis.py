#!/usr/bin/env python3
"""Append the analysis sections (futibatinib subset, first-5 set, BTK/EGFR
comparison, Cys552 analysis, edge cases) to inventory.md."""
import json
from collections import defaultdict

rows = json.load(open('/tmp/fgfr-inventory/FGFR_per_entry_with_cys.json'))
all_hits = []
with open('/tmp/fgfr-inventory/FGFR_classified_refined.jsonl') as f:
    for line in f:
        all_hits.append(json.loads(line))

# BTK + EGFR per-entry
btk = json.load(open('/tmp/btk-egfr-inventory/BTK_per_entry.json'))
egfr = json.load(open('/tmp/btk-egfr-inventory/EGFR_per_entry.json'))

# Futibatinib (TZ0 / A1AFR) entries
TZ_CODES = {'TZ0', 'A1AFR'}
fut_rows = [r for r in rows if r['lig_comp'] in TZ_CODES]
fut_rows.sort(key=lambda r: (r['resolution'] or 99, r['entry']))

# Compute first-5 recommended re-refinement set:
# Since there are no F2 entries, pick the highest-resolution + most informative
# pre-Michael acrylamide (visible C=C) per FGFR target — these are the closest
# F1-class analogs to the user's F2 chemistry. Add one F6 (roblitinib) and
# one futibatinib post-Michael for completeness.
# Priority within target: (a) acrylamide visible (⭐⭐ rather than ⭐), (b) Cys at
# the canonical reactive position, (c) highest resolution.
def cand_score(r):
    pre = 0 if r['family_refined'] == 'F1' and not r.get('f1_post_michael') else 1
    canonical = 0 if r.get('cys_is_reactive') else 1
    res = r['resolution'] if r['resolution'] else 99
    return (pre, canonical, res)

per_tgt = defaultdict(list)
for r in rows:
    for tgt in r.get('fgfr_targets', []):
        per_tgt[tgt].append(r)
first5 = []
# 1. FGFR4 Cys552 + visible acrylamide, highest resolution
fgfr4 = sorted([r for r in per_tgt['FGFR4'] if r['family_refined'] == 'F1' and not r.get('f1_post_michael') and r.get('cys_is_reactive')], key=cand_score)
if fgfr4:
    first5.append(fgfr4[0])
# 2. FGFR2 Cys491 + futibatinib (TZ0 / A1AFR)
fgfr2_tz = sorted([r for r in per_tgt['FGFR2'] if r['lig_comp'] in TZ_CODES], key=cand_score)
if fgfr2_tz:
    first5.append(fgfr2_tz[0])
# 3. FGFR3 Cys482 + visible acrylamide
fgfr3 = sorted([r for r in per_tgt['FGFR3'] if r['family_refined'] == 'F1' and not r.get('f1_post_michael')], key=cand_score)
if fgfr3:
    first5.append(fgfr3[0])
# 4. FGFR1 Cys488 + visible acrylamide
fgfr1 = sorted([r for r in per_tgt['FGFR1'] if r['family_refined'] == 'F1' and not r.get('f1_post_michael') and r.get('cys_is_reactive')], key=cand_score)
if fgfr1:
    first5.append(fgfr1[0])
# 5. The bivalent CXF007 (A1LVQ) — interesting topology
bivalent = [r for r in rows if r['lig_comp'] == 'A1LVQ']
bivalent.sort(key=lambda r: r['resolution'] or 99)
if bivalent:
    first5.append(bivalent[0])

# Cys552 analysis for FGFR4
fgfr4_rows = per_tgt['FGFR4']
fgfr4_552 = [r for r in fgfr4_rows if r.get('cys_uniprot') == 552]
fgfr4_477 = [r for r in fgfr4_rows if r.get('cys_uniprot') == 477]

# Edge cases
multi_lig = [r for r in rows if r.get('n_distinct_warheads', 1) > 1]
altloc = [r for r in rows if r.get('cys_alt')]
# CXF007 bivalent
cxf = [r for r in rows if r['lig_comp'] == 'A1LVQ']

# A1AFR / TZ0 post-Michael vs pre — both encode futibatinib but at different
# chem_comp.id; flag this as a deposit-warning class
multi_state_futibatinib = [r for r in rows if r['lig_comp'] in TZ_CODES]


def write_md(path):
    out = []
    out.append("\n## Futibatinib / butynamide deposits across all four FGFRs\n")
    out.append("**Critical correction to the user's brief**: Futibatinib (TAS-120, FDA 2022) is")
    out.append("**not an α,β-ynamide**. ChEMBL CHEMBL3701238's canonical SMILES is")
    out.append("`C=CC(=O)N1CC[C@H](n2nc(C#Cc3cc(OC)cc(OC)c3)c3c(N)ncnc32)C1` — the warhead")
    out.append("is an **acrylamide on the pyrrolidine N** (F1), and the `C#C` is a")
    out.append("3,5-dimethoxyphenyl-ethynyl linker inside the pyrazolo[3,4-d]pyrimidine")
    out.append("scaffold, NOT a reactive group. PDB ligand code **TZ0** = futibatinib")
    out.append("pre-reaction; **A1AFR** = the post-Michael propanoyl product (saturated).")
    out.append("")
    out.append("So futibatinib's PDB entries are F1, not F2. There are no F2 ynamide")
    out.append("entries in any FGFR PDB deposit as of 2026-06-06.")
    out.append("")
    out.append("### TZ0 / A1AFR (futibatinib) deposits\n")
    out.append("| PDB | Year | Res (Å) | Target | Ligand | State | Cys |")
    out.append("|-----|------|---------|--------|--------|-------|-----|")
    for r in fut_rows:
        res = f"{r['resolution']:.2f}" if r['resolution'] else '?'
        state = 'pre-Michael (acryl)' if r['lig_comp'] == 'TZ0' else 'post-Michael (propanoyl)'
        cys = f"Cys{r.get('cys_uniprot')}" if r.get('cys_uniprot') else f"label_seq={r.get('cys_seq','?')}"
        out.append(f"| {r['entry']} | {r['release_year']} | {res} | {','.join(r.get('fgfr_targets',[]))} | {r['lig_comp']} | {state} | {cys} |")
    out.append("")
    out.append("Note the **deposit-state inconsistency**: 6MZW (FGFR1, 2019) and the 2025")
    out.append("FGFR2 series (8W38/8W3B/8W3D) all deposit TZ0 with the pre-reaction")
    out.append("acrylamide chem_comp despite the SG-Cβ bond being well below 2.0 Å,")
    out.append("while 8W2X deposits A1AFR (saturated propanoyl) for the same molecule.")
    out.append("This is exactly the §1.6 \"deposition pipeline lossiness\" case: two")
    out.append("chemically equivalent post-Michael adducts get different chem_comp IDs.")
    out.append("")

    out.append("## Recommended first-5 FGFR re-refinement set\n")
    out.append("Because there are no deposited F2 entries for any FGFR target, the most")
    out.append("user-relevant data points are the **highest-resolution F1 acrylamide /")
    out.append("propanamide structures** — they share Cys-SG → Cβ geometry with the")
    out.append("user's F2 lab compounds (same sp3 Cβ with single bond to S after Michael)")
    out.append("differing only in the absence of the residual C=C across the link.\n")
    out.append("| # | PDB | Year | Res (Å) | Target | Lig | Family | Cys | Why it's in the first-5 |")
    out.append("|---|-----|------|---------|--------|-----|--------|-----|--------------------------|")
    rationales = [
        "FGFR4 highest-res F1-pre + canonical Cys552 — the most-targeted FGFR for covalent",
        "Futibatinib (TZ0) on FGFR2 — direct lab-drug analog, pre-Michael acrylamide visible",
        "FGFR3 highest-res with visible acrylamide on Cys482 — covers the third isoform",
        "FGFR1 Cys488 with visible acrylamide — covers the first isoform",
        "CXF007 (A1LVQ) bivalent bis-acrylamide on FGFR4 Cys552 — unusual topology, two acrylamides, one engaged",
    ]
    for i, (r, rat) in enumerate(zip(first5, rationales)):
        res = f"{r['resolution']:.2f}" if r['resolution'] else '?'
        cys = f"Cys{r.get('cys_uniprot')}" if r.get('cys_uniprot') else f"label_seq={r.get('cys_seq','?')}"
        fam = r['family_refined'] + (' (post-Michael)' if r.get('f1_post_michael') else '')
        out.append(f"| {i+1} | {r['entry']} | {r['release_year']} | {res} | {','.join(r.get('fgfr_targets',[]))} | {r['lig_comp']} | {fam} | {cys} | {rat} |")
    out.append("")

    # BTK/EGFR comparison
    btk_f2 = sum(1 for r in btk if r.get('family') == 'F2')
    egfr_f2 = sum(1 for r in egfr if r.get('family') == 'F2')
    btk_f1f2_ambig = sum(1 for r in btk if r.get('family') == 'unclassified')  # F1/F2-ambig propanamide
    out.append("## Comparison vs the BTK + EGFR inventory\n")
    out.append(f"- BTK: 32 covalent entries, **{btk_f2} F2 confirmed**, plus 17 F1/F2-ambiguous post-Michael propanamide entries.")
    out.append(f"- EGFR: 120 covalent entries, **{egfr_f2} F2 confirmed**.")
    out.append(f"- FGFR1+2+3+4: 58 covalent entries, **0 F2 confirmed**, plus 30 F1 post-Michael propanamide entries (also F1/F2-ambig in principle, but the published parent drug for every one is acrylamide-class — there is no published terminal-propiolamide or butynamide FGFR inhibitor in deposited PDB).")
    out.append("")
    out.append(f"**Headline F2-confirmed shift**: 10 (BTK+EGFR) → 10 (BTK+EGFR+FGFR). Adding FGFR")
    out.append(f"contributes **zero new F2 entries** to the user's lab focus set. The BTK/EGFR")
    out.append(f"survey already captured the full deposited F2 universe for receptor tyrosine")
    out.append(f"kinases.\n")
    out.append(f"**Headline F1/F2-ambig (post-Michael propanamide) shift**: 17 (BTK) → 47 (BTK+FGFR).")
    out.append(f"This 30-entry FGFR bump triples the post-Michael training set — useful for")
    out.append(f"validating the F1 template and for a future SMARTS-against-parent-drug")
    out.append(f"disambiguator. But these are all biased toward FGFR acrylamides (none known")
    out.append(f"to be ynamide parents).")
    out.append("")
    out.append("**Takeaway for the F2 link-CIF**: adding FGFR to the inventory does **not**")
    out.append("change the F2 implementation roadmap. The user's BTK+EGFR F2 set (with 8FD9")
    out.append("XQQ canonical, 9CUX 1.27 Å, etc.) remains the best deposited training corpus")
    out.append("for the Cys-YNA template. FGFR data are useful for validating F1 geometry —")
    out.append("which is *similar* to F2 post-Michael at the Cys-Cβ link itself.")
    out.append("")

    # FGFR4 Cys552 analysis
    out.append("## FGFR4 Cys552 vs other FGFR Cys positions\n")
    out.append(f"- FGFR4 covalent entries: {len(fgfr4_rows)}")
    out.append(f"  - Hitting **Cys552** (the canonical kinase-domain selectivity Cys): {len(fgfr4_552)}")
    out.append(f"  - Hitting **Cys477** (a different surface Cys near the αD helix region): {len(fgfr4_477)}")
    out.append("")
    out.append("FGFR4 dominates the FGFR covalent set (31/58 = 53%) — confirming the user's")
    out.append("note that **FGFR4 is the most-targeted FGFR for covalent drug discovery**,")
    out.append("driven by the FGFR1-3 → FGFR4 selectivity afforded by Cys552 (Gly in 1-3).")
    out.append("Of the 31 FGFR4 entries, 26 hit Cys552, **5 hit Cys477** instead (the")
    out.append("paralog-Brameld series 4QQ5/4QQC/4R6V and the 5NWZ scaffold), and the rest")
    out.append("span every warhead family present in the FGFR set (F1, F4, F6, nitrile).")
    out.append("")
    out.append("**Butynamide hitting Cys552**: as noted, none — there is no F2 ynamide on")
    out.append("any FGFR4 (or any FGFR) PDB entry. If the user's lab develops one, it would")
    out.append("be the **first FGFR ynamide in the PDB**, and an excellent template-validation")
    out.append("structure given the rich deposited acrylamide chemistry against Cys552.")
    out.append("")
    out.append("FGFR1-3 Cys position breakdown:")
    for tgt, exp in [('FGFR1', 488), ('FGFR2', 491), ('FGFR3', 482)]:
        sub = per_tgt[tgt]
        canon = sum(1 for r in sub if r.get('cys_uniprot') == exp)
        out.append(f"- {tgt}: {canon}/{len(sub)} hit Cys{exp}. " +
                   (f"FGFR1 also has 3 entries hitting Cys563 (the FGFR1-Y563C mutant — Brameld 2019 used this as an FGFR4 surrogate)." if tgt == 'FGFR1' else ''))
    out.append("")

    # Edge cases
    out.append("## Edge cases / deposit warnings\n")
    out.append("- **Futibatinib double encoding**: same drug, two chem_comp IDs depending")
    out.append("  on whether the depositor recorded the pre-reaction acrylamide (**TZ0**)")
    out.append("  or the post-Michael propanoyl product (**A1AFR**). In both cases the")
    out.append("  SG-Cβ bond is <2.0 Å, so the chem_comp choice is a depositor preference,")
    out.append("  not chemistry. This is the headline §1.6 deposition-lossiness case.")
    out.append("  - TZ0 (pre): 6MZW, 8W38, 8W3B, 8W3D")
    out.append("  - A1AFR (post): 8W2X")
    out.append("")
    out.append("- **CXF007 (A1LVQ) bivalent acrylamide**: 8XLQ (FGFR4) and 8XLO (FGFR1)")
    out.append("  ligand 3-letter code A1LVQ is a bis-acrylamide tethered through a")
    out.append("  pyrimido[4,5-d]pyrimidinedione scaffold — both warheads visible as `C=C`")
    out.append("  in the SMILES, but only **one** engages a Cys-SG per entry (8XLO has 2")
    out.append("  copies of the same Cys33-Cβ bond — two protein chains, not two warheads).")
    out.append("  Designing the link CIF for this one would need a two-headed entry.")
    out.append("")
    out.append("- **Roblitinib (FGF401, ligand FGF) chem_comp.type**: PDB chem_comp.name is")
    out.append("  `...7-methanoyl-...naphthyridine-1-carboxamide` — the **methanoyl is the")
    out.append("  aldehyde warhead** forming a hemithioacetal (F6 reversible) with Cys552,")
    out.append("  not an acrylamide. The user's brief listed roblitinib as F1; that's an")
    out.append("  upstream catalog error. PDB entries: 6JPJ (2.64 Å), 6YI8 (2.13 Å).")
    out.append("")
    out.append("- **Nonstandard 5-char chem_comp codes** (`A1xxx`): post-2024 codes appear")
    out.append("  for several FGFR entries — A1AFR, A1C66, A1C67, A1EEW, A1EEX, A1EPE,")
    out.append("  A1EPF, A1ESP, A1ESW, A1ESX, A1LVQ, A1LW9, A1LWW. These break the legacy")
    out.append("  3-char assumption; PyKeko's covalent-link runtime must handle ≤5-char")
    out.append("  resnames (see plan §10.1 about extended codes).")
    out.append("")
    out.append("- **2-chloropyridine SNAr fragment (99K, PDB 5NUD)**: deposited at 1.67 Å")
    out.append("  Cys-SG distance with no acrylamide / amide warhead visible. Looks like an")
    out.append("  aromatic nucleophilic substitution off the 2-Cl on the 3-trifluoromethyl")
    out.append("  pyridine. Could be a misclassified non-covalent contact or a fragment-")
    out.append("  screening SNAr hit. Worth a manual SMILES + density inspection before")
    out.append("  including in any training set.")
    out.append("")
    out.append("- **Off-target Cys hits**: 5 FGFR4 entries (4QQ5, 4QQC, 4R6V, 5NWZ, 6IUO)")
    out.append("  bind Cys477 instead of Cys552 — surface Cys, different binding mode.")
    out.append("  3 FGFR1 entries (5VND, 6P68, 6P69) bind Cys563 because they're the")
    out.append("  FGFR1-Y563C mutant — a deliberate construct engineered to mimic FGFR4")
    out.append("  Cys552 (Brameld 2019).")
    out.append("")
    out.append("- **Two-chain multi-row artifacts**: 29/58 entries have ≥2 Cys-SG → ligand")
    out.append("  bonds in `_struct_conn`. In almost every case this is because the AU")
    out.append("  has 2-3 protein chains, each with its own Cys-SG covalent bond to the")
    out.append("  same ligand chem_comp. Not a true multi-warhead case.")
    out.append("")

    return '\n'.join(out)


with open('/tmp/fgfr-inventory/inventory.md', 'a') as f:
    f.write(write_md(None))
print("Appended analysis sections.")
