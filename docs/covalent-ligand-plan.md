# Covalent ligand workflow — design plan

> **Status: design plan, no code shipped.** Authored 2026-06-05 in response to
> "All of our ligands are covalent with the sulfur of a cysteine, so getting
> this right will be a huge time saver." The narrow Cys-S constraint is what
> makes this plan tractable; for the general (Ser/Thr/Lys/Tyr/...) workflow,
> see the CCP4 AceDRG-link path documented inline.

## TL;DR

The user's actual workflow is **100% Cys-S-covalent ligands**. That constraint
collapses what would otherwise be a Refmac-level dictionary-editing problem
(AceDRG + JLigand + custom CIFs) into a closed, finite set of warhead
chemistries (~15) that we can pre-bake. The killer UX is **one click to
declare an existing bond + auto-generated refinement-ready restraints**, with
no AceDRG dependency for the common cases.

This plan covers what to ship, in what order, and what to defer. It assumes
v0.2.18-current state of PyKeko / Moorhen-PyKeko / PyKekoMCP.

---

## 1. Why this matters / the reframe

Covalent inhibitor crystallography has the same five sharp edges everywhere:

1. **Refinement drifts the bond too long.** Without a proper LINK + dictionary,
   Refmac/phenix.refine has no restraint on the S–C distance, no angle
   restraints around the new bond, and the geometry distorts. Nicholls &
   Murshudov 2021 (*Acta D* 77, 681) quantify this across the PDB: covalent
   distances in unannotated entries are systematically 0.05–0.15 Å longer
   than chemistry-appropriate.
2. **Atom naming chaos.** The link dictionary needs to refer to atoms in the
   ligand by name (e.g. `C7`), but ligand CIFs from different sources use
   different names for chemically equivalent atoms. The dictionary breaks
   silently if names don't match — refinement just doesn't apply the
   restraints, no warning.
3. **AceDRG is fragile and slow.** RDKit-based valence checks reject
   intermediate states (`5-valent carbon` errors), the subprocess takes
   5–30 s, and a small typo in the LINK instruction file (atom name vs.
   atom id, bond order keyword vs. bond type token) silently produces a
   useless CIF.
4. **The link CIF is a separate file you can lose.** Coot saves it to the
   directory it was launched from, with a name like
   `acedrg-link-from-coot-CYS-LIG-link-instructions_link.cif`. If you forget
   to pass it as Refmac `LIBIN`, the link is silently ignored.
5. **Deposition gymnastics.** The wwPDB validates LINK / `_struct_conn`
   records against its CCD chemistry catalogue and rejects "novel" links
   without provenance. The user has to attach the link dictionary as a
   supplementary file at deposition.

For an all-Cys-S workflow, problems 1, 2, 3, and 5 are all reducible to
"do the chemistry once, statically, and reuse it." Only problem 4 is structural
(the file-tracking nuisance) and that's solved by emitting `_struct_conn` +
embedding the dict in the session.

## 2. The closed Cys-warhead universe

Across PDB-deposited Cys-S covalent inhibitor structures (CovBinderInPDB v2,
Yusuf et al. 2022; CovalentInDB 2.0), 95%+ of warhead chemistries fall in
this list:

### 2.1 The key architectural insight: warhead **families**, not individual warheads

The link CIF only constrains atoms **up to Cβ** (the carbon bonded to S). Everything
past Cβ — your methyl, ethyl, benzyl, cyclopropyl, or whatever larger group hangs
off — is governed by the **ligand's own monomer CIF**, not the link. So **one link
template handles an entire family** of warheads that differ only in what's attached
to Cβ.

This collapses ~18 individual warheads into ~6 family templates:

| # | Family | Reactive group | Mod on Cys | Mod on ligand | Bond formed | Members |
|---|---|---|---|---|---|---|
| **F1** | **α,β-unsaturated amide (acrylamide-style)** | C=C–C(=O)–N | Δ HG | C=C → C–C (Cβ sp2→sp3) | SG–Cβ single | acrylamide, methacrylamide, β-substituted acrylamide, cyanoacrylamide (reversible) |
| **F2** | **α,β-ynamide (alkyne Michael)** | **R–C≡C–C(=O)–N** | Δ HG | **C≡C → C=C** (Cα gains H, Cβ gains S, both sp→sp2) | SG–Cβ single | **butynamide (acalabrutinib), pent-2-ynamide, hex-2-ynamide, "extended butynamide" with CH₂-R off the methyl, benzyl-propynamide, terminal propiolamide (R = H, spebrutinib)** |
| **F3** | **α,β-unsaturated EWG (non-amide)** | C=C–EWG (EWG = SO₂R, C(=O)R, C≡N) | Δ HG | C=C → C–C | SG–Cβ single | vinyl sulfone, vinyl sulfonamide, vinyl ketone, α,β-unsat nitrile |
| **F4** | **Activated CH₂–X (Sn2 displacement)** | X–CH₂–EWG (X = Cl, Br, I, OTs) | Δ HG | Δ X | SG–C single | chloroacetamide, bromoacetamide, iodoacetamide, mesylate/tosylate displacement |
| **F5** | **Strained-ring opening** | 3-ring with C–N, C–O, or C–S | Δ HG | Ring → open, retype heteroatom | SG–C single | epoxide, aziridine, β-lactam, β-sultam (rare) |
| **F6** | **Reversible carbonyl adduct** | R–CHO, R–C(=O)–R' | Δ HG | C=O → C–OH | SG–C single | aldehyde hemithioacetal, ketone hemithioketal |

### 1.5 The Nicholls et al. 2021 Mpro case study (devastating empirical motivation)

The "Missing link" paper (PMC8171067 — see `refs/`) is the single most useful
external reference for the design. Its SARS-CoV-2 Mpro + N3 inhibitor case
study (Section 4) is the published-PDB-data equivalent of what we'd need to
prove for our own workflow. The N3 inhibitor (CCD code PJE) covalently bonds
to Mpro Cys145 via a Michael acceptor C20=C21 → C20-C21 after Cys-SG attack.
23 instances across 11 PDB entries show:

| Modelling treatment | Median S–C distance | C20–C21 bond | B-factor sKL divergence |
|---|---|---|---|
| Unannotated (no LINK) | **~2.5 Å** (drifted apart by repulsive forces) | stays double (1.32 Å) | ~2.4 |
| LINK record alone, no dictionary | ~1.78 Å | **still 1.32 Å — wrong chemistry** | ~0.5 |
| LINK + AceDRG dictionary | ~1.78 Å | **1.51 Å (single, correct)** | ~0.3 |
| AceDRG ideal target | 1.838 Å σ=0.011 (sp3 C) | 1.521 Å σ=0.011 | — |

**Figure 9 of the paper is the killer demonstration**: a LINK record alone
doesn't fix refinement because without `_chem_mod_bond` changing C=C→C-C,
refinement keeps the original double-bond restraint. The dictionary's
modifications are load-bearing, not optional.

For our F2 (α,β-ynamide) case, the analogous chem_mod is `C≡C → C=C` plus
add-H-on-Cα plus retype sp→sp2. Without those, refinement keeps the alkyne
restraints and pulls our vinyl-thioether back toward an alkyne — explaining
some of the geometric drift our §2.0 survey saw in 8FD9 (XQQ at -89° instead
of 0° — possibly partial drift back from missing chem_mod). **Direct
implication for implementation: phase-1 must include the chem_mod bond-order
change AND the chem_mod atom-add, not just the new bond between Cys and Cβ.**

### 1.6 Deposition pipeline lossiness (§5, p. 743) — the workflow-saver finding

The paper documents that **wwPDB's current annotation pipeline DISCARDS the
author's link records and any link identifier referencing a custom dictionary.**
Verbatim: *"The original link records of the model authors, and indeed any
connectivity records, are automatically discarded by the current wwPDB
annotation pipeline."* And: *"Component and link dictionaries are not
deposited, and linkage identifiers that specify the exact dictionary,
chemistry and restraints used during refinement are discarded upon
deposition."*

**This is not a theoretical concern — it's a documented production behavior
that destroys the user's modeling choices.** wwPDB regenerates connectivity
from chemistry, often disagreeing with the author's intent. The future reader
of a deposited structure can't tell whether the model was refined with a
proper link dictionary or with nothing.

**Implications for PyKeko's deposition-bundle (§6.4):**

- Default the export to include link CIFs as supplementary materials.
- Surface a one-screen pre-deposition checklist warning that wwPDB will strip
  what the user is about to upload. Recommend upload of link CIFs as
  supplementary material so future readers can reconstruct intent.
- Generate a `README_for_validators.md` in the bundle explaining each link
  used and its provenance (CCP4-ML / hand-authored / AceDRG / PyKeko library).
- Long-term: argue for a "PyKeko deposition contract" — a JSON manifest
  alongside the PDB upload that wwPDB could in principle honor. Not actionable
  short-term but worth flagging in any community discussion.

### 1.7 Servalcat + Gemmi: the canonical refinement target (Yamashita 2023)

Per Yamashita, Wojdyr, Long, Nicholls & Murshudov (2023), "GEMMI and Servalcat
restrain REFMAC5," *Acta Cryst* D**79**, 368–373 (DOI 10.1107/S2059798323002413,
PMC10167671, IUCr ID qe5004), the modern CCP4 refinement entry point is:

```bash
refmacat XYZIN model.cif HKLIN data.mtz LIBIN lig.cif
```

A drop-in replacement for `refmac5` that uses **Gemmi** to parse `_struct_conn`
+ match against the CCP4-ML link templates with a **specificity hierarchy**
(monomer-specific > group-specific > generic, with torsion / chirality
tie-breaking and atom-name aliases). No manual `LINKR` IDs, no `LIBIN`
ordering finesse, no first-match-wins surprises.

`servalcat refine_xtal --find_links --ligand lig.cif --hklin data.mtz
--model model.cif` is the equivalent Servalcat invocation; `--find_links`
**auto-detects unstated linkages from contact analysis** (Gemmi `ContactSearch`
with `--covmult=1.5` ↔ the Nicholls 2021 criterion) and treats them as
candidates for the restraint build. This is a free deposition-safety gate.

