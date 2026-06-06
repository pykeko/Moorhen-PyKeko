# BTK + EGFR Cys-covalent PDB inventory

RCSB-wide inventory of covalent-ligand structures bound to BTK (UniProt
Q06187 human + P35991 mouse) and EGFR (UniProt P00533 human), classified
by the F1–F6 warhead-family taxonomy in
[`../../covalent-ligand-plan.md`](../../covalent-ligand-plan.md) §2.0.

## Headline

- **BTK**: 32 Cys-SG-covalent entries (4 F2 canonical methyl-butynamide,
  1 F2 extended-methyl, 3 F1 acrylamide, 16 F1/F2-ambig, plus edges).
- **EGFR**: 120 Cys-SG-covalent entries (0 F2 canonical, **22 F2
  extended-methyl** — the user's lab niche, plus 30 F1 acrylamide and
  65 F1/F2-ambig).
- **Combined F2 (canonical + extended-methyl)**: **27 entries** —
  this is the validation universe for the F2 link template.

## Recommended first-10 re-refinement set (PyKeko validation)

Diverse coverage of F2 chemistries, resolutions, and scaffolds — see
[`inventory.md`](inventory.md) for the full table.

| # | PDB | Res (Å) | Lig | Notes |
|---|---|---|---|---|
| 1 | 8FD9 | 1.70 | XQQ | Acalabrutinib + BTK — the τ = −89° outlier (drives the dihedral revision) |
| 2 | 8FF0 | 2.60 | 7GB | Tirabrutinib + BTK — well-behaved τ ≈ +1° syn-addition |
| 3 | 5P9M | 1.41 | 7GB | Tirabrutinib + BTK at high res — cross-validates on different lattice |
| 4 | 6O8I | 1.42 | LTJ | Branebrutinib + BTK — third methyl-butynamide drug |
| 5 | 9GL8 | 1.63 | A1IMT | EGFR olafertinib-class extended-methyl (best-resolved 4-NMe₂-but-2-en) |
| 6 | 9DF4 | 1.78 | A1A4E | EGFR 3rd-gen extended-methyl, different scaffold |
| 7 | 4I24 | 1.80 | 1C9 | EGFR + 4-piperidinyl-but-2-enamide (canertinib variant) |
| 8 | 9FQS | 1.78 | A1IE0 | EGFR + pre-reaction ethynyl deposit — tests F2-pre → F2-post chemMod path |
| 9 | 7JXP | 2.16 | YY3 | Dacomitinib + EGFR (YY3 appears 7× in PDB) |
| 10 | 3W2Q | 2.20 | HKI | Neratinib + EGFR (4-NMe₂-but-2-en, lock-in for that sub-family) |

11th if you want a PROTAC test case: **8DSO** (TOO, 2.33 Å) — the only
BTK F2 extended-methyl PROTAC.

## Methodology

1. RCSB Search API queried for entries linked to each UniProt accession
   with the `LIGAND_COVALENT_LINKAGE` feature flag.
2. RCSB Data GraphQL fetched `_struct_conn` + chem_comp.name + resolution
   + deposition year per entry.
3. Filtered to Cys-SG ↔ non-S < 2.0 Å (same predicate as the parent
   2026-06-05 survey).
4. Classified via `classify.py` regex set + hand-curated drug dictionary
   + IUPAC-name patterns for post-Michael products.

The F1/F2-ambig category (16 BTK + 65 EGFR) is the open question: names
like "1-propanoylpiperidin-4-yl" / "propanamide" are saturated post-Michael
products that could be acrylamide → propanamide (F1) or terminal
propiolamide → propanoyl (F2-terminal). Without each ligand's full SMILES
+ chem_comp_bond table, regex on names alone undercounts. A second pass
using RDKit on the CCD CIFs would resolve.

## Edge cases worth flagging (see inventory.md for full discussion)

1. **8FD9 / 8FF0 / 8X2A use UniProt P35991 (mouse BTK), not Q06187
   (human).** The construct Cys87 in 8FD9 = mouse Cys481. Verify auth_seq_id
   before quoting "Cys481" in publication.
2. **Spebrutinib 5KUP** is F2-terminal-propiolamide but **has no
   `_struct_conn covale` row** — the only known F2-terminal in PDB and it
   slipped through this query.
3. **Construct-numbering vs canonical Cys numbering** — BTK canonical
   Cys481 = construct Cys87; EGFR canonical Cys797 = construct Cys104/106/108
   depending on N-terminal trim.
4. **Multi-warhead / altloc** — ~10 BTK + ~30 EGFR entries flag at least
   one altloc=A/B or multi-warhead-distinct-comp. Notable: **6DI9 GJJ**
   has altloc=B on the bound thioether — re-refinement test case for the
   link CIF's altloc handling.
5. **5-char chem_comp codes** (A1IMT, A1A4E, A1IE0, etc.) are increasingly
   common in 2024-26 deposits and **cannot travel via PDB `LINK` records**
   (3-char limit) — mmCIF `_struct_conn` only.

## Files

- `inventory.md` — full markdown inventory (per-entry tables, classification)
- `BTK_per_entry.json`, `EGFR_per_entry.json` — per-entry rolled-up classifications
- `BTK_final.json`, `EGFR_final.json` — final analysis output
- `BTK_classified.jsonl`, `EGFR_classified.jsonl` — per-hit lines
  (one row per Cys-SG bond, before per-entry collapse)
- `BTK_all_ids.json`, `EGFR_all_ids.json` — input PDB ID lists from
  the RCSB Search API
- `*.py` — the reproducing pipeline (query, classify, render, analytics)

Reproducing: `query_rcsb.py` → `fetch_entries.py` → `classify.py` →
`render_tables.py`. ~5 min wallclock at API limits.
