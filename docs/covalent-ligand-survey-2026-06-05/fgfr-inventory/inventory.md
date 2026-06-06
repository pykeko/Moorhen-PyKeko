# FGFR1/2/3/4 Cys-S covalent ligand inventory

Generated 2026-06-06 from RCSB Search + Data GraphQL APIs.
Selection: any PDB entry whose polymer is mapped to UniProt P11362 (FGFR1),
P21802 (FGFR2), P22607 (FGFR3), or P22455 (FGFR4) — plus the four mouse
orthologs — *and* whose `_struct_conn` carries a Cys-SG → ligand-atom bond at
distance < 2.0 Å.

Family taxonomy mirrors `~/Moorhen/docs/covalent-ligand-plan.md`:

- **F1** = α,β-unsaturated amide (acrylamide-style); 'pre' = deposited as
  prop-2-enamide/prop-2-en-1-one (visible C=C), 'post-Michael' = deposited
  as saturated propanamide / propanoyl (C=C → C-C, S adduct on Cβ).
- **F2** = α,β-ynamide (butynamide / pent/hex-2-ynamide / terminal propynamide)
  — the user's lab focus.
- **F4** = activated CH₂-X / SNAr (Sn2 / aromatic Cl displacement).
- **F6** = reversible carbonyl (aldehyde, trifluoromethyl ketone, α-ketoamide).
- **Nitrile-reversible** = thiohemiamidate adduct off a benzonitrile.

⭐⭐⭐ = F2 (canonical butynamide / ynamide). ⭐⭐ = F1 deposited pre-Michael
(acrylamide visible). ⭐ = F1 deposited post-Michael (saturated propanamide;
F1/F2-ambig without SMILES of parent compound). · = other warhead families.

## Headline numbers

- **Total FGFR Cys-covalent entries: 58**
- F1 (acrylamide-class): **42** (12 pre-Michael acrylamide visible; 30 post-Michael saturated propanamide)
- F2 (ynamide-class): **0** — no butynamide/ynamide is deposited covalently to any of the four FGFRs
- F4 (SNAr / Sn2): 7
- F6 (reversible carbonyl): 4
- Nitrile-reversible: 5

### Per-target headline

| Target | Total Cys-cov | F1 pre | F1 post | F2 | F4 | F6 | Nitrile | UniProt |
|--------|---------------|--------|---------|----|----|----|---------|---------|
| FGFR1 | 11 | 4 | 7 | 0 | 0 | 0 | 0 | P11362 |
| FGFR2 | 11 | 1 | 10 | 0 | 0 | 0 | 0 | P21802 |
| FGFR3 | 5 | 2 | 3 | 0 | 0 | 0 | 0 | P22607 |
| FGFR4 | 31 | 5 | 10 | 0 | 7 | 4 | 5 | P22455 |

## FGFR1 — 11 covalent entries

