# Cys-SG ↔ non-S sub-2.0 Å RCSB survey (2026-06-05)

Empirical survey of the entire RCSB PDB for cysteine residues whose side-chain
sulfur is within 2.0 Å of a non-sulfur atom on a different residue. Run in
support of the covalent-ligand workflow plan at
[`../covalent-ligand-plan.md`](../covalent-ligand-plan.md).

The 2.0 Å threshold reliably identifies covalent bonds: normal van der Waals
contacts are > 2.8 Å; covalent S–C is ~1.82 Å; S–N ~1.74 Å; S–B ~1.93 Å.
Disulfide-style S↔S contacts are explicitly excluded by the "not another
sulfur" filter — the survey targets the Cys-covalent inhibitor + PTM universe.

## Headline numbers

- **Entries with ≥1 such contact: 4,958** (out of 23,976 entries flagged by
  RCSB's `LIGAND_COVALENT_LINKAGE` pre-aggregation)
- **Total contacts: 20,068**
- 99.3% carry a proper `_struct_conn covale` row; 0.7% are metal coord
- **62% of contacts are natural cofactors** (heme C, phycobilins, FAD/FMN 8α-Cys,
  S-acyl lipids, Fe-S clusters); only ~7,400 are drug-warhead-like
- **4,958 is a LOWER BOUND** — Spebrutinib (5KUP) + all bortezomib boronate
  warheads have S-X < 2 Å contacts but no `covale` annotation, so they slip
  through this query. True Cys-covalent universe ≈ 6,000–8,000 entries.

Full analysis is in [`../covalent-ligand-plan.md` §2.0](../covalent-ligand-plan.md).

## What's here (in-repo, ~20 MB)

| File | Purpose | Format |
|---|---|---|
| `analyze.py` | Top-level analysis script: counts entries, classifies hits | Python 3, no external deps |
| `analyze_warheads.py` | Warhead-family classifier (F1–F6 + cofactor + PTM buckets) | Python 3 |
| `geom_f2.py` | Per-entry F2 (α,β-ynamide) geometry: d(SG–Cβ), d(Cα=Cβ), τ | Python 3, expects mmCIFs locally |
| `hits.jsonl` | 20,068 filtered hit records | JSON Lines |
| `hits_classified.jsonl` | Same hits with `family` field added | JSON Lines |
| `summary.json` | Top-200 ligand-code frequency table | JSON |
| `f2_geom.json` | Per-entry F2 geometry measurements (36 entries) | JSON |

## What's out-of-repo (~1.6 GB, in `~/Moorhen-survey-raw/`)

| Path | Purpose | Size |
|---|---|---|
| `~/Moorhen-survey-raw/all.jsonl` | Raw GraphQL response, one entry per line | 1.7 GB |
| `~/Moorhen-survey-raw/mmcif/*.cif.gz` | 37 F2 entries' coordinate files | small |

These aren't checked in because (a) all.jsonl is reproducible from the scripts
and (b) the mmCIFs are freely re-downloadable from RCSB. They're kept locally
so `geom_f2.py` can re-run without re-fetching.

## Reproducing the survey

1. Re-run the RCSB Search API query (in `analyze.py` head comment): returns
   ~24,000 PDB IDs with the `LIGAND_COVALENT_LINKAGE` feature flag.
2. Batch-fetch `_struct_conn` rows via GraphQL Data API (480 batches of 50,
   ~20 min wallclock at API limits). Output: `all.jsonl`.
3. `python3 analyze.py` → filters to Cys-SG ↔ non-S < 2.0 Å, dedupes altlocs,
   writes `hits.jsonl` + `summary.json`.
4. `python3 analyze_warheads.py` → tags each hit with F1–F6 family or
   cofactor/PTM bucket. Writes `hits_classified.jsonl`.
5. `python3 geom_f2.py` → downloads F2 mmCIFs (cached at `mmcif/`), measures
   geometry per entry. Writes `f2_geom.json`.

The query / endpoint quirks (which attributes are not search-enabled, the right
`feature_summary` aggregate to use) are captured in `analyze.py`'s head
comment.

## Notes on edge cases

- **Altlocs**: deduped at the (entry, chain, residue, atom) level; one bond
  per altloc.
- **Modres**: cysteine variants (CSO, CSD, CME, CSS, …) excluded from "CYS" —
  they're a separate PTM bucket, not warhead binders.
- **Naming regex undercounts**: the family classifier in `analyze_warheads.py`
  matches against `_chem_comp.name`; IUPAC-style "chloranyl"/"bromanyl"
  spellings used in newer CCD entries slip through and land in the
  "unclassified" bucket. An RDKit-on-SMILES reclassification pass would
  reduce the unclassified bucket by ~50% — not run here.

## Survey limitations to be aware of

1. **Lower bound on entry count.** Anything missing a `_struct_conn covale` row
   isn't counted. Confirmed missing: Spebrutinib (5KUP), all bortezomib /
   ixazomib / boronate warheads (zero S–B hits found despite the chemistry
   being well-known).
2. **No atom-coordinate-direct verification.** A truly complete survey would
   parse every `_atom_site` block looking for sub-2 Å Cys-SG↔non-S distances
   regardless of `_struct_conn` annotation. That's ~200,000 entries to scan,
   out of scope for this pass.
3. **Single-instance counting.** A ligand bound to multiple Cys residues in
   one entry produces multiple hits; the `count` columns reflect contacts,
   not unique ligand-entries.

## Status

- Plan-doc updated with empirical numbers ([`../covalent-ligand-plan.md` §2.0](../covalent-ligand-plan.md)).
- Memory written ([`feedback / project_pykeko_covalent_warhead_families`](../../../.claude/projects/-Users-hilgersmt/memory/project_pykeko_covalent_warhead_families.md)).
- F2 dihedral restraint revised based on findings (was syn-only `0° ± 10°
  period=1`, now `0° ± 20° period=2`) — see plan-doc Appendix A.1.
- Implementation roadmap reordered: F4 + F6 to be built alongside F2 for
  broadest deposit-recovery utility.

## What surprised us

**8FD9** — the canonical XQQ (acalabrutinib + BTK Cys481) entry that I'd been
treating as the gold standard — sits at τ(SG–Cβ=Cα–C7carbonyl) = **−89°**,
not the textbook 0° syn-addition. Tirabrutinib (5P9M, 8FF0) is the
well-behaved syn one at +1° / +2°. The published Lin & Andreotti 2023 paper
asserts "(E)-vinyl thioether" without quoting the dihedral, which lets the
reader assume textbook syn. A hard `τ = 0° ± 10°` restraint would actively
fight refinement on the most-cited structure in the field. Running the
survey caught this before any code shipped.