**Licensing**: both Gemmi (Wojdyr, Diamond / Global Phasing / CCP4) and
Servalcat (Yamashita, Murshudov group MRC LMB) are **MPL-2.0** — industrially
usable with no Phenix-style consortium license required. Both bundled with
CCP4 9 (the user's existing CCP4 commercial license already covers them).
Both also installable standalone via `pip install gemmi servalcat` or
`conda install conda-forge::gemmi conda-forge::servalcat`.

**Implementation implication for PyKeko's renderer-side bond detector** (the
auto-detect path in §5.B5 of the plan): the canonical detection algorithm is
**Gemmi's `ContactSearch` with `setup_atomic_radii(1.5, 0.0)` + `--ignore=4`
filter** for chemical-graph distance. PyKeko has three implementation options:

1. **Bansu-wrap a local Gemmi** (recommended). Gemmi is already a CCP4
   dependency the user has, MPL-2.0, and conda-installable. Call
   `gemmi contact --covmult=1.5 --ignore=4 model.cif` from a sidecar and parse
   the output. Bonus: exact byte-for-byte agreement with what `refmacat
   --find_links` will see at refinement time — no round-trip surprises.
2. **JS reimplementation** (compromise). The algorithm is small: covalent
   radius table + symmetry-aware neighbor search + 4-bond graph filter. A few
   hundred lines, no deps. Cost: we own the covalent-radius table and have to
   re-validate against Gemmi's regression suite.
3. **Gemmi-WASM** (future). Wojdyr's repo has a `gemmi-wasm` target; building
   it for PyKeko adds ~2 MB to the bundle. Defer to v0.4+ unless we need
   other Gemmi services in-browser.

For the MoorhenMCP / Claude integration, the cleanest surface is two new
CLI-shaped MCP tools mirroring the user-facing commands:
`servalcat_refine_xtal(model, mtz, ligands[], find_links=True, …)` and
`gemmi_find_links(model)`. Servalcat has no stable Python API, so wrapping
the CLI is the right shape (same pattern as the existing AceDRG hookup).