| ⭐ | PDB | Year | Res (Å) | Ligand | Drug / class | Family | Cys | Notes |
|---|-----|------|---------|--------|--------------|--------|-----|-------|
| ⭐⭐ | 8XZ7 | 2024 | 1.75 | A1LWW | Futibatinib analog 10h (extended acrylamide) | F1 | Cys488 | FGFR1 kinase domain with a covalent inhibitor 10h |
| ⭐⭐ | 6P69 | 2019 | 2.20 | O21 | Brameld 2019 — FGFR1-Y563C (FGFR4 surrogate) acrylamide | F1 | Cys563 (off-target) | Crystal structure of FGFR1-Y563C (FGFR4 surrogate) covalentl |
| ⭐⭐ | 8XLO | 2024 | 2.36 | A1LVQ | CXF007 — bivalent bis-acrylamide (FGFR1/4 dual-warhead) | F1 | Cys488 | FGFR1 kinase domain with a dual-warhead covalent inhibitor C |
| ⭐⭐ | 6P68 | 2019 | 2.90 | O1Y | Brameld 2019 — FGFR1-Y563C (FGFR4 surrogate) acrylamide | F1 | Cys563 (off-target) | Crystal structure of FGFR1-Y563C (FGFR4 surrogate) covalentl |
| ⭐ | 9UHI | 2025 | 1.76 | A1EPF |  | F1 (post-Michael) | Cys488 | FGFR1 kinase domain with a covalent inhibitor 9o |
| ⭐ | 9VLJ | 2026 | 1.81 | A1ESP |  | F1 (post-Michael) | Cys488 | Crystal structure of FGFR1 in complex with covalent inhibito |
| ⭐ | 9UHC | 2025 | 1.88 | A1EPE |  | F1 (post-Michael) | Cys488 | FGFR1 kinase domain with a covalent inhibitor 9p |
| ⭐ | 6MZW | 2019 | 2.20 | TZ0 | Futibatinib (TAS-120) — acrylamide-on-pyrrolidine (F1) | F1 (post-Michael) | Cys488 | TAS-120 covalent complex with FGFR1 |
| ⭐ | 5VND | 2017 | 2.20 | 9ES |  | F1 (post-Michael) | Cys563 (off-target) | Crystal structure of FGFR1-Y563C (FGFR4 surrogate) covalentl |
| ⭐ | 6NVL | 2019 | 2.70 | XL6 |  | F1 (post-Michael) | Cys488 | FGFR1 complex with N-(2-((5-((2,6-dichloro-3,5-dimethoxybenz |
| ⭐ | 8Y22 | 2024 | 2.79 | A1LW9 |  | F1 (post-Michael) | Cys488 | FGFR1 kinase domain with a covalent inhibitor 9g |

## FGFR2 — 11 covalent entries

| ⭐ | PDB | Year | Res (Å) | Ligand | Drug / class | Family | Cys | Notes |
|---|-----|------|---------|--------|--------------|--------|-----|-------|
| ⭐⭐ | 7KIE | 2021 | 2.47 | WF7 | Vinyl-styryl acrylamide FGFR2 | F1 | Cys491 | Crystal structure of FGFR2 kinase domain gatekeeper mutant V |
| ⭐ | 10OU | 2026 | 1.77 | A1C67 |  | F1 (post-Michael) | Cys491 | FGFR2 mutant D650V with compound 12 |
| ⭐ | 10OQ | 2026 | 1.98 | A1C66 |  | F1 (post-Michael) | Cys491 | FGFR2 mutant D650V with compound 6 |
| ⭐ | 8W3D | 2025 | 2.04 | TZ0 | Futibatinib (TAS-120) — acrylamide-on-pyrrolidine (F1) | F1 (post-Michael) | Cys491 | TAS-120 covalent structure with FGFR2 molecular brake mutant |
| ⭐ | 7KIA | 2021 | 2.22 | WFD | Acrylamide FGFR2 | F1 (post-Michael) | Cys491 | Crystal structure of FGFR2 kinase domain gatekeeper mutant V |
| ⭐ | 8W3B | 2025 | 2.23 | TZ0 | Futibatinib (TAS-120) — acrylamide-on-pyrrolidine (F1) | F1 (post-Michael) | Cys491 | TAS-120 covalent structure with FGFR2 molecular brake mutant |
| ⭐ | 9VLM | 2026 | 2.26 | A1ESP |  | F1 (post-Michael) | Cys491 | The X-RAY co-crystal structure of human FGFR2 and covalent i |
| ⭐ | 8W38 | 2025 | 2.60 | TZ0 | Futibatinib (TAS-120) — acrylamide-on-pyrrolidine (F1) | F1 (post-Michael) | Cys491 | TAS-120 covalent structure with FGFR2 molecular brake mutant |
| ⭐ | 8W2X | 2025 | 2.98 | A1AFR | Futibatinib (TAS-120) — post-Michael propanoyl product | F1 (post-Michael) | Cys491 | TAS-120 covalent structure with FGFR2 |
| ⭐ | 8U1F | 2024 | 3.33 | UIM | RLY-4008 analog (FGFR2 cmpd 10) | F1 (post-Michael) | Cys491 | FGFR2 Kinase Domain Bound to Irreversible Inhibitor Cmpd 10 |
| ⭐ | 8STG | 2023 | 3.79 | WCJ | RLY-4008 (Lirafugratinib) — pre-clinical FGFR2-selective; isobutyramide F1 post | F1 (post-Michael) | Cys491 | Discovery and clinical validation of RLY-4008, the first hig |

## FGFR3 — 5 covalent entries

| ⭐ | PDB | Year | Res (Å) | Ligand | Drug / class | Family | Cys | Notes |
|---|-----|------|---------|--------|--------------|--------|-----|-------|
| ⭐⭐ | 8UDU | 2024 | 1.74 | WIQ | KIN-3248 / Roivant compound (prop-2-enoyl pyrrolidine, F1 pre) | F1 | Cys482 | The X-RAY co-crystal structure of human FGFR3 and Compound 1 |
| ⭐⭐ | 8UDV | 2024 | 2.35 | WIQ | KIN-3248 / Roivant compound (prop-2-enoyl pyrrolidine, F1 pre) | F1 | Cys482 | The X-RAY co-crystal structure of human FGFR3 V555M and Comp |
| ⭐ | 9VMB | 2026 | 1.97 | A1ESX |  | F1 (post-Michael) | Cys482 | The X-RAY co-crystal structure of human FGFR3 and Compound 1 |
| ⭐ | 9VM9 | 2026 | 2.65 | A1ESW |  | F1 (post-Michael) | Cys482 | Crystal structure of FGFR3 in complex with 10s |
| ⭐ | 8UDT | 2024 | 2.83 | WGF | KIN-3248 (propanoyl pyrrolidine, F1 post-Michael) | F1 (post-Michael) | Cys482 | The X-RAY co-crystal structure of human FGFR3 and KIN-3248 |

## FGFR4 — 31 covalent entries

| ⭐ | PDB | Year | Res (Å) | Ligand | Drug / class | Family | Cys | Notes |
|---|-----|------|---------|--------|--------------|--------|-----|-------|
| ⭐⭐ | 6JPE | 2020 | 1.60 | BYU | Acrylamide FGFR4 — Kim 2019 | F1 | Cys552 | Crystal structure of FGFR4 kinase domain with irreversible i |
| ⭐⭐ | 6V9C | 2020 | 1.90 | QS7 | Acrylamide FGFR4 | F1 | Cys552 | Crystal structure of FGFR4 kinase domain in complex with cov |
| ⭐⭐ | 8XLQ | 2024 | 1.95 | A1LVQ | CXF007 — bivalent bis-acrylamide (FGFR1/4 dual-warhead) | F1 | Cys552 | FGFR4 kinase domain with a dual-warhead covalent inhibitor C |
| ⭐⭐ | 7DTZ | 2021 | 2.01 | HHL | 2-F-acrylamide FGFR4 | F1 | Cys552 | FGFR4 complex with a covalent inhibitor |
| ⭐⭐ | 6IUO | 2019 | 2.30 | AWX | Acrylamide FGFR4 — Bertrand 2019 | F1 | Cys477 (off-target) | Crystal structure of FGFR4 kinase domain in complex with a c |
| ⭐ | 4XCU | 2015 | 1.71 | 40M |  | F1 (post-Michael) | Cys552 | Crystal Structure of FGFR4 with an Irreversible Inhibitor |
| ⭐ | 6NVH | 2019 | 1.90 | XL6 |  | F1 (post-Michael) | Cys552 | FGFR4 complex with N-(2-((5-((2,6-dichloro-3,5-dimethoxybenz |
| ⭐ | 6NVG | 2019 | 1.99 | XL8 |  | F1 (post-Michael) | Cys552 | FGFR4 complex with N-(3,5-dichloro-2-((5-((2,6-dichloro-3,5- |
| ⭐ | 6NVI | 2019 | 2.12 | XL7 |  | F1 (post-Michael) | Cys552 | FGFR4 complex with N-(3-chloro-2-((5-((2,6-dichloro-3,5-dime |
| ⭐ | 4QQ5 | 2014 | 2.20 | 37O |  | F1 (post-Michael) | Cys477 (off-target) | Crystal Structure of FGF Receptor (FGFR) 4 Kinase Harboring  |
| ⭐ | 6NVJ | 2019 | 2.30 | XL5 |  | F1 (post-Michael) | Cys552 | FGFR4 complex with N-(2-((5-((2,6-dichloro-3,5-dimethoxybenz |
| ⭐ | 6NVK | 2019 | 2.30 | XL9 | Fisogatinib (BLU-554) post-Michael; FGFR4-selective | F1 (post-Michael) | Cys552 | FGFR4 complex with BLU-554, N-((3S,4S)-3-((6-(2,6-dichloro-3 |
| ⭐ | 4R6V | 2014 | 2.35 | FI3 |  | F1 (post-Michael) | Cys477 (off-target) | Crystal Structure of FGF Receptor (FGFR) 4 Kinase Harboring  |
| ⭐ | 5NWZ | 2018 | 2.37 | 9CT |  | F1 (post-Michael) | Cys477 (off-target) | FIBROBLAST GROWTH FACTOR RECEPTOR 4 KINASE DOMAIN (449-753)  |
| ⭐ | 4QQC | 2014 | 2.40 | 37O |  | F1 (post-Michael) | Cys477 (off-target) | Crystal Structure of FGF Receptor (FGFR) 4 Kinase Domain in  |
| · | 8KH9 | 2024 | 1.42 | VVW |  | F4 | Cys552 | Crystal structure of FGFR4(V550M) kinase domain with 8z |
| · | 8KH8 | 2024 | 1.49 | VVW |  | F4 | Cys552 | Crystal structure of FGFR4(V550L) kinase domain with 8z |
| · | 8KH7 | 2024 | 1.52 | VVW |  | F4 | Cys552 | Crystal structure of FGFR4 kinase domain with 8zc |
| · | 8KH6 | 2024 | 1.62 | VVI |  | Nitrile-reversible | Cys552 | Crystal structure of FGFR4 kinase domain with 8r |
| · | 7V29 | 2022 | 1.98 | 5JR |  | F6 | Cys552 | Crystal structure of FGFR4 with a dual-warhead covalent inhh |
| · | 7YC3 | 2022 | 1.99 | IIW |  | F4 | Cys552 | Crystal structure of FGFR4 kinase domain with 10t |
| · | 9K0J | 2025 | 2.07 | A1EEX |  | F4 | Cys552 | Crystal structure of FGFR4 kinase domain with 43b |
| · | 6YI8 | 2020 | 2.13 | FGF | Roblitinib (FGF401) — naphthyridinecarboxamide w/ aldehyde (F6 hemithioacetal) | F6 | Cys552 | HUMAN FGFR4 KINASE DOMAIN (447-753) IN COMPLEX WITH ROBLITIN |
| · | 7YBX | 2022 | 2.23 | IH7 |  | Nitrile-reversible | Cys552 | Crystal structure of FGFR4(V550M) kinase domain with 10z |
| · | 9K0I | 2025 | 2.24 | A1EEW |  | F4 | Cys552 | Crystal structure of FGFR4 kinase domain with 32a |
| · | 7YBP | 2022 | 2.24 | IH7 |  | Nitrile-reversible | Cys552 | Crystal structure of FGFR4(V550L) kinase domain with 10z |
| · | 7YBO | 2022 | 2.31 | IH7 |  | Nitrile-reversible | Cys552 | Crystal structure of FGFR4 kinase domain with 10z |
| · | 5NUD | 2018 | 2.50 | 99K |  | F4 | Cys552 | FIBROBLAST GROWTH FACTOR RECEPTOR 4 KINASE DOMAIN (449-753)  |
| · | 7YC1 | 2022 | 2.54 | IIQ |  | Nitrile-reversible | Cys552 | Crystal structure of FGFR4 kinase domain with 10d |
| · | 6JPJ | 2019 | 2.64 | FGF | Roblitinib (FGF401) — naphthyridinecarboxamide w/ aldehyde (F6 hemithioacetal) | F6 | Cys552 | Crystal structure of FGF401 in complex of FGFR4 |
| · | 7VJL | 2022 | 2.90 | 7IF |  | F6 | Cys552 | The crystal structure of FGFR4 kinase domain in complex with |

## All FGFR combined (dedup) — 58 covalent entries

| ⭐ | PDB | Year | Res (Å) | Ligand | Drug / class | Family | Cys | Notes |
|---|-----|------|---------|--------|--------------|--------|-----|-------|
| ⭐⭐ | 6JPE | 2020 | 1.60 | BYU | Acrylamide FGFR4 — Kim 2019 | F1 | Cys552 | Crystal structure of FGFR4 kinase domain with irreversible i |
| ⭐⭐ | 8UDU | 2024 | 1.74 | WIQ | KIN-3248 / Roivant compound (prop-2-enoyl pyrrolidine, F1 pre) | F1 | Cys482 | The X-RAY co-crystal structure of human FGFR3 and Compound 1 |
| ⭐⭐ | 8XZ7 | 2024 | 1.75 | A1LWW | Futibatinib analog 10h (extended acrylamide) | F1 | Cys488 | FGFR1 kinase domain with a covalent inhibitor 10h |
| ⭐⭐ | 6V9C | 2020 | 1.90 | QS7 | Acrylamide FGFR4 | F1 | Cys552 | Crystal structure of FGFR4 kinase domain in complex with cov |
| ⭐⭐ | 8XLQ | 2024 | 1.95 | A1LVQ | CXF007 — bivalent bis-acrylamide (FGFR1/4 dual-warhead) | F1 | Cys552 | FGFR4 kinase domain with a dual-warhead covalent inhibitor C |
| ⭐⭐ | 7DTZ | 2021 | 2.01 | HHL | 2-F-acrylamide FGFR4 | F1 | Cys552 | FGFR4 complex with a covalent inhibitor |
| ⭐⭐ | 6P69 | 2019 | 2.20 | O21 | Brameld 2019 — FGFR1-Y563C (FGFR4 surrogate) acrylamide | F1 | Cys563 (off-target) | Crystal structure of FGFR1-Y563C (FGFR4 surrogate) covalentl |
| ⭐⭐ | 6IUO | 2019 | 2.30 | AWX | Acrylamide FGFR4 — Bertrand 2019 | F1 | Cys477 (off-target) | Crystal structure of FGFR4 kinase domain in complex with a c |
| ⭐⭐ | 8UDV | 2024 | 2.35 | WIQ | KIN-3248 / Roivant compound (prop-2-enoyl pyrrolidine, F1 pre) | F1 | Cys482 | The X-RAY co-crystal structure of human FGFR3 V555M and Comp |
| ⭐⭐ | 8XLO | 2024 | 2.36 | A1LVQ | CXF007 — bivalent bis-acrylamide (FGFR1/4 dual-warhead) | F1 | Cys488 | FGFR1 kinase domain with a dual-warhead covalent inhibitor C |
| ⭐⭐ | 7KIE | 2021 | 2.47 | WF7 | Vinyl-styryl acrylamide FGFR2 | F1 | Cys491 | Crystal structure of FGFR2 kinase domain gatekeeper mutant V |
| ⭐⭐ | 6P68 | 2019 | 2.90 | O1Y | Brameld 2019 — FGFR1-Y563C (FGFR4 surrogate) acrylamide | F1 | Cys563 (off-target) | Crystal structure of FGFR1-Y563C (FGFR4 surrogate) covalentl |
| ⭐ | 4XCU | 2015 | 1.71 | 40M |  | F1 (post-Michael) | Cys552 | Crystal Structure of FGFR4 with an Irreversible Inhibitor |
| ⭐ | 9UHI | 2025 | 1.76 | A1EPF |  | F1 (post-Michael) | Cys488 | FGFR1 kinase domain with a covalent inhibitor 9o |
| ⭐ | 10OU | 2026 | 1.77 | A1C67 |  | F1 (post-Michael) | Cys491 | FGFR2 mutant D650V with compound 12 |
| ⭐ | 9VLJ | 2026 | 1.81 | A1ESP |  | F1 (post-Michael) | Cys488 | Crystal structure of FGFR1 in complex with covalent inhibito |
| ⭐ | 9UHC | 2025 | 1.88 | A1EPE |  | F1 (post-Michael) | Cys488 | FGFR1 kinase domain with a covalent inhibitor 9p |
| ⭐ | 6NVH | 2019 | 1.90 | XL6 |  | F1 (post-Michael) | Cys552 | FGFR4 complex with N-(2-((5-((2,6-dichloro-3,5-dimethoxybenz |
| ⭐ | 9VMB | 2026 | 1.97 | A1ESX |  | F1 (post-Michael) | Cys482 | The X-RAY co-crystal structure of human FGFR3 and Compound 1 |
| ⭐ | 10OQ | 2026 | 1.98 | A1C66 |  | F1 (post-Michael) | Cys491 | FGFR2 mutant D650V with compound 6 |
| ⭐ | 6NVG | 2019 | 1.99 | XL8 |  | F1 (post-Michael) | Cys552 | FGFR4 complex with N-(3,5-dichloro-2-((5-((2,6-dichloro-3,5- |
| ⭐ | 8W3D | 2025 | 2.04 | TZ0 | Futibatinib (TAS-120) — acrylamide-on-pyrrolidine (F1) | F1 (post-Michael) | Cys491 | TAS-120 covalent structure with FGFR2 molecular brake mutant |
| ⭐ | 6NVI | 2019 | 2.12 | XL7 |  | F1 (post-Michael) | Cys552 | FGFR4 complex with N-(3-chloro-2-((5-((2,6-dichloro-3,5-dime |
| ⭐ | 6MZW | 2019 | 2.20 | TZ0 | Futibatinib (TAS-120) — acrylamide-on-pyrrolidine (F1) | F1 (post-Michael) | Cys488 | TAS-120 covalent complex with FGFR1 |
| ⭐ | 5VND | 2017 | 2.20 | 9ES |  | F1 (post-Michael) | Cys563 (off-target) | Crystal structure of FGFR1-Y563C (FGFR4 surrogate) covalentl |
| ⭐ | 4QQ5 | 2014 | 2.20 | 37O |  | F1 (post-Michael) | Cys477 (off-target) | Crystal Structure of FGF Receptor (FGFR) 4 Kinase Harboring  |
| ⭐ | 7KIA | 2021 | 2.22 | WFD | Acrylamide FGFR2 | F1 (post-Michael) | Cys491 | Crystal structure of FGFR2 kinase domain gatekeeper mutant V |
| ⭐ | 8W3B | 2025 | 2.23 | TZ0 | Futibatinib (TAS-120) — acrylamide-on-pyrrolidine (F1) | F1 (post-Michael) | Cys491 | TAS-120 covalent structure with FGFR2 molecular brake mutant |
| ⭐ | 9VLM | 2026 | 2.26 | A1ESP |  | F1 (post-Michael) | Cys491 | The X-RAY co-crystal structure of human FGFR2 and covalent i |
| ⭐ | 6NVJ | 2019 | 2.30 | XL5 |  | F1 (post-Michael) | Cys552 | FGFR4 complex with N-(2-((5-((2,6-dichloro-3,5-dimethoxybenz |
| ⭐ | 6NVK | 2019 | 2.30 | XL9 | Fisogatinib (BLU-554) post-Michael; FGFR4-selective | F1 (post-Michael) | Cys552 | FGFR4 complex with BLU-554, N-((3S,4S)-3-((6-(2,6-dichloro-3 |
| ⭐ | 4R6V | 2014 | 2.35 | FI3 |  | F1 (post-Michael) | Cys477 (off-target) | Crystal Structure of FGF Receptor (FGFR) 4 Kinase Harboring  |
| ⭐ | 5NWZ | 2018 | 2.37 | 9CT |  | F1 (post-Michael) | Cys477 (off-target) | FIBROBLAST GROWTH FACTOR RECEPTOR 4 KINASE DOMAIN (449-753)  |
| ⭐ | 4QQC | 2014 | 2.40 | 37O |  | F1 (post-Michael) | Cys477 (off-target) | Crystal Structure of FGF Receptor (FGFR) 4 Kinase Domain in  |
| ⭐ | 8W38 | 2025 | 2.60 | TZ0 | Futibatinib (TAS-120) — acrylamide-on-pyrrolidine (F1) | F1 (post-Michael) | Cys491 | TAS-120 covalent structure with FGFR2 molecular brake mutant |
| ⭐ | 9VM9 | 2026 | 2.65 | A1ESW |  | F1 (post-Michael) | Cys482 | Crystal structure of FGFR3 in complex with 10s |
| ⭐ | 6NVL | 2019 | 2.70 | XL6 |  | F1 (post-Michael) | Cys488 | FGFR1 complex with N-(2-((5-((2,6-dichloro-3,5-dimethoxybenz |
| ⭐ | 8Y22 | 2024 | 2.79 | A1LW9 |  | F1 (post-Michael) | Cys488 | FGFR1 kinase domain with a covalent inhibitor 9g |
| ⭐ | 8UDT | 2024 | 2.83 | WGF | KIN-3248 (propanoyl pyrrolidine, F1 post-Michael) | F1 (post-Michael) | Cys482 | The X-RAY co-crystal structure of human FGFR3 and KIN-3248 |
| ⭐ | 8W2X | 2025 | 2.98 | A1AFR | Futibatinib (TAS-120) — post-Michael propanoyl product | F1 (post-Michael) | Cys491 | TAS-120 covalent structure with FGFR2 |
| ⭐ | 8U1F | 2024 | 3.33 | UIM | RLY-4008 analog (FGFR2 cmpd 10) | F1 (post-Michael) | Cys491 | FGFR2 Kinase Domain Bound to Irreversible Inhibitor Cmpd 10 |
| ⭐ | 8STG | 2023 | 3.79 | WCJ | RLY-4008 (Lirafugratinib) — pre-clinical FGFR2-selective; isobutyramide F1 post | F1 (post-Michael) | Cys491 | Discovery and clinical validation of RLY-4008, the first hig |
| · | 8KH9 | 2024 | 1.42 | VVW |  | F4 | Cys552 | Crystal structure of FGFR4(V550M) kinase domain with 8z |
| · | 8KH8 | 2024 | 1.49 | VVW |  | F4 | Cys552 | Crystal structure of FGFR4(V550L) kinase domain with 8z |
| · | 8KH7 | 2024 | 1.52 | VVW |  | F4 | Cys552 | Crystal structure of FGFR4 kinase domain with 8zc |
| · | 8KH6 | 2024 | 1.62 | VVI |  | Nitrile-reversible | Cys552 | Crystal structure of FGFR4 kinase domain with 8r |
| · | 7V29 | 2022 | 1.98 | 5JR |  | F6 | Cys552 | Crystal structure of FGFR4 with a dual-warhead covalent inhh |
| · | 7YC3 | 2022 | 1.99 | IIW |  | F4 | Cys552 | Crystal structure of FGFR4 kinase domain with 10t |
| · | 9K0J | 2025 | 2.07 | A1EEX |  | F4 | Cys552 | Crystal structure of FGFR4 kinase domain with 43b |
| · | 6YI8 | 2020 | 2.13 | FGF | Roblitinib (FGF401) — naphthyridinecarboxamide w/ aldehyde (F6 hemithioacetal) | F6 | Cys552 | HUMAN FGFR4 KINASE DOMAIN (447-753) IN COMPLEX WITH ROBLITIN |
| · | 7YBX | 2022 | 2.23 | IH7 |  | Nitrile-reversible | Cys552 | Crystal structure of FGFR4(V550M) kinase domain with 10z |
| · | 9K0I | 2025 | 2.24 | A1EEW |  | F4 | Cys552 | Crystal structure of FGFR4 kinase domain with 32a |
| · | 7YBP | 2022 | 2.24 | IH7 |  | Nitrile-reversible | Cys552 | Crystal structure of FGFR4(V550L) kinase domain with 10z |
| · | 7YBO | 2022 | 2.31 | IH7 |  | Nitrile-reversible | Cys552 | Crystal structure of FGFR4 kinase domain with 10z |
| · | 5NUD | 2018 | 2.50 | 99K |  | F4 | Cys552 | FIBROBLAST GROWTH FACTOR RECEPTOR 4 KINASE DOMAIN (449-753)  |
| · | 7YC1 | 2022 | 2.54 | IIQ |  | Nitrile-reversible | Cys552 | Crystal structure of FGFR4 kinase domain with 10d |
| · | 6JPJ | 2019 | 2.64 | FGF | Roblitinib (FGF401) — naphthyridinecarboxamide w/ aldehyde (F6 hemithioacetal) | F6 | Cys552 | Crystal structure of FGF401 in complex of FGFR4 |
| · | 7VJL | 2022 | 2.90 | 7IF |  | F6 | Cys552 | The crystal structure of FGFR4 kinase domain in complex with |

## Futibatinib / butynamide deposits across all four FGFRs

**Critical correction to the user's brief**: Futibatinib (TAS-120, FDA 2022) is
**not an α,β-ynamide**. ChEMBL CHEMBL3701238's canonical SMILES is
`C=CC(=O)N1CC[C@H](n2nc(C#Cc3cc(OC)cc(OC)c3)c3c(N)ncnc32)C1` — the warhead
is an **acrylamide on the pyrrolidine N** (F1), and the `C#C` is a
3,5-dimethoxyphenyl-ethynyl linker inside the pyrazolo[3,4-d]pyrimidine
scaffold, NOT a reactive group. PDB ligand code **TZ0** = futibatinib
pre-reaction; **A1AFR** = the post-Michael propanoyl product (saturated).

So futibatinib's PDB entries are F1, not F2. There are no F2 ynamide
entries in any FGFR PDB deposit as of 2026-06-06.

### TZ0 / A1AFR (futibatinib) deposits

| PDB | Year | Res (Å) | Target | Ligand | State | Cys |
|-----|------|---------|--------|--------|-------|-----|
| 8W3D | 2025 | 2.04 | FGFR2 | TZ0 | pre-Michael (acryl) | Cys491 |
| 6MZW | 2019 | 2.20 | FGFR1 | TZ0 | pre-Michael (acryl) | Cys488 |
| 8W3B | 2025 | 2.23 | FGFR2 | TZ0 | pre-Michael (acryl) | Cys491 |
| 8W38 | 2025 | 2.60 | FGFR2 | TZ0 | pre-Michael (acryl) | Cys491 |
| 8W2X | 2025 | 2.98 | FGFR2 | A1AFR | post-Michael (propanoyl) | Cys491 |

Note the **deposit-state inconsistency**: 6MZW (FGFR1, 2019) and the 2025
FGFR2 series (8W38/8W3B/8W3D) all deposit TZ0 with the pre-reaction
acrylamide chem_comp despite the SG-Cβ bond being well below 2.0 Å,
while 8W2X deposits A1AFR (saturated propanoyl) for the same molecule.
This is exactly the §1.6 "deposition pipeline lossiness" case: two
chemically equivalent post-Michael adducts get different chem_comp IDs.

## Recommended first-5 FGFR re-refinement set

Because there are no deposited F2 entries for any FGFR target, the most
user-relevant data points are the **highest-resolution F1 acrylamide /
propanamide structures** — they share Cys-SG → Cβ geometry with the
user's F2 lab compounds (same sp3 Cβ with single bond to S after Michael)
differing only in the absence of the residual C=C across the link.

| # | PDB | Year | Res (Å) | Target | Lig | Family | Cys | Why it's in the first-5 |
|---|-----|------|---------|--------|-----|--------|-----|--------------------------|
| 1 | 6JPE | 2020 | 1.60 | FGFR4 | BYU | F1 | Cys552 | FGFR4 highest-res F1-pre + canonical Cys552 — the most-targeted FGFR for covalent |
| 2 | 8W3D | 2025 | 2.04 | FGFR2 | TZ0 | F1 (post-Michael) | Cys491 | Futibatinib (TZ0) on FGFR2 — direct lab-drug analog, pre-Michael acrylamide visible |
| 3 | 8UDU | 2024 | 1.74 | FGFR3 | WIQ | F1 | Cys482 | FGFR3 highest-res with visible acrylamide on Cys482 — covers the third isoform |
| 4 | 8XZ7 | 2024 | 1.75 | FGFR1 | A1LWW | F1 | Cys488 | FGFR1 Cys488 with visible acrylamide — covers the first isoform |
| 5 | 8XLQ | 2024 | 1.95 | FGFR4 | A1LVQ | F1 | Cys552 | CXF007 (A1LVQ) bivalent bis-acrylamide on FGFR4 Cys552 — unusual topology, two acrylamides, one engaged |

## Comparison vs the BTK + EGFR inventory

- BTK: 32 covalent entries, **4 F2 confirmed**, plus 17 F1/F2-ambiguous post-Michael propanamide entries.
- EGFR: 120 covalent entries, **6 F2 confirmed**.
- FGFR1+2+3+4: 58 covalent entries, **0 F2 confirmed**, plus 30 F1 post-Michael propanamide entries (also F1/F2-ambig in principle, but the published parent drug for every one is acrylamide-class — there is no published terminal-propiolamide or butynamide FGFR inhibitor in deposited PDB).

**Headline F2-confirmed shift**: 10 (BTK+EGFR) → 10 (BTK+EGFR+FGFR). Adding FGFR
contributes **zero new F2 entries** to the user's lab focus set. The BTK/EGFR
survey already captured the full deposited F2 universe for receptor tyrosine
kinases.

**Headline F1/F2-ambig (post-Michael propanamide) shift**: 17 (BTK) → 47 (BTK+FGFR).
This 30-entry FGFR bump triples the post-Michael training set — useful for
validating the F1 template and for a future SMARTS-against-parent-drug
disambiguator. But these are all biased toward FGFR acrylamides (none known
to be ynamide parents).

**Takeaway for the F2 link-CIF**: adding FGFR to the inventory does **not**
change the F2 implementation roadmap. The user's BTK+EGFR F2 set (with 8FD9
XQQ canonical, 9CUX 1.27 Å, etc.) remains the best deposited training corpus
for the Cys-YNA template. FGFR data are useful for validating F1 geometry —
which is *similar* to F2 post-Michael at the Cys-Cβ link itself.

## FGFR4 Cys552 vs other FGFR Cys positions

- FGFR4 covalent entries: 31
  - Hitting **Cys552** (the canonical kinase-domain selectivity Cys): 26
  - Hitting **Cys477** (a different surface Cys near the αD helix region): 5

FGFR4 dominates the FGFR covalent set (31/58 = 53%) — confirming the user's
note that **FGFR4 is the most-targeted FGFR for covalent drug discovery**,
driven by the FGFR1-3 → FGFR4 selectivity afforded by Cys552 (Gly in 1-3).
Of the 31 FGFR4 entries, 26 hit Cys552, **5 hit Cys477** instead (the
paralog-Brameld series 4QQ5/4QQC/4R6V and the 5NWZ scaffold), and the rest
span every warhead family present in the FGFR set (F1, F4, F6, nitrile).

**Butynamide hitting Cys552**: as noted, none — there is no F2 ynamide on
any FGFR4 (or any FGFR) PDB entry. If the user's lab develops one, it would
be the **first FGFR ynamide in the PDB**, and an excellent template-validation
structure given the rich deposited acrylamide chemistry against Cys552.

FGFR1-3 Cys position breakdown:
- FGFR1: 8/11 hit Cys488. FGFR1 also has 3 entries hitting Cys563 (the FGFR1-Y563C mutant — Brameld 2019 used this as an FGFR4 surrogate).
- FGFR2: 11/11 hit Cys491. 
- FGFR3: 5/5 hit Cys482. 

## Edge cases / deposit warnings

- **Futibatinib double encoding**: same drug, two chem_comp IDs depending
  on whether the depositor recorded the pre-reaction acrylamide (**TZ0**)
  or the post-Michael propanoyl product (**A1AFR**). In both cases the
  SG-Cβ bond is <2.0 Å, so the chem_comp choice is a depositor preference,
  not chemistry. This is the headline §1.6 deposition-lossiness case.
  - TZ0 (pre): 6MZW, 8W38, 8W3B, 8W3D
  - A1AFR (post): 8W2X

- **CXF007 (A1LVQ) bivalent acrylamide**: 8XLQ (FGFR4) and 8XLO (FGFR1)
  ligand 3-letter code A1LVQ is a bis-acrylamide tethered through a
  pyrimido[4,5-d]pyrimidinedione scaffold — both warheads visible as `C=C`
  in the SMILES, but only **one** engages a Cys-SG per entry (8XLO has 2
  copies of the same Cys33-Cβ bond — two protein chains, not two warheads).
  Designing the link CIF for this one would need a two-headed entry.

- **Roblitinib (FGF401, ligand FGF) chem_comp.type**: PDB chem_comp.name is
  `...7-methanoyl-...naphthyridine-1-carboxamide` — the **methanoyl is the
  aldehyde warhead** forming a hemithioacetal (F6 reversible) with Cys552,
  not an acrylamide. The user's brief listed roblitinib as F1; that's an
  upstream catalog error. PDB entries: 6JPJ (2.64 Å), 6YI8 (2.13 Å).

- **Nonstandard 5-char chem_comp codes** (`A1xxx`): post-2024 codes appear
  for several FGFR entries — A1AFR, A1C66, A1C67, A1EEW, A1EEX, A1EPE,
  A1EPF, A1ESP, A1ESW, A1ESX, A1LVQ, A1LW9, A1LWW. These break the legacy
  3-char assumption; PyKeko's covalent-link runtime must handle ≤5-char
  resnames (see plan §10.1 about extended codes).

- **2-chloropyridine SNAr fragment (99K, PDB 5NUD)**: deposited at 1.67 Å
  Cys-SG distance with no acrylamide / amide warhead visible. Looks like an
  aromatic nucleophilic substitution off the 2-Cl on the 3-trifluoromethyl
  pyridine. Could be a misclassified non-covalent contact or a fragment-
  screening SNAr hit. Worth a manual SMILES + density inspection before
  including in any training set.

- **Off-target Cys hits**: 5 FGFR4 entries (4QQ5, 4QQC, 4R6V, 5NWZ, 6IUO)
  bind Cys477 instead of Cys552 — surface Cys, different binding mode.
  3 FGFR1 entries (5VND, 6P68, 6P69) bind Cys563 because they're the
  FGFR1-Y563C mutant — a deliberate construct engineered to mimic FGFR4
  Cys552 (Brameld 2019).

- **Two-chain multi-row artifacts**: 29/58 entries have ≥2 Cys-SG → ligand
  bonds in `_struct_conn`. In almost every case this is because the AU
  has 2-3 protein chains, each with its own Cys-SG covalent bond to the
  same ligand chem_comp. Not a true multi-warhead case.