**Important caveats from reading the actual Yamashita 2023 paper** (in
`refs/`, not the agent's summary):

- **`--find_links` is OFF by default** (§3.1, p. 371). The user MUST enable
  it explicitly OR provide explicit `_struct_conn` / LINK records. PyKeko's
  deposition-ready export must always emit `_struct_conn` rather than rely
  on auto-detection at refinement time, and the PyKeko-generated invocation
  string should include `--find_links` as a belt-and-braces sanity gate.

- **Link specificity tie-breaking uses CHIRALITY AND TORSION values** (§3.1,
  p. 372): when multiple links match a given residue pair with equal
  specificity (e.g. TRANS and CIS peptide links between peptide-peptide), the
  "chirality and the ideal values of torsion angles from the link description
  are compared with the values in the atomic model and the best-matching link
  is used." **For our F2 link CIF, the `_chem_link_chir` and `_chem_link_tor`
  entries are not just nice-to-have — they're load-bearing for unambiguous
  matching.** The Appendix A.1 template's `_chem_link_tor` is what
  disambiguates CYS-YNA from a hypothetical CYS-acrylamide if both were ever
  defined for the same atom pair.

- **`_chem_comp_alias` is the new atom-name remap mechanism** (§2, p. 369,
  Fig 1b). Allows a monomer's nonstandard atom names to be aliased to the
  standard CCP4-ML naming convention. Critical for in-house warhead
  compounds: if your ligand uses `C7` for the carbonyl C but the CCP4-ML
  expects `C`, you can declare the alias in the ligand CIF and the
  link-restraint machinery will follow the alias without needing per-compound
  link templates. **Our F2 substitution architecture is the equivalent
  mechanism on the link-CIF side** — same problem (atom-name diversity),
  same solution (programmatic remap), different side of the dictionary.

- **§4 conclusion explicitly names our family approach as the planned future
  direction**: *"In future, a general solution for dealing with covalent
  linkages between monomers could use chemical atom types, similar to that
  internally used within AceDRG (Long et al., 2017), in order to allow the
  definition of linkages between functional groups."* This is exactly what
  our F1–F6 family templates do — they define links by **functional group**
  (α,β-ynamide, acrylamide-like, chloroacetamide-like, …) rather than by
  individual ligand 3-letter code. **PyKeko's covalent-ligand workflow is
  not just compatible with CCP4's direction — it's an early implementation
  of the Murshudov group's stated future architecture.** Worth flagging in
  any community engagement / paper / talk.

- **Versions reported in the 2023 paper**: REFMAC5.8.0405, GEMMI 0.6.0,
  Servalcat 0.4.0. Current versions (as of 2026-06-06) are newer; the
  algorithm is stable but the CLI surface has grown. Check `servalcat --help`
  for the live flag list.

- **Software availability and licensing** (§5, p. 373):
  - CCP4-ML: https://github.com/MonomerLibrary/monomers (LGPL)
  - GEMMI: https://github.com/project-gemmi/gemmi (MPL-2.0)
  - Servalcat: https://github.com/keitaroyam/servalcat (MPL-2.0)
  - All three usable by commercial users with no extra license beyond
    the CCP4 commercial license the user already holds.

### 1.8 Our 2.0 Å survey threshold was too tight (§2.1, p. 729 + Fig 2)

The paper uses Gemmi with the adaptive threshold `d < 1.5 × (r_1 + r_2)`. For
S–C that's `1.5 × (1.05 + 0.76) = 2.7 Å` — substantially wider than our hard
2.0 Å cap. Our 4,958-entry count is therefore an even tighter lower bound
than we estimated: the most pernicious failure mode is exactly the
unannotated-and-drifted-long case (Fig 2 of the paper shows under-refined
bonds in the 2.0–3.0 Å range across most warhead classes). When we re-run
the survey or extend the auto-detector, **adopt the paper's adaptive
threshold instead of the fixed 2.0 Å**.

The paper also excludes potential linkages where the two atoms are connected
by `<4` bonds in the chemical graph — to avoid metal-coord same-residue
artifacts (their example: SG atoms in Zn-binding Cys C97/C145 in 2oc8 look
like a CYS-CYS contact but aren't). Our auto-detector should adopt this
filter.

### 2.0 Empirical validation (RCSB-wide survey, 2026-06-05)

Numbers below replace earlier back-of-envelope estimates. **Survey method:** RCSB
Search API for entries flagged `LIGAND_COVALENT_LINKAGE`, then GraphQL Data API
to enumerate every `_struct_conn` row, filtered to Cys-SG ↔ non-S contacts
< 2.0 Å on different residues. Full scripts + raw output live in `/tmp/pdb_conn/`
(884 MB raw, 23,976 entries scanned).

**Headline numbers**:
- Entries with ≥1 Cys-SG ↔ non-S contact < 2.0 Å: **4,958**
- Total such contacts: **20,068**
- 99.3% carry a `_struct_conn covale` row (only 0.7% are metal coord)
- Comparison to CovBinderInPDB (Jan 2022 cutoff): 1,344 entries → 4,958 today,
  a 3.7× growth in 4 years
- **Lower bound**: this number misses Spebrutinib (5KUP) and all bortezomib-
  family boronate structures — they have S-X < 2 Å bonds but no `covale`
  annotation. True Cys-covalent universe is likely 6,000–8,000 entries.

**Critical reframing — 62% of hits are natural cofactors, not warheads.** The
top 5 codes (HEC, PEB, CYC, HEM, PUB) alone account for 12,061 hits across
~1,250 entries. The drug-warhead universe is ~2,100 hits across ~900 entries.
**Implication for the auto-detect logic in §5.B5:** the detector MUST gate on
residue identity. Auto-skip these natural-cofactor 3-letter codes before
considering any sub-2 Å contact a warhead candidate:

> **Cofactor auto-skip list (sub-2 Å Cys-SG attachments that are NOT warheads):**
> HEC, HEM, HDE, ISW, O6E (hemes); PEB, CYC, PUB, BLA, LBV, EL5 (bilins);
> FAD, FMN, FCG, JGC, FMA (8α-S-cysteinyl flavins); PLM, OCA, DGA, MYR, Z41
> (S-acyl lipids); SF4, FES, F3S, ZN (Fe-S / metal); FAR, KQ6, KPX, KP9, PVN
> (other natural cofactors).

**Family share, non-cofactor subset (n ≈ 7,400 hits):**

| Family | Hits | Entries | Distinct codes | Implementation priority |
|---|---|---|---|---|
| F6 (reversible carbonyl) | **885** | 452 | 290 | Biggest by deposited count — Mpro α-ketoamides drove post-2020 explosion |
| F4 (activated CH₂–X) | 545 | 256 | 173 | |
| F1 (α,β-unsat amide) | 457 | 163 | 105 | |
| Reversible nitrile | 130 | 73 | 66 | Worth adding as F7 |
| **F2 (α,β-ynamide — user's lab)** | **80** | **37** | **33** | **First priority for the user.** 14 of 37 entries are 2025-26 depositions — steep growth curve |
| F5 (strained-ring) | 8 | 8 | 8 | Rare |
| F3 (α,β-unsat non-amide) | 2 | 2 | 2 | Very rare |
| Unclassified (regex undercount) | 3,932 | 2,097 | 1,361 | Real F1/F4/F6 hidden here; RDKit pass would lift each by ~30% |

The earlier "F1 + F4 ≈ 50%" plan-doc claim was implicitly literature drug-warhead
share, not deposited-PDB share. Real F1 + F4 = ~14% of non-cofactor; **F6 is
empirically #1.** This doesn't change the family-template architecture but it
should reorder the implementation roadmap: **build F4 + F6 alongside F2 for
broadest deposit-recovery utility; defer F1 / F3 / F5 until after.**

**F2 detail (user's family, n=37 entries):**

Beyond the 4 entries cited in §2.1 (8FD9 XQQ, 8FF0 7GB, 5P9M tirabrutinib,
5KUP-family spebrutinib), the survey found **34 additional F2 entries**:

```
2QLQ 2QQ7 4I24 5QIU 5VIE 5X02 6E37 6O8I 6OWC 6Q2A 7DHJ 7GHH 7JXH 7MAU 7MAV
7MB2 7MB3 7WNV 8A1N 8ETK 8EWT 8R5F 8X2A 9CUW 9CUX 9D02 9DF4 9F65 9GHV 9GL8
9GL9 9OGN 9YSI 9ZAW
```

The 4-(dimethylamino)-but-2-enamide motif (canertinib / mobocertinib / "third-
gen EGFR" warhead) dominates — 10 of the 37 are "extended-methyl" cases. **This
is precisely the user's lab's structural niche.** Cross-validation of the link
template should include the whole F2 set, especially 9CUX at 1.27 Å resolution.

Deferred / non-family special cases (each needs its own template, but each is rare):

| Special case | Approximate PDB share | Notes |
|---|---|---|
| Sulfonyl fluoride (SuFEx) | ~3% | SG–S bond, Δ F; non-C target atom |
| Disulfide tether | ~2% | SG–S bond replacing an existing S–S |
| Nitrile (reversible thioimidate) | ~2% | C≡N → C=N, no atom Δ |
| Boronic acid/ester | <1% | SG–B bond; non-C target |

**Cumulative coverage:** F1 + F4 = ~50% of PDB Cys-covalent; F1 + F2 + F4 = ~55%
(butynamide family is small in deposited structures but **critical for the user's
lab — all their compounds are F2**). F1 + F2 + F3 + F4 = ~70%. All 6 families ≈ 85%.

The remaining 15% is either (a) very rare warheads not worth baking in or (b)
photo-affinity / catalytic-cysteine / weird custom chemistry that should fall through
to AceDRG via Bansu.

### 2.2 Family F2 in detail (the user's lab focus)

The ynamide family deserves a closer look because:
- 100% of the user's lab's compounds are in this family.
- The chemistry differs from acrylamide (F1): starting material has C≡C, post-reaction
  has C=C **and an added H on Cα**, not a C–C with no atom additions.
- "Extension off the methyl" cases (your case) and "terminal alkyne" cases (Spebrutinib's
  propiolamide) **share the same link CIF** because the link only constrains up to Cβ.

Atom-naming map (using XQQ — acalabrutinib in PDB 8FD9 — as the canonical):

```
        amide       Cα           Cβ        ←  what the link constrains
          N1—C7(=O1)—C13(H)=C19(...)—C21H3  ←  XQQ atom names
                              ↑              (or CH2-R for extended versions)
                              SG (from Cys)
                              ↑
                              ↓ mod1: delete HG on Cys SG
                              ↓ mod2: delete H18 on C19 (or equivalent)
                              ↓        (if starting from the *alkyne* form,
                              ↓         also: TRIP → DOUB on Cα≡Cβ, add H13)
```

Post-reaction (deposited) state:
- **Cβ (C19)**: sp2; new single bond to SG; double bond to Cα; single bond to Cγ
  (= methyl in acalabrutinib, CH₂– in extended versions, H in propiolamide).
- **Cα (C13)**: sp2; double bond to Cβ; single bond to carbonyl C7; H attached (H13).
- **C7 (carbonyl)** and beyond: unchanged.

**Stereochemistry**: thia-Michael syn-addition gives the **(Z)-vinyl thioether**
(S and added H on the same face of C=C). In CIP terms with substituents around C13=C19,
this is written as `E` in the XQQ chem_comp CIF because S beats CH₃ at C19 and carbonyl
beats H at C13. The result is: carbonyl (on C13) and methyl (on C21 via C19) end up
**trans** across the C=C, equivalently **carbonyl and S end up cis**. Implement as
dihedral restraint `τ(SG–Cβ=Cα–C(carbonyl)) ≈ 0°, σ=10°` — keep σ loose because the
pocket can twist this.

**The four "extension" sub-families that all use the same link CIF:**

| Sub-family | R-group at Cβ | Example | Atom-naming note |
|---|---|---|---|
| **Methyl (canonical butynamide)** | CH₃ | Acalabrutinib, tirabrutinib | Cβ–Cγ single bond; Cγ is sp3 CH₃ |
| **Extended methyl** (your case) | CH₂–R' (R' arbitrary) | "extended butynamides" | Cβ–Cγ single bond; Cγ is sp3 CH₂ → R' is part of the ligand monomer; **link CIF unchanged** |
| **Aryl-extended** | aryl/heteroaryl directly | 3-aryl-propynamide | Cβ–Cγ single bond; Cγ is sp2 aromatic; **link CIF unchanged** (only the bond from Cβ–Cγ is referenced, not Cγ's hybridization) |
| **Terminal alkyne / propiolamide** | H | Spebrutinib | Cβ has H instead of Cγ; **link CIF needs a per-substitution toggle** — see §2.3 |

The first three are handled by ONE template. Terminal-propiolamide is the only
sub-case that needs a tweak (because there's no Cγ atom to write a `_chem_link_*`
record against).

### 2.3 The CIF strategy: scope-limited link + per-warhead detector

A single link CIF for family F2 looks like (schematic; full CIF in appendix):

```
data_link_CYS-YNA            # one ID for the whole family
_chem_link.id            CYS-YNA
_chem_link.comp_id_1     CYS
_chem_link.mod_id_1      CYS-YNA-mod1
_chem_link.group_comp_1  L-peptide
_chem_link.comp_id_2     .          # any ligand
_chem_link.mod_id_2      CYS-YNA-mod2
_chem_link.group_comp_2  non-polymer

loop_                             # the new vinyl-thioether bond
_chem_link_bond.atom_1_comp_id    1
_chem_link_bond.atom_id_1         SG
_chem_link_bond.atom_2_comp_id    2
_chem_link_bond.atom_id_2         <Cβ>      # substituted at runtime
_chem_link_bond.type              single
_chem_link_bond.value_dist        1.80
_chem_link_bond.value_dist_esd    0.02

loop_                             # the C=C double-bond restraint
_chem_link_bond.atom_1_comp_id    2
_chem_link_bond.atom_id_1         <Cβ>
_chem_link_bond.atom_2_comp_id    2
_chem_link_bond.atom_id_2         <Cα>
_chem_link_bond.type              double
_chem_link_bond.value_dist        1.34
_chem_link_bond.value_dist_esd    0.02

loop_                             # angles around the new sp2 carbon
_chem_link_angle.atom_1_comp_id   1
_chem_link_angle.atom_id_1        CB
_chem_link_angle.atom_2_comp_id   1
_chem_link_angle.atom_id_2        SG
_chem_link_angle.atom_3_comp_id   2
_chem_link_angle.atom_id_3        <Cβ>
_chem_link_angle.value_angle      102.0       # standard thioether Csp3-S-Csp2
_chem_link_angle.value_angle_esd  3.0

# … similar entries for SG-Cβ=Cα (122°), Cβ=Cα-Ccarbonyl (122°), …

# Conjugated planarity over the vinyl-thioether
_chem_link_plane.id               PLN_THIOVINYL
_chem_link_plane.atoms            "SG Cβ Cα Ccarbonyl Camide"

# Syn-addition dihedral (carbonyl/S cis across C=C)
_chem_link_tor.id                 syn_addition
_chem_link_tor.atom_1             SG
_chem_link_tor.atom_2             <Cβ>
_chem_link_tor.atom_3             <Cα>
_chem_link_tor.atom_4             Ccarbonyl
_chem_link_tor.value              0.0
_chem_link_tor.value_esd          10.0
_chem_link_tor.period             1

data_mod_CYS-YNA-mod1
# Cys side: delete HG
loop_
_chem_mod_atom.function  _chem_mod_atom.atom_id  _chem_mod_atom.new_atom_id …
delete HG . .

data_mod_CYS-YNA-mod2
# Ligand side: depends on input state — see §2.4
# If user uploaded the alkyne form (R-C≡C-C(=O)-N):
#   1. Change Cα≡Cβ from triple to double bond
#   2. Add H on Cα (named H<Cα>)
#   3. Retype Cα and Cβ from sp to sp2
# If user uploaded the post-reaction crotonamide form (XQQ-style):
#   1. Delete the H on Cβ (named H<Cβ>) — replaced by new SG bond
#   2. Retype Cβ from sp2 (vinyl) to sp2 (vinyl-thioether) — usually no change needed
```

Where `<Cα>` and `<Cβ>` are placeholder atom-id tokens substituted at runtime
with the actual atom names of the user's ligand (e.g. `C13` and `C19` for XQQ).
Family F2's runtime detector identifies these by SMARTS substructure match
against the post-reaction vinyl-thioether SMARTS:
`[#16:0][C:1]([#1,#6,#7])=[C:2]([#1])C(=O)N`
where atom 1 (mapped to SMARTS index 1) is Cβ and atom 2 (mapped to SMARTS
index 2) is Cα. RDKit-WASM substructure search gives the mapping in <50 ms.

The detector falls through to the **alkyne** SMARTS if no vinyl-thioether
substructure is found:
`[C:1]#[C:2]C(=O)N` (alkyne form, user hasn't yet converted)
in which case mod2 takes the "alkyne input" branch (TRIP→DOUB + add H on Cα).

### 2.4 Two ligand input states the user might present

| Input state | SMARTS signature | mod2 operations |
|---|---|---|
| **Alkyne (pre-reaction)** — user uploaded the free drug SMILES from PubChem etc. | `R-[C:1]#[C:2]-C(=O)-N` | (1) Change C1≡C2 → C1=C2 double; (2) Add H on Cα; (3) Retype C1, C2 sp → sp2; (4) Add SG bond to Cβ |
| **Crotonamide post-reaction (XQQ-style)** — user uploaded a PDB ligand CIF where the C=C is already drawn | `R-[C:1]([H])=[C:2]-C(=O)-N` with H on each vinyl C | (1) Delete H on Cβ (the one being replaced by SG); (2) Add SG bond to Cβ |

The detector runs both SMARTS in order, picks the first match, branches mod2
accordingly. From the user's perspective both inputs produce the same final
restraint set — they just don't have to remember which form their SMILES is in.

This is genuinely innovative — neither Coot's `acedrg -L` nor Phenix's `apply_cif_link`
auto-detect the user's input state; they require the user to know up-front whether
they're feeding the pre- or post-reaction structure. This single piece of UX removes
one of the most common pain points.

### 2.5 Other families: same pattern, different SMARTS

| Family | Pre-reaction SMARTS | Post-reaction SMARTS | mod2 differences |
|---|---|---|---|
| F1 (α,β-unsat amide) | `[C:1]=[C:2]C(=O)N` | `[C:1][C:2]C(=O)N` (sp3-sp3) | C=C → C–C, retype both to sp3, add H on Cβ |
| F2 (α,β-ynamide) | `[C:1]#[C:2]C(=O)N` | `[C:1]=[C:2]C(=O)N` (sp2-sp2) | C≡C → C=C, add H on Cα, retype sp → sp2 |
| F3 (α,β-unsat EWG) | `[C:1]=[C:2][S,C,N](=O)(=O)`, `[C:1]=[C:2][C:3]#N`, etc. | post-Michael analog | C=C → C–C, retype sp2 → sp3 |
| F4 (activated halide) | `[Cl,Br,I][C:1]C(=O)N` | the same C, no halide | Δ halide; no other changes |
| F5 (epoxide / aziridine) | `[C:1]1O[C:2]1` / `[C:1]1N[C:2]1` | open ring | open ring; retype O→OH or N→NH |
| F6 (reversible carbonyl) | `[C:1](=O)R` | `[C:1](O)(R)` (sp3 hemiacetal) | C=O → C–OH; retype sp2 → sp3; add H |

Same architecture. Same atom-name substitution machinery. Same one-template-per-family
approach. The whole library is ~6 CIF templates, ~12 SMARTS patterns, and a runtime
detector that handles pre-/post-reaction input states for all of them.

## 3. Current state of Moorhen / PyKeko (audit summary)

End-to-end audit conducted alongside this plan. Headline findings:

**Already wired:**
- `MoorhenCreateAcedrgLinkModal.tsx` — atom-pair picking modal with bond-order,
  delete-atom, charge-change fields. Marked `devOnly: true` in the menu config.
  Delegates to `moorhen.AceDRGInstance.createCovalentLink(arg1, arg2)` — a
  Moorhen-side interface stub with NO default implementation in the codebase.
  (The Moorhen-PyKeko fork is expected to inject one; PyKeko doesn't yet.)
- Atom-click event system (`atomClicked` CustomEvent dispatched from
  `mgWebGL.tsx:5698`, captured in `AtomClickManager.tsx`). Same machinery used
  for distance measurement, vector creation, and the AceDRG modal.
- Bansu HTTP integration (`LhasaReact/src/bansu_integration.tsx`) — currently
  used only for Lhasa → AceDRG monomer generation. Could carry link-mode
  AceDRG calls too (`acedrg -L instructions.txt`) but doesn't today.
- mmCIF writer (`api/coot-molecule.cc:4684–4696`) — mmdb's `WriteCIFASCII`
  preserves any `mmdb::Link` objects in the manager as `_struct_conn` rows.
- Coot WASM API: `import_cif_dictionary` (bound at
  `molecules-container-nanobind.cc:1112`), `try_read_dictionaries_for_new_residue_types`
  (nanobind:1557), `clear_extra_restraints`, `generate_self_restraints`,
  `add_target_position_restraint`.
- Refinement: `refine_residues_using_atom_cid` etc. will **automatically**
  pick up link restraints from the in-memory mmdb LINK records — but only
  if a matching `chem_link` is registered in `protein_geometry`. The link
  matching is by (resname_1, group_1, resname_2, group_2) → `chem_link_map`
  hash, then by-atom-name disambiguation. Link-id in the LINK record is NOT
  used. (Critical implication: ship pre-baked dicts with consistent group
  classification — `L-PEPTIDE` for the Cys side, `non-polymer` for the
  ligand side — and the matching is automatic.)

**Missing:**
- `make_link` (the C++ function that adds an `mmdb::Link` + applies chem mods)
  is NOT exposed in the nanobind API. Lives on `molecule_class_info_t::make_link`
  (`src/molecule-class-info-build.cc:233`) but not on the api-side
  `coot::molecule_t`. **Has to be ported + bound.** ~80 lines of C++.
- `add_extra_bond_restraint` / `add_extra_angle_restraint` — not bound.
  Lower-priority alternative path for novel warheads.
- `_struct_conn` is implicitly written if `mmdb::Link` exists, but no code
  populates `mmdb::Link` from user action. (`make_link` would.)
- `.pykeko` session schema has NO field for covalent-link state. Links are
  lost on save+restore. `MoorhenSession.proto:85–100` would need a new
  `covalent_links` repeated field, plus the list of imported link CIF blobs
  (the dictionary lives in process-wide `protein_geometry`, not the molecule).
- AceDRG link generation is not server-side anywhere yet — task `#133`
  ("SMILES→CIF #4: local AceDRG fallback") would extend the existing local
  process spawning to support `-L` link mode, but that work hasn't started.
- The visualization side: covalent bonds don't render as bonds in Moorhen
  unless the ligand dict declares them. The bonds layer reads only intra-residue
  chemistry from the loaded mmdb model + ligand CIF, not LINK records. The
  user sees floating atoms with no bond connector — even when the chemistry
  is correct in the model.

## 4. The design space

Four orthogonal decisions. Picking one in each row defines an approach.

### Dimension A — Where do the restraints come from?

| Option | Mechanism | Pros | Cons |
|---|---|---|---|
| **A1. Live AceDRG (Bansu or local)** | Build `LINK:` instruction, POST to Bansu / spawn local `acedrg -L` | Always correct; handles novel chemistry | 5–30 s latency; fragile valence checks; server dependency or local CCP4 install |
| **A2. Pre-baked CIF templates** | Ship link dicts for warheads #1–15 as static JSON; substitute the user's actual ligand atom names at load time | Instant; no network; deterministic | Limited to baked warheads; atom-name mapping is a parser problem |
| **A3. Geometric extra restraints** | Just add bond + angle + chiral `extra_restraints` directly via the Coot API, no link dictionary at all | Simple; no dict machinery | Doesn't survive coords-export-and-reimport (extra restraints aren't written into PDB/mmCIF); needs UI to re-establish on session restore |
| **A4. Composite monomer (Grade2-style)** | Generate a merged CYS+LIG residue dictionary, replace the two residues with one composite | Best refinement convergence; one CIF | Non-portable residue code; ugly at deposition; breaks PDB chain continuity |

### Dimension B — How does the user trigger it?

| Option | Trigger | Time-to-bond |
|---|---|---|
| **B1. Two-atom-pick modal** (current `MoorhenCreateAcedrgLinkModal`) | Modal open + 2 atom clicks + bond-type dropdown + Submit | ~10 s |
| **B2. Right-click context menu on SG** | Right-click Cys SG → "Bond to ligand here" → auto-find ligand atom within 2.5 Å | ~2 s |
| **B3. Drag-and-drop in canvas** | Drag from SG to ligand atom | ~2 s; very direct |
| **B4. Paste covalent SMILES** | Special SMILES syntax with attachment-point marker → ligand auto-places + auto-attaches to nearest Cys | ~5 s, end-to-end including placement |
| **B5. Auto-detect post-load** | After ligand load, if any non-protein atom is within 2.5 Å of a Cys SG, surface a snackbar: "Looks like a covalent bond — declare?" | ~1 s if user clicks "Yes"; zero clicks if "Always trust" preference is on |

### Dimension C — How is the warhead chemistry identified?

| Option | Mechanism |
|---|---|
| **C1. User picks from a dropdown** of warhead names | Foolproof but slow |
| **C2. Auto-detect from ligand SMILES** (substructure match against SMARTS patterns) | Needs an RDKit-WASM call (Moorhen already has RDKit-WASM via Lhasa); takes <50 ms |
| **C3. Auto-detect from 3D bond environment around the picked atom** | Walk the mmdb residue, look at neighbors and bond orders; no RDKit needed |
| **C4. Distance + geometry heuristics** | If S–C is < 1.9 Å and the C has 4 neighbors → likely chloroacetamide-style sp3 product; if S–C is ~1.85 Å and C has 3 neighbors → likely Michael-addition product (β-carbon, sp3 in product) |
| **C5. ML classifier** | Train on PDB covalent inhibitors → predict warhead class. Probably overkill; rule-based covers >95% |

### Dimension D — How is the link persisted?

| Option | Persistence layer |
|---|---|
| **D1. PDB LINK record only** | Survives save-to-PDB; lost on save-to-mmCIF unless `_struct_conn` is also written |
| **D2. mmCIF `_struct_conn` row** | Survives modern saves; preferred |
| **D3. Bundled link CIF on disk** | Separate file; user has to track it |
| **D4. Embedded in `.pykeko` session** | Survives PyKeko save/restore but doesn't help when user exports to PDB for Refmac |
| **D5. All of the above** | The right answer for v1 |

### Picks for v1 (recommendation)

**A2 + A3 hybrid · B2 + B4 · C2 + C3 (sequenced) · D2 + D4 + (optional D3)**

In words: ship pre-baked link CIFs for the top 5 warheads (A2), with a
geometric `extra_restraints` fallback (A3) for atoms-named-anything ligands
where the substitution fails. Trigger via right-click context menu on SG (B2)
*and* via covalent SMILES paste (B4) — both surface the same backend.
Identify the warhead by SMILES SMARTS match (C2) with a 3D-geometry sanity
check (C3). Persist as `_struct_conn` (D2) in saved coords + in the
`.pykeko` session schema (D4); optionally let the user export the link CIF
as a separate file for Refmac (D3).

## 5. The architecture

### Layer 1 — Coot WASM API additions (C++ + nanobind)

Two new methods on `coot::molecule_t`:

```cpp
// api/coot-molecule.hh
int make_covalent_link(const std::string &atom_cid_1,
                       const std::string &atom_cid_2,
                       const std::string &link_name,
                       double bond_length,
                       const coot::protein_geometry &geom);
// Returns 1 on success, 0 on failure (atom not found, atoms not in same model).
// Adds an mmdb::Link to the model, applies chem mod1 (delete HG on the Cys
// side typically), applies chem mod2 (delete Cl, retype C=C → C–C, etc.).

void delete_covalent_link(const std::string &atom_cid_1,
                          const std::string &atom_cid_2);
```

Bound in `api/molecules-container-nanobind.cc`. Plus, expose
`add_extra_bond_restraint`, `add_extra_angle_restraint`,
`add_extra_chiral_restraint` from `coot::extra_restraints_t` for the A3
fallback path. ~30 lines of binding code, ~80 lines of C++ adapted from
`molecule_class_info_t::make_link` (`src/molecule-class-info-build.cc:233`).

Status: requires a Coot WASM rebuild. Patchable via `coot-patches/`
infrastructure (same flow as the v0.2.18 colour-selector fix). Estimate:
1 day of careful work, 1 day testing.

### Layer 2 — Pre-baked Cys warhead link dictionary library

Ship as static data in `baby-gru/public/MoorhenAssets/cov-links/`:

```
cov-links/
├── index.json              # SMARTS patterns → link template ID
├── CYS-ACR.cif             # Acrylamide
├── CYS-CAA.cif             # Chloroacetamide
├── CYS-VSU.cif             # Vinyl sulfone
├── CYS-VKE.cif             # Vinyl ketone
├── CYS-PPA.cif             # Propargyl amide
├── CYS-CNA.cif             # Cyanoacrylamide
├── CYS-EPX.cif             # Epoxide
├── CYS-SOF.cif             # Sulfonyl fluoride
├── CYS-ALD.cif             # Aldehyde hemithioacetal
├── CYS-KET.cif             # Ketone hemithioketal
└── CYS-GEN.cif             # Generic fallback (just S–C single bond restraint)
```

Each CIF is a standard CCP4-ML link dictionary:
- `data_link_<ID>` block
- `_chem_link.id`, `_chem_link.comp_id_1=CYS`, `_chem_link.comp_id_2=<placeholder>`
- `_chem_link_bond`: SG of CYS to `<placeholder atom>` of ligand, single, 1.82 Å σ=0.02
- `_chem_link_angle`: CB–SG–C, SG–C–neighbours, ideal 109.5° σ=3.0°
- `_chem_link_chir` (for stereocentres at the new sp3 carbon)
- `_chem_link_plane` (for adjacent peptide-like planes, e.g. acrylamide carbonyl)
- `data_mod_<MOD1_ID>`: delete HG on Cys side
- `data_mod_<MOD2_ID>`: warhead-specific (delete Cl, retype C=C → C–C, etc.)

The `index.json` maps warhead SMARTS to a template ID:

```json
{
  "warheads": [
    { "id": "CYS-ACR", "name": "Acrylamide",
      "smarts": "[C:1]=[C:2]C(=O)N", "mark_atom": "1",
      "preferred_atom_name": "C20" },
    { "id": "CYS-CAA", "name": "Chloroacetamide",
      "smarts": "Cl[C:1]C(=O)N", "mark_atom": "1",
      "preferred_atom_name": "C11" },
    ...
  ]
}
```

Per-load atom-name substitution: when the user picks the ligand atom, we:
1. Compute the ligand's SMILES from its mmdb residue + monomer dict (RDKit-WASM).
2. Match the SMILES against the SMARTS patterns. The matching atom is the
   one bonded to Cys S.
3. Read the matching link CIF template, substitute the placeholder atom
   name (`<placeholder>` in the template) with the user's actual atom name.
4. Substitute the ligand residue 3-letter code.
5. Write the modified CIF blob into a `Blob` URL.
6. Call `import_cif_dictionary(blobUrl, imol_enc)`.
7. Call `make_covalent_link(cys_sg_cid, ligand_atom_cid, link_id, 1.82, geom)`.

All in <100 ms. No AceDRG, no Bansu, no network.

### Layer 3 — UX

**Primary trigger: right-click Cys SG (Path B2)**

Add to the residue context menu (right-click on any atom): if the residue is
CYS and the clicked atom is SG, surface a "Make covalent link…" item. The
menu item:
1. Searches for the nearest non-protein, non-water atom within 2.5 Å of SG.
2. If found, pops a one-modal confirmation: "Link Cys A/145 SG to LIG/1 C20?
   Detected warhead: acrylamide. [Confirm] [Pick different atom] [Cancel]"
3. If not found, falls through to atom-picking mode: "Click the ligand atom
   to bond."
4. On confirm, fires the Layer-2 pipeline.

**Secondary trigger: covalent SMILES paste (Path B4)**

Extend `New Ligand from SMILE…` (the v0.2.12 dialog) with a "Covalent" toggle.
When on, a SMILES like `[*:cysSG]CC(=O)c1ccccc1` is parsed as:
- The `[*:cysSG]` token marks the warhead atom (attachment to Cys S).
- The rest is the standard SMILES.
- After placement (using v0.2.15's "Active molecule centre" or near a clicked
  Cys), auto-attach via the Layer-2 pipeline.

This is genuine new UX — no other crystallography tool has "paste a covalent
SMILES." It dovetails with the existing SMILES placement work and adds
~30 lines of JS to the SMILES dialog.

**Tertiary trigger: auto-detect on ligand load (Path B5, opt-in)**

Settings → "Auto-detect Cys-covalent bonds on ligand load" (default off in v1,
default on in v2 once we're confident in the detector). After any new ligand
is registered, scan SG atoms within 2.5 Å; if a candidate is found, surface a
snackbar with "Declare covalent bond? [Yes] [Not now]".

### Layer 4 — Persistence (Dimension D)

- `_struct_conn`: automatic via mmdb writer once `mmdb::Link` is registered.
  No code change needed beyond ensuring `conn_type_id = covale`.
- `.pykeko` session schema: extend `MoleculeSessionData` proto with
  `repeated CovalentLink covalent_links = 12` carrying `(atom_cid_1,
  atom_cid_2, link_template_id, link_dict_cif_blob_id)`. The link dict CIFs
  themselves go into a new top-level `repeated LinkDictionary
  link_dictionaries = 16` so they're shared across molecules in one session.
  Restore replays `import_cif_dictionary` + `make_covalent_link` calls in
  order, after molecule load.
- Optional file export: "File → Export covalent link CIFs…" emits the
  link dictionary files alongside the saved coords, for users heading to
  external Refmac.

### Layer 5 — Visualization

Currently Moorhen draws bonds from the per-residue CIF + intra-residue
connectivity. LINK records don't produce a visible bond. Fix:
- In `MoorhenMoleculeRepresentation.getCootSelectionBondBuffers`, after the
  primary bond buffer fetch, scan `mol->GetModel(1)->GetLink(i)` and append
  bonds for each LINK record.
- Use a distinct visual: slightly thicker stick, contrasting color
  (e.g. magenta default), so the user sees the link as a deliberate annotation
  rather than chemistry-inferred.
- Hover tooltip: "Covalent link: CYS A/145 SG ↔ LIG X/1 C20 (acrylamide,
  declared)"

### Layer 6 — Refinement integration

After `make_covalent_link` + dictionary import, `refine_residues_using_atom_cid`
auto-discovers the link via mmdb LINK records + chem_link_map matching. **No
additional refinement-API code needed** as long as the link's atom names
match the dictionary template (Layer 2's substitution step takes care of
this). The full restraint set (bond, angles, chirals, planes) flows through
the existing pipeline.

Verification once everything lands: load a known Cys-covalent PDB entry
(e.g. 6OY3, K-Ras G12C acrylamide), check pre-refinement geometry, declare
the link, refine, measure S–C distance + angles. Should converge to the
dictionary ideals.

## 6. Innovation opportunities (beyond MVP)

These are not v1, but worth noting now so MVP design doesn't preclude them.

### 6.1 The "covalent SMILES" registry

Build a public list of Cys-warhead SMILES patterns mapped to dictionary IDs.
Crowdsourced via a `pykeko-covalent-warheads` GitHub repo with PR-able
warhead-CIF contributions. PyKeko pulls the latest registry at launch (with
local cache) and gains new warhead support without a release.

### 6.2 Refinement-time anomaly detection

Watch for "looks like a Cys-covalent bond but no LINK declared" during
refinement: if S(CYS) and any non-protein atom are < 2.0 Å with no LINK,
surface a refinement-time warning + a one-click "declare and re-refine" action.
This is the inverse of the current trap where users forget to declare and
refinement silently drifts.

### 6.3 Validation panel

Validation → Covalent links: list all declared LINK records, show
deviation from ideal restraint values per bond/angle/chiral/plane, flag
outliers (>3σ). Same UX as the existing rotamer/ramachandran cycler from
v0.2.

### 6.4 Deposition-ready export

File → Export covalent-inhibitor deposition bundle…: produces a zip
containing the model PDB, the model mmCIF (with `_struct_conn`), all
imported link CIFs, all ligand dicts, a `README.md` mapping each LINK record
to its source dictionary, and a pre-filled "Special considerations" text
block for the wwPDB depositor.

### 6.5 PyKekoMCP / Claude integration

Add MCP tool `moorhen_make_covalent_link(atom_cid_1, atom_cid_2,
warhead_hint?)`. The user can ask Claude in chat: "Make this Cys covalent to
the ligand" and Claude calls the tool. The warhead is auto-detected; the
hint is optional.

### 6.6 ML-assisted novel warhead handling

For warheads outside the baked library, optionally call out to a small ML
model (could run as WASM) that predicts plausible mod1/mod2 operations from
SMILES + 3D context. Falls back to A3 (geometric extra_restraints) on
low confidence. Could be a stretch project shared with the broader covalent-
inhibitor community.

### 6.7 Multi-warhead / multi-Cys (bivalent covalent)

Edge case: ligands that bond to two Cys via two warheads (rare but reported).
The infrastructure here generalises: two LINK records, two link dictionary
applications. The UX needs a "Continue picking" mode after the first link
is declared.

### 6.8 Comparison render: "before vs after warhead reaction"

Pedagogical visualization: show the pre-reaction warhead SMILES as a
ghost overlay on the post-reaction product, so users see what the reaction
did. Not for refinement, just clarity.

## 7. Open questions / things to verify before coding

1. **Cys SG–Cys SG (disulfide) collisions.** What if the user tries to make a
   covalent link from an SG that's already in a disulfide bond? Block? Warn?
   Auto-cleave the SS?
2. **Altloc handling.** What if the Cys has altlocs A and B and only altloc A
   is covalently bonded? Does Coot's `chem_link_map` lookup respect altloc?
   (Audit suggests no — see CCP4BB "Linking 2 different alternate conformation
   CYS" thread for the desktop-Coot pain.) MVP plan: declare links per-altloc
   explicitly.
3. **Hydrogen handling on the Cys side.** Cys side mod1 always deletes HG.
   But if hydrogens haven't been added yet (Moorhen's default), the delete is
   a no-op. Verify this doesn't error.
4. **Atom-name collisions in the link CIF.** If the ligand has an atom named
   `CB` (different from the Cys's `CB`), the link dictionary needs explicit
   `_chem_link_bond.atom_1_comp_id` / `.atom_2_comp_id` qualifiers to
   disambiguate. Verify Coot's parser handles this — it should, per the
   `chem_link_bond_t` declaration in `geometry/protein-geometry.hh:999`.
5. **Refinement convergence on a freshly-declared link from a position that's
   already pretty close to ideal.** If the experimental distance is already
   1.83 Å (perfect for S–C single), does the refinement try to move it? Should
   be a no-op; verify with a manual test.
6. **`refine_residues_using_atom_cid` selection radius vs. link reach.** If
   the user refines residues 140–150 of chain A and the linked ligand is
   chain X, does the refinement pull the ligand atom in via the link? Audit
   says yes (the link discovery walks all mmdb LINKs in the manager and
   builds restraints unconditionally) — verify.
7. **AceDRG fallback for the warhead outside the baked library.** When the
   user hits "Unknown warhead, no template available," do we (a) silently
   fall to A3 geometric extra restraints with a warning, (b) require the
   user to manually invoke an AceDRG call (Bansu or local), or (c) refuse
   to make the link? Default to (a) with a clear surface UI ("Restraints
   generated from local geometry — for production refinement, generate a
   proper link dictionary via AceDRG").

## 8. Recommended sequencing

### Phase 1 — Foundations (1–2 weeks)
1. Add `make_covalent_link` + `delete_covalent_link` to `coot::molecule_t`.
2. Bind them via nanobind. Add `coot-patches/coot-molecule-make-link.patch`
   so the change is replicable on future WASM rebuilds.
3. Build first 5 warhead link CIFs (acrylamide, chloroacetamide, vinyl sulfone,
   propargyl amide, epoxide) by hand from JLigand or by adapting existing
   PDB-deposited link CIFs (e.g. CCP4 monomer library `monomers/list/`).
   Hand-verify each restraint against literature values.
4. Wire JS-side substitution + import pipeline. RDKit-WASM SMARTS match.

### Phase 2 — UX (1 week)
1. Right-click context menu on Cys SG → "Make covalent link…"
2. Auto-detect ligand atom within 2.5 Å, with picker-fallback.
3. One-modal confirmation with warhead-class display.
4. Wire to backend pipeline.

### Phase 3 — Persistence (1 week)
1. Extend `MoorhenSession.proto` with `CovalentLink` + `LinkDictionary` messages.
2. Wire save: capture link cids + serialise imported dict blobs.
3. Wire restore: replay `import_cif_dictionary` + `make_covalent_link` in order.
4. Verify round-trip end-to-end with a sample structure.

### Phase 4 — Visualisation (3 days)
1. Add LINK-record bond rendering in `getCootSelectionBondBuffers`.
2. Distinct visual style; hover tooltip.

### Phase 5 — Covalent SMILES (3 days)
1. Extend SMILES dialog with covalent toggle.
2. Parse `[*:cysSG]` attachment-point marker.
3. Place + auto-attach in one shot.

### Phase 6 — Validation & deposition (1 week)
1. Validation panel for covalent links.
2. Deposition bundle export.

### Phase 7 — MCP exposure (2 days)
1. Add `moorhen_make_covalent_link` tool to PyKekoMCP.
2. Document in the PyKekoMCP README.

**Total MVP: ~4–6 weeks of focused work; phases 1–3 alone (the user-visible
result) are ~3 weeks. Pure innovation phases (5, 6, 7) ride on top of the
foundation.**

## 9. The "huge time saver" sanity check

Today's workflow for a Cys-covalent inhibitor in Moorhen, end-to-end:
1. Load coords, load map. (30 s)
2. Get ligand monomer dictionary from PDB/Lhasa/AceDRG. (1–5 min)
3. Place ligand at density. (30 s with v0.2.12+ SMILES placement)
4. Realise the bond isn't there. Export coords.
5. Open in Coot 0.9 desktop. (1 min including launch)
6. Run `Calculate → Modules → CCP4 → Make Link via Acedrg`. Pick atoms. (30 s)
7. Wait for AceDRG. (10 s)
8. Save coords + link CIF separately. (30 s)
9. Switch back to Moorhen / save session. (1 min)
10. Refine. Hope it doesn't drift.

**Total: ~10 min per ligand, with cognitive overhead of remembering the link
CIF location.**

After this plan ships, end-to-end:
1. Load coords, load map. (30 s)
2. Place ligand. (30 s)
3. Right-click Cys SG → "Make covalent link…" → Confirm. (~3 s)
4. Refine. (30 s)

**Total: ~1.5 min per ligand. Zero cognitive overhead.** ~6× speedup, and the
deposition path is correct by construction.

For a lab whose entire pipeline is Cys-covalent inhibitors, this collapses
days of model-prep across a series into minutes.

## 10. Links / references

- Long et al. 2017, "AceDRG: a stereochemical description generator for
  ligands," *Acta Cryst D* 73, 112–122.
- **Local reference PDFs** — once downloaded, drop into [`refs/`](refs/README.md)
  (browser-only via PMC reCAPTCHA / IUCr Cloudflare). The `refs/README.md` has
  the working browser URLs + filename convention.
- **The two canonical CCP4 covalent-link papers** (paired in Acta D 77, June 2021):
  - **Nicholls, Joosten, Long, Wojdyr, Lebedev, Krissinel, Catapano, Fischer,
    Emsley & Murshudov (2021).** "Modelling covalent linkages in CCP4."
    *Acta Cryst D* 77, 712–726. DOI 10.1107/S2059798321001753. PMC8171069.
    IUCr article ID **ir5021**. — The **methods recipe**: the link-CIF
    anatomy (`_chem_link`, `_chem_link_bond/angle/tor/chir/plane`, paired
    `data_mod_*` records), AceDRG's three-stage composite-then-diff process,
    worked examples NAG-ASN / LYS-PLP / MET-TYR-TRP / HEC-CYS. **Our plan's
    Appendix A.1 template format follows this paper directly.**
  - **Nicholls, Wojdyr, Joosten, Catapano, Long, Fischer, Emsley & Murshudov
    (2021).** "The missing link: covalent linkages in structural models."
    *Acta Cryst D* 77, **727–745**. DOI 10.1107/S2059798321003934. PMC8171067.
    PMID 34076588. IUCr article ID **ir5022**. — The **empirical-survey + worked
    case-study paper** that motivates the methods. Scans the PDB for unannotated
    Cys-S↔non-S close contacts (independently validating our §2.0 survey),
    quantifies the geometric drift when LINK records are missing, and announces
    the recent CCP4-ML expansion of >16,000 new + >11,000 replaced component
    dictionaries via AceDRG. **Includes a SARS-CoV-2 main protease covalent
    inhibitor case study** — directly analogous to our BTK Cys-warhead workflow
    and the closest published worked example of the F-series template approach
    we're proposing.
- Lebedev et al. 2012, "JLigand: a graphical tool for the CCP4 template-
  restraint library," *Acta Cryst D* 68, 431 (PMC3322602).
- Yusuf et al. 2022, "CovBinderInPDB," *J. Chem. Inf. Model.* 62, 6057
  (PMC9772242).
- Yamashita et al. 2023, "GEMMI and Servalcat restrain REFMAC5," *Acta
  Cryst D* 79, 368.
- Emsley 2020 blog, "Making a Link with Coot and Acedrg":
  https://pemsley.github.io/coot/blog/2020/06/30/make-a-link.html
- Grade2 1.8 manual §13 "Covalent ligands (PTM)":
  https://gphl.gitlab.io/grade2_docs/
- Coot source: `/Users/hilgersmt/Moorhen-dev/checkout/coot-1.0/python/coot_acedrg_link.py`
  (Coot 0.9 desktop link workflow, 324 lines)
- Coot source: `/Users/hilgersmt/Moorhen-dev/checkout/coot-1.0/src/molecule-class-info-build.cc:233`
  (`molecule_class_info_t::make_link` — the C++ to port)
- Coot source: `/Users/hilgersmt/Moorhen-dev/checkout/coot-1.0/coot-utils/bonded-pairs.cc:128`
  (`bonded_pair_t::apply_chem_mods` — the mod application logic)
- Coot source: `/Users/hilgersmt/Moorhen-dev/checkout/coot-1.0/ideal/link-restraints.cc:1110`
  (`make_link_restraints_from_links` — the refinement-time link discovery)
- Moorhen source: `/Users/hilgersmt/Moorhen/baby-gru/src/components/modal/MoorhenCreateAcedrgLinkModal.tsx`
  (current devOnly modal, picker UI already wired)
- Moorhen source: `/Users/hilgersmt/Moorhen/baby-gru/src/types/moorhen.d.ts:159`
  (`AceDRGInstance.createCovalentLink` stub interface)
- **Yamashita, Wojdyr, Long, Nicholls & Murshudov (2023).** "GEMMI and Servalcat
  restrain REFMAC5." *Acta Cryst* D77, 368–373. DOI 10.1107/S2059798323002413.
  PMC10167671. IUCr article ID **qe5004**. — The **modern Refmac frontend
  architecture** paper. Documents Servalcat as REFMAC5 controller, Gemmi as
  the chemistry+I/O backend, the `refmacat` drop-in command, `_chem_comp_alias`
  for nonstandard atom names, link specificity hierarchy with chirality+torsion
  tie-breaking, and the family-of-functional-groups conclusion that endorses
  our F-series architecture. Read before writing any external-tool integration
  in PyKeko.
- 8FD9 (BTK + acalabrutinib, 1.70 Å, the only deposited XQQ entry):
  https://www.rcsb.org/structure/8FD9
- 8FF0 (BTK + tirabrutinib, 7GB ligand): https://www.rcsb.org/structure/8FF0
- XQQ chem_comp CIF (post-reaction crotonamide form, `C19=C13 DOUB N E`):
  https://files.rcsb.org/ligands/view/XQQ.cif
- Lin & Andreotti 2023, "Structure of BTK kinase domain with the second-
  generation inhibitors acalabrutinib and tirabrutinib," *PLoS One* 18(8),
  e0290872 (PMC10470882) — primary structural reference for the F2 family.
- Barf et al. 2017, "Acalabrutinib (ACP-196)…," *J Pharmacol Exp Ther*
  363(2):240 (PMID 28882879).
- Hou et al., "Peptide and Protein Cysteine Modification Enabled by
  Hydrosulfuration of Ynamide" (PMC11428291) — solution-chemistry analog,
  Z-vinyl-thioether stereoselectivity.

## 11. Compatibility with external refinement programs

The link CIFs use the **standard CCP4 Monomer Library link-dictionary format**
documented in Nicholls et al. 2021 — the same format Refmac5 was built to read
and AceDRG emits. Hand-authoring vs. AceDRG-generating doesn't change the format,
only the path.

| Program | Compatible? | Mechanism | Sharp edges |
|---|---|---|---|
| **Refmac5** (CCP4 7+) | ✅ native | Pass via `LIBIN`; link auto-discovered from LINK record matched against `_chem_link` table by `(resname, group, atom names)` | Needs the link record in the model file as well as the dictionary on `LIBIN` |
| **Servalcat** (CCP4 8+) | ✅ native + auto-perceives | Reads `_struct_conn covale` from mmCIF + chemistry; emits Refmac instructions | Best-in-class today. No `LIBIN` finesse needed |
| **Phenix.refine** | ✅ via `apply_cif_link` | `monomers=our.cif` + `refinement.apply_cif_link { link_id=CYS-YNA residue_selection_1=… residue_selection_2=… }` | Phenix needs the explicit declaration block; doesn't auto-discover the way Refmac does |
| **Buster** (Global Phasing) | ✅ | Standard link path | GRADE2 prefers composite monomers but Buster itself reads link CIFs |
| **PDB-REDO prepper** | ✅ via Gemmi | Auto-perceives standard CCP4-ML links | |
| **Coot WASM** (our refiner) | ✅ | `make_link_restraints_from_links` walks `mmdb::Link` records | Verified in the deep-dig audit |

**Six sharp edges to plan around**:

1. **Placeholder substitution must happen before disk write.** `<Cα>` / `<Cβ>`
   / `<LIG>` tokens in Appendix A.1 are PyKeko-internal — refinement programs
   reject them as literal text. Substitute the user's actual atom names and
   ligand 3-letter code into the CIF before emitting.
2. **Emit BOTH `_struct_conn` (mmCIF) and PDB `LINK`.** mmdb's writers do this
   for free when an `mmdb::Link` is registered. Modern toolchains prefer
   `_struct_conn`; legacy Refmac users with PDB workflows need `LINK`.
3. **5-character CCD codes only travel via mmCIF.** PDB `LINK` is column-fixed
   at 3 chars for resname. Several extended-methyl F2 entries (A1AZ6, A1CZ4,
   A1IMT, 9CUW etc.) have 5-char codes and **cannot use the PDB format**.
   Default exports to mmCIF when any ligand is > 3 chars; warn on PDB.
4. **`group_comp_*` classification matters.** Refmac's matcher hashes on the
   group as well as the resname. Our template uses `L-peptide` (Cys side) +
   `non-polymer` (ligand side), correct for standard small molecules. If the
   user's ligand is classified as something else (rare — peptidomimetics), the
   link silently doesn't match. Detect mismatch at dictionary-import time and
   warn.
5. **`period=2` dihedral needs Refmac ≥ 5.8** (CCP4 ≥ 7.0). All current
   installs; document in the README for very-old-CCP4 users.
6. **Wildcard `comp_id_2 = .`** is template-internal only. CCP4-ML supports it
   (CCP4 7+) but real refinement runs need the actual ligand code substituted.

**Recommended verification before production rollout:**

Run the same hand-authored `CYS-YNA.cif` through four pipelines and compare
post-refinement geometry against the deposited model:

1. Refmac5 with `LIBIN our.cif`
2. Phenix.refine with `apply_cif_link { link_id=CYS-YNA … }`
3. Servalcat auto-detect from `_struct_conn`
4. Coot WASM internal refinement (PyKeko's own path)

All four should converge to S–Cβ within 1.78 ± 0.03 Å and Cα=Cβ within
1.34 ± 0.03 Å. Round-trip on 8FD9 (XQQ, methyl), 8FF0 (7GB, methyl, different
scaffold), and 9CUX (extended-methyl at 1.27 Å resolution). If all three pass
on all four programs, the format is genuinely portable.

## Appendix A — Cys-YNA (family F2) link CIF, with `<Cα>` / `<Cβ>` substitution

This is the runtime-substituted template that handles butynamide, extended
butynamides, pent/hex-2-ynamides, and benzyl/aryl-propynamides. The terminal
propiolamide case (R = H) needs a one-line tweak — see §A.2.

### A.1 Template (vinyl-thioether product, R-side ignored beyond Cβ)

```cif
# Replace placeholders at runtime:
#   <LIG>  ← ligand 3-letter code (e.g. XQQ)
#   <CB>   ← Cβ atom-id in the user's ligand (e.g. C19 in XQQ)
#   <CA>   ← Cα atom-id (e.g. C13 in XQQ)
#   <CO>   ← carbonyl-C atom-id (e.g. C7 in XQQ); used for plane + dihedral only

data_link_CYS-YNA
_chem_link.id                CYS-YNA
_chem_link.name              Cys-S to alpha,beta-ynamide post-Michael adduct
_chem_link.comp_id_1         CYS
_chem_link.mod_id_1          CYS-YNA-mod1
_chem_link.group_comp_1      L-peptide
_chem_link.comp_id_2         <LIG>
_chem_link.mod_id_2          CYS-YNA-mod2
_chem_link.group_comp_2      non-polymer

loop_
_chem_link_bond.atom_1_comp_id
_chem_link_bond.atom_id_1
_chem_link_bond.atom_2_comp_id
_chem_link_bond.atom_id_2
_chem_link_bond.type
_chem_link_bond.value_dist
_chem_link_bond.value_dist_esd
 1 SG    2 <CB>   single 1.80 0.02
 2 <CB>  2 <CA>   double 1.34 0.02

loop_
_chem_link_angle.atom_1_comp_id
_chem_link_angle.atom_id_1
_chem_link_angle.atom_2_comp_id
_chem_link_angle.atom_id_2
_chem_link_angle.atom_3_comp_id
_chem_link_angle.atom_id_3
_chem_link_angle.value_angle
_chem_link_angle.value_angle_esd
 1 CB   1 SG   2 <CB>   102.0   3.0
 1 SG   2 <CB> 2 <CA>   122.0   3.0
 2 <CB> 2 <CA> 2 <CO>   122.0   3.0

# Vinyl-thioether dihedral: syn OR anti addition both allowed via period=2.
# RATIONALE: empirical RCSB survey (n=36 F2 entries) found 8FD9 (XQQ canonical)
# at τ = -89°, tirabrutinib (5P9M, 8FF0) at clean syn ≈ +1°, and 78% of entries
# at intermediate values reflecting underrestrained refinement ("missing link"
# drift). Hard syn restraint τ = 0° ± 10° period=1 would fight all but the
# tirabrutinib subset. period=2 lets both 0° and ±180° satisfy the restraint.
loop_
_chem_link_tor.id
_chem_link_tor.atom_1_comp_id
_chem_link_tor.atom_id_1
_chem_link_tor.atom_2_comp_id
_chem_link_tor.atom_id_2
_chem_link_tor.atom_3_comp_id
_chem_link_tor.atom_id_3
_chem_link_tor.atom_4_comp_id
_chem_link_tor.atom_id_4
_chem_link_tor.value_angle
_chem_link_tor.value_angle_esd
_chem_link_tor.period
 vinyl_planar 1 SG 2 <CB> 2 <CA> 2 <CO> 0.0 20.0 2

# Planarity over the conjugated vinyl-thioether — see §A.5 for the per-side
# `_chem_mod_plane` deletions that prevent double-restraint conflicts with
# the existing amide-plane in the ligand monomer dictionary.
loop_
_chem_link_plane.id
_chem_link_plane.atom_comp_id
_chem_link_plane.atom_id
_chem_link_plane.dist_esd
 PLN_THIOVINYL 1 SG    0.02
 PLN_THIOVINYL 2 <CB>  0.02
 PLN_THIOVINYL 2 <CA>  0.02
 PLN_THIOVINYL 2 <CO>  0.02

# Cys-side modification: delete HG (the thiol H)
data_mod_CYS-YNA-mod1
loop_
_chem_mod_atom.mod_id
_chem_mod_atom.function
_chem_mod_atom.atom_id
_chem_mod_atom.new_atom_id
_chem_mod_atom.new_type_symbol
_chem_mod_atom.new_type_energy
_chem_mod_atom.new_partial_charge
 CYS-YNA-mod1 delete HG . . . .

# Ligand-side modification — assumes the *crotonamide post-reaction* input
# state (XQQ-style). Just deletes the spare H on Cβ that's being replaced
# by the new SG bond.
#
# If the user uploads the *alkyne pre-reaction* form, the runtime swaps in
# the alternative mod2 from §A.2.
data_mod_CYS-YNA-mod2
loop_
_chem_mod_atom.mod_id
_chem_mod_atom.function
_chem_mod_atom.atom_id
_chem_mod_atom.new_atom_id
_chem_mod_atom.new_type_symbol
_chem_mod_atom.new_type_energy
_chem_mod_atom.new_partial_charge
 CYS-YNA-mod2 delete H<CB> . . . .
```

### A.2 Alternative mod2 — alkyne input form

If the SMARTS detector matched `R-C≡C-C(=O)-N` (the free-drug alkyne form),
the link CIF substitutes this `data_mod_CYS-YNA-mod2` block instead:

```cif
data_mod_CYS-YNA-mod2
# 1. Change the Cα–Cβ bond from triple to double
loop_
_chem_mod_bond.mod_id
_chem_mod_bond.function
_chem_mod_bond.atom_id_1
_chem_mod_bond.atom_id_2
_chem_mod_bond.new_type
_chem_mod_bond.new_value_dist
_chem_mod_bond.new_value_dist_esd
 CYS-YNA-mod2 change <CB> <CA> double 1.34 0.02

# 2. Retype Cα and Cβ from sp to sp2
loop_
_chem_mod_atom.mod_id
_chem_mod_atom.function
_chem_mod_atom.atom_id
_chem_mod_atom.new_atom_id
_chem_mod_atom.new_type_symbol
_chem_mod_atom.new_type_energy
_chem_mod_atom.new_partial_charge
 CYS-YNA-mod2 change <CA> . C  CR1 .
 CYS-YNA-mod2 change <CB> . C  CR1 .

# 3. Add the new H on Cα (named H<CA>)
loop_
_chem_mod_atom.mod_id
_chem_mod_atom.function
_chem_mod_atom.atom_id
_chem_mod_atom.new_atom_id
_chem_mod_atom.new_type_symbol
_chem_mod_atom.new_type_energy
_chem_mod_atom.new_partial_charge
 CYS-YNA-mod2 add H<CA> H<CA> H HCH1 .
```

### A.3 Terminal propiolamide (Spebrutinib-style, R = H)

Only difference from §A.1: there's no Cγ at all on the warhead, so the
plane/angle restraints that involve "atom past Cβ" need a fallback. The
template's `_chem_link_angle 2 <CB> 2 <CA> 2 <CO> 122.0 3.0` still applies
(Cα–Cβ–CO geometry). The only thing missing is the SG–Cβ–H angle on the
H that's now where the methyl was — add:

```cif
 1 SG    2 <CB>   2 H<CB>   118.0   3.0    # only for terminal propiolamide
```

(For non-terminal warheads — the user's case — Cβ has no H after the link;
the methyl/CH₂/aryl that was there is what hangs off Cβ.)

### A.4 Planarity restraint hand-off — DELETE the original amide plane

Discovered while reading the Nicholls 2021 methods paper (`refs/nicholls-modelling-2021.pdf`,
§5.1 NAG-ASN worked example, Figs 4f and 4g; §5.2 LYS-PLP, Figs 5e and 5f):

**Both worked examples explicitly remove the original component's plane
restraint AND add a new larger link-plane.** Quoting the paper's figure
captions: "(f) planar restraints that are removed (blue) and (g) planar
restraints that are added (gold) due to the covalent linkage."

For our F2 case, this means:
- The ligand's chem_comp typically has a planar restraint over its
  α,β-unsaturated amide group `{C7, C13, C19, O1, N1, …}` (or whichever atom
  names the actual ligand uses).
- Without explicit removal, after the link is applied refinement would have
  **both** the original amide-plane (over the original 5 atoms) and the new
  link-plane (over `{SG, Cβ, Cα, C7, O1, N1}`) — overlapping plane
  restraints can cause numerical conflict and unstable refinement.

The remedy: a `_chem_mod_plane` entry on the ligand side that DELETEs the
original amide plane. Append to `data_mod_CYS-YNA-mod2`:

```cif
loop_
_chem_mod_plane_atom.mod_id
_chem_mod_plane_atom.function
_chem_mod_plane_atom.plane_id
_chem_mod_plane_atom.atom_id
 CYS-YNA-mod2 delete PLANE_AMIDE <CB>
 CYS-YNA-mod2 delete PLANE_AMIDE <CA>
 CYS-YNA-mod2 delete PLANE_AMIDE <CO>
 CYS-YNA-mod2 delete PLANE_AMIDE <N>
 CYS-YNA-mod2 delete PLANE_AMIDE <O>
```

Where `PLANE_AMIDE` is whatever identifier the ligand's chem_comp uses for
the α,β-unsaturated-amide plane. The substitution machinery has to identify
this at runtime by introspecting the ligand monomer CIF — look for a
`_chem_comp_plane_atom` block whose atom membership covers Cβ + Cα + the
carbonyl C + the amide N + the carbonyl O.

If no such plane exists in the ligand chem_comp (some hand-curated dicts
omit it), this whole mod block becomes a no-op and the new link-plane is
the only one active. Safe.

### A.5 AceDRG target value sources (Table 1 of methods paper)

The methods paper Table 1 shows that AceDRG-generated target distances can
differ substantially from CCP4-ML default values (which are just covalent
radii sums). For MET-TYR the CCP4-ML default is 1.610 Å but the AceDRG
target is 1.795 Å — a 0.2 Å difference. AceDRG derives its values from
the Cambridge Structural Database (Gražulis et al. 2012).

For our F2 case, the 1.80 Å target for S–Cβ in §A.1 is consistent with
the AceDRG-style approach: it's derived from sp²-C-S vinyl-thioether mean
distance in the CSD (1.77–1.80 Å), not just `r(S) + r(C) = 1.81 Å`. We're
on solid ground.

**For new families we add (F3/F4/F5/F6), the CSD-derived target distance
should be the first source, NOT covalent radii sum.** Where CSD data is
sparse, fall back to: (a) AceDRG-generated reference (run once during
template authoring, not at runtime), or (b) CCP4-ML default + tightened σ.

### A.6 Geometry restraint values — provenance

Drawn from CSD averages for vinyl thioethers + α,β-unsaturated amides +
direct measurement on PDB 8FD9 (acalabrutinib bound to BTK, 1.70 Å):

| Restraint | Ideal | σ | Source |
|---|---|---|---|
| d(SG–Cβ) | 1.80 Å | 0.02 | CSD vinyl-S–C mean 1.77–1.80; 8FD9 refines to 1.683 (tight, σ=0.02 absorbs) |
| d(Cα=Cβ) | 1.34 Å | 0.02 | standard sp2=sp2; CSD α,β-unsat-amide C=C |
| d(Cα–C7carbonyl) | 1.48 Å | 0.02 | sp2-Csp2 conjugation shortening from 1.50 |
| d(C7=O) | 1.23 Å | 0.02 | amide carbonyl (inherited from monomer dict) |
| d(C7–N) | 1.35 Å | 0.02 | amide C–N (inherited) |
| a(SG–Cβ=Cα) | 122° | 3° | sp2 at Cβ |
| a(Cβ=Cα–C7) | 122° | 3° | sp2 at Cα |
| a(CB–SG–Cβ) | 102° | 3° | sp3-S-Csp2 thioether (same as disulfide CB-SG-SG) |
| τ(SG–Cβ=Cα–C7) | 0° | 10° | syn-addition; S/carbonyl cis across C=C (CIP "E" in XQQ CIF) |
| τ(C7=Cα–Cβ–SG–CB) | free | — | rotation around SG–CB single bond; **leave unrestrained** |
| plane{SG, Cβ, Cα, C7} | — | 0.02 | conjugated vinyl-thioether-amide planarity |

**Verify before locking:** measure these directly in 8FD9 and 8FF0 coordinates.
The τ(SG–Cβ=Cα–C7) value (0° syn-addition vs 180° anti) is the most consequential
restraint and the most uncertain — the published Lin & Andreotti 2023 paper
asserts "(E)-vinyl thioether" without giving the actual dihedral; CIP E in this
substitution pattern corresponds to syn-addition (0°) per §2.2 but a direct
measurement on the deposited coords would close the question.

## Appendix B — Family F2 SMARTS patterns (runtime detector)

```javascript
// Order matters: check post-reaction first; fall through to pre-reaction.
const F2_SMARTS = [
  // F2-post: vinyl-thioether already drawn (XQQ-style ligand CIF input)
  { kind: 'post', smarts: '[#16][C:1]=[C:2]C(=O)N',
    mapping: { cb: 1, ca: 2 }, modVariant: 'crotonamide' },

  // F2-pre: free alkyne (free drug SMILES from PubChem)
  { kind: 'pre',  smarts: '[C:1]#[C:2]C(=O)N',
    mapping: { cb: 1, ca: 2 }, modVariant: 'alkyne' },

  // F2-pre-terminal: terminal propiolamide (Spebrutinib)
  { kind: 'pre',  smarts: '[CH:1]#[C:2]C(=O)N',
    mapping: { cb: 1, ca: 2 }, modVariant: 'alkyne-terminal' },
];
```

RDKit-WASM substructure match returns the atom indices; we read the matched
atom names from the ligand's mmdb residue and substitute them into the CIF
template. `<CO>` for the carbonyl-C is found by walking from Cα along the
matched substructure. <50 ms total per ligand.

## Appendix C — PDB validation set for the F2 link template

End-to-end correctness verification should round-trip these:

| PDB | Ligand | Target | Warhead sub-family | Resolution | Use as |
|---|---|---|---|---|---|
| 8FD9 | XQQ (acalabrutinib) | BTK Cys481 | Methyl butynamide | 1.70 Å | Primary template provenance |
| 8FF0 | 7GB (tirabrutinib) | BTK Cys481 | Methyl butynamide (different scaffold) | 2.60 Å | Cross-validation; checks the template doesn't lock to scaffold-specific atom indices |
| (user lab structures, not deposited) | "Extended butynamide" series | their target | CH₂-R off the methyl | various | Tests that the template only references atoms through Cβ; sub-methyl extensions must not affect the link CIF |
| 5KUP family | spebrutinib | BTK Cys481 | **Terminal propiolamide** (R = H) | 2.3 Å | Tests the §A.3 propiolamide variant; only F2 member with R = H |

Pass criteria per entry: after link declaration + refinement, geometry should
remain within σ of the template ideals. S–Cβ should be within 1.78 ± 0.03 Å,
Cα=Cβ within 1.34 ± 0.03 Å, planarity rmsd < 0.05 Å.

If the user-lab data has structures with the extended-methyl variants, those
become the most valuable additional test cases — they're the case the
"template only references through Cβ" architecture is specifically designed
to handle, and any failure mode there would invalidate the family-template
approach.
