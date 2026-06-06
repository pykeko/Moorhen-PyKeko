# BTK + EGFR Cys-S-Covalent PDB Inventory

Source: 2026-06-06 RCSB Search + Data GraphQL query, intersected with
Cys-SG ↔ non-S < 2.0 Å covalent-bond filter (same as the 2026-06-05
survey at `~/Moorhen/docs/covalent-ligand-survey-2026-06-05/`).

Family classification per `analyze_warheads.py` + a hand-curated drug
dictionary (acalabrutinib/tirabrutinib/branebrutinib for F2 canonical;
afatinib/neratinib/dacomitinib/mobocertinib/canertinib for F2 extended-
methyl; ibrutinib/zanubrutinib/osimertinib/oritinib/alflutinib for F1).

Relevance stars:
- ⭐⭐⭐ F2 canonical or F2 extended-methyl (the user's lab niche)
- ⭐⭐ F2 terminal-propiolamide (Spebrutinib-class)
- ⭐ F1 acrylamide (medchem-adjacent, ibrutinib/osimertinib class)
- · F1/F2-ambig — saturated post-Michael propanamide; need SMILES
- (blank) F3 / F4 / F5 / F6 / F7 / metal / unclassified (out of scope)

## BTK (UniProt Q06187 + P35991, Cys481)

**32 entries** with a Cys-SG → ligand covalent bond < 2.0 Å detected.

| ⭐ | PDB | Year | Res (Å) | Ligand | Family | Drug name (if any) | Warhead chemistry | Cys |
|---|---|---|---|---|---|---|---|---|
| ⭐⭐⭐ | 5P9M | 2017 | 1.41 | 7GB | F2 | Tirabrutinib | methyl butynamide (purinone scaffold) | Cys101 |
| ⭐⭐⭐ | 6O8I | 2019 | 1.42 | LTJ | F2 | Branebrutinib (BMS-986195) | methyl butynamide (indolo-pyridine) | Cys91 |
| ⭐⭐⭐ | 8FD9 | 2023 | 1.70 | XQQ | F2 | Acalabrutinib | methyl butynamide (canonical F2) | Cys87 |
| ⭐⭐⭐ | 8FF0 | 2023 | 2.60 | 7GB | F2 | Tirabrutinib | methyl butynamide (purinone scaffold) | Cys87 |
| ⭐⭐⭐ | 8DSO | 2023 | 2.33 | TOO | F2-extended | Ibrutinib-PROTAC w/ extended methyl | extended methyl but-2-en-1-yl piperazine (PROTAC linker) | Cys99 |
| ⭐ | 6DI9 | 2018 | 1.25 | GJJ | F1 | — | acrylamide (free drug pre-reaction) | Cys93 (altloc) |
| ⭐ | 5J87 | 2017 | 1.59 | N42 | F1 | — | acrylamide (free drug pre-reaction) | Cys97 |
| ⭐ | 7R60 | 2021 | 1.94 | 2IE | F1 | — | acrylamide (free drug pre-reaction) | Cys93 |
| · | 5P9J | 2017 | 1.08 | 8E8 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys101 |
| · | 6DI1 | 2018 | 1.10 | GJD | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys93 (altloc) |
| · | 6J6M | 2019 | 1.25 | BA0 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys91 |
| · | 5P9L | 2017 | 1.25 | 7G9 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys101 (altloc) |
| · | 9ZLM | 2026 | 1.27 | A1C2Z | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys100 |
| · | 5P9K | 2017 | 1.28 | 7G8 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys101 |
| · | 7YC9 | 2023 | 1.40 | IS4 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys91 (altloc) |
| · | 6DI5 | 2018 | 1.42 | GJ7 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys93 (altloc) |
| · | 9ZLJ | 2026 | 1.60 | A1C20 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys100 |
| · | 8TU4 | 2024 | 1.60 | V72 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys105 |
| · | 7N5Y | 2021 | 1.85 | 0CI | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys105 |
| · | 8E2M | 2022 | 1.90 | UB6 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys93 |
| · | 6TFP | 2020 | 2.00 | N6Z | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys98 |
| · | 8TU5 | 2024 | 2.10 | V7I | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys105 |
| · | 6N9P | 2019 | 2.23 | KHD | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys93 (altloc) |
| · | 5XYZ | 2018 | 2.64 | GYL | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys90 |
|   | 7R61 | 2021 | 1.52 | 2IJ | F6-imine | Iminomethyl BTK probe | (Z)-iminomethyl (formimidoyl) | Cys92 |
|   | 7I97 | 2026 | 1.69 | ZN | metal-cofactor | metal ion (non-warhead) | — | Cys164 |
|   | 7I9E | 2026 | 1.91 | ZN | metal-cofactor | metal ion (non-warhead) | — | Cys153 |
|   | 7L5P | 2022 | 2.14 | R1L | F3 | Ibrutinib (E)-pent-2-enenitrile analog | (E)-α,β-unsat nitrile (acrylonitrile-class) | Cys93 |
|   | 4YHF | 2015 | 2.20 | 4C9 | F7-nitrile | Ibrutinib pentanenitrile analog | (2S)-pentanenitrile warhead (reversible nitrile-Cys) | Cys100 |
|   | 1B55 | 1999 | 2.40 | ZN | metal-cofactor | metal ion (non-warhead) | — | Cys164 |
|   | 2Z0P | 2008 | 2.58 | ZN | metal-cofactor | metal ion (non-warhead) | — | Cys164 |
|   | 6MNY | 2019 | 2.80 | JVP | F7-nitrile | Pirtobrutinib-class | 1-cyanopiperidine (reversible nitrile-Cys) | Cys98 |

## EGFR (UniProt P00533, Cys797)

**120 entries** with a Cys-SG → ligand covalent bond < 2.0 Å detected.

| ⭐ | PDB | Year | Res (Å) | Ligand | Family | Drug name (if any) | Warhead chemistry | Cys |
|---|---|---|---|---|---|---|---|---|
| ⭐⭐⭐ | 9GL8 | 2025 | 1.63 | A1IMT | F2 | Olafertinib-class extended methyl | extended methyl (4-NMe2-but-2-enamide) | Cys107 |
| ⭐⭐⭐ | 9DF4 | 2025 | 1.78 | A1A4E | F2 | 3rd-gen EGFR extended-methyl | extended methyl (4-NMe2-but-2-en) | Cys108 |
| ⭐⭐⭐ | 9FQS | 2025 | 1.78 | A1IE0 | F2 | EGFR ethynyl extended methyl | extended methyl pre (ethynyl) | Cys107 |
| ⭐⭐⭐ | 4I24 | 2013 | 1.80 | 1C9 | F2 | CI-1033-like extended methyl | extended methyl (4-piperidinyl-but-2-enamide) | Cys104 |
| ⭐⭐⭐ | 3W2P | 2013 | 2.05 | W2P | F2 | Canertinib-like | extended methyl (4-NMe2-but-2-enamide) | Cys106 |
| ⭐⭐⭐ | 9GL9 | 2025 | 2.15 | A1IMT | F2 | Olafertinib-class extended methyl | extended methyl (4-NMe2-but-2-enamide) | Cys105 |
| ⭐⭐⭐ | 7JXP | 2021 | 2.16 | YY3 | F2 | Dacomitinib | extended methyl (4-piperidinyl-but-2-enamide) | Cys106 |
| ⭐⭐⭐ | 3W2Q | 2013 | 2.20 | HKI | F2 | Neratinib (HKI-272) | extended methyl (4-NMe2-but-2-enamide) | Cys106 |
| ⭐⭐⭐ | 6JXT | 2020 | 2.31 | YY3 | F2 | Dacomitinib | extended methyl (4-piperidinyl-but-2-enamide) | Cys106 |
| ⭐⭐⭐ | 9S3X | 2026 | 2.42 | A1JLU | F2 | EGFR 5-ethenyl extended methyl | extended methyl (vinyl, pre) | Cys80 |
| ⭐⭐⭐ | 9EWS | 2024 | 2.44 | A1H7N | F2 | EGFR ethynyl pyrimidinyl | extended methyl pre (ethynyl) | Cys107 |
| ⭐⭐⭐ | 7JXW | 2021 | 2.50 | YY3 | F2 | Dacomitinib | extended methyl (4-piperidinyl-but-2-enamide) | Cys106 |
| ⭐⭐⭐ | 6JX0 | 2020 | 2.53 | YY3 | F2 | Dacomitinib | extended methyl (4-piperidinyl-but-2-enamide) | Cys106 |
| ⭐⭐⭐ | 6JX4 | 2020 | 2.53 | YY3 | F2 | Dacomitinib | extended methyl (4-piperidinyl-but-2-enamide) | Cys106 |
| ⭐⭐⭐ | 6JWL | 2020 | 2.55 | YY3 | F2 | Dacomitinib | extended methyl (4-piperidinyl-but-2-enamide) | Cys106 |
| ⭐⭐⭐ | 7K1H | 2021 | 2.60 | YY3 | F2 | Dacomitinib | extended methyl (4-piperidinyl-but-2-enamide) | Cys106 |
| ⭐⭐⭐ | 4G5J | 2012 | 2.80 | 0WN | F2 | Canertinib (CI-1033) | extended methyl (4-NMe2-but-2-enamide) | Cys105 |
| ⭐⭐⭐ | 9EWT | 2024 | 3.02 | A1H7O | F2 | EGFR ethenyl 5-cyclopropyl-oxazol | extended methyl pre/post | Cys107 |
| ⭐⭐⭐ | 4G5P | 2012 | 3.17 | 0WN | F2 | Canertinib (CI-1033) | extended methyl (4-NMe2-but-2-enamide) | Cys105 |
| ⭐⭐⭐ | 5FEQ | 2016 | 3.40 | 5XH | F2 | EGFR 4-(dimethylamino)but-2-enoyl-azepan-benzimidazol p | extended methyl (4-NMe2-but-2-enoyl) | Cys103 |
| ⭐⭐⭐ | 9U8C | 2025 | 3.50 | A1L8T | F2 | EGFR extended methyl 3-aryl | extended methyl | Cys113 |
| ⭐⭐⭐ | 2JIV | 2008 | 3.50 | HKI | F2 | Neratinib (HKI-272) | extended methyl (4-NMe2-but-2-enamide) | Cys103 |
| ⭐ | 5GNK | 2017 | 1.80 | 80U | F1 | — | acrylamide (free drug pre-reaction) | Cys106 |
| ⭐ | 5YU9 | 2017 | 1.95 | 1E8 | F1 | Ibrutinib | acrylamide (pre-reaction prop-2-en-1-one) | Cys106 |
| ⭐ | 8HV4 | 2023 | 2.20 | MWU | F1 | Pyridin-2-yl-prop-2-enamide | acrylamide (pre) | Cys82 |
| ⭐ | 8HV6 | 2023 | 2.20 | N86 | F1 | Quinolin-7-yl-prop-2-enamide | acrylamide (pre) | Cys82 |
| ⭐ | 9NIS | 2025 | 2.23 | A1BYK | F1 | Alflutinib (Furmonertinib) | acrylamide | Cys102 |
| ⭐ | 9NJN | 2025 | 2.24 | A1BYS | F1 | Lazertinib-class | acrylamide | Cys102 |
| ⭐ | 5XDK | 2017 | 2.35 | 8JC | F1 | — | acrylamide (free drug pre-reaction) | Cys106 |
| ⭐ | 8HV3 | 2023 | 2.40 | MWU | F1 | Pyridin-2-yl-prop-2-enamide | acrylamide (pre) | Cys82 |
| ⭐ | 8HV8 | 2023 | 2.40 | N99 | F1 | Pyrazolopyridin-2-yl-prop-2-enamide | acrylamide (pre) | Cys82 |
| ⭐ | 8HV9 | 2023 | 2.50 | N9L | F1 | — | acrylamide (free drug pre-reaction) | Cys82 |
| ⭐ | 5J9Z | 2016 | 2.50 | 6HJ | F1 | Ibrutinib analog (indol-3-yl) | acrylamide (pre) | Cys102 |
| ⭐ | 4LQM | 2014 | 2.50 | DJK | F1 | — | acrylamide (free drug pre-reaction) | Cys106 |
| ⭐ | 7OXB | 2021 | 2.56 | 35Z | F1 | — | acrylamide (free drug pre-reaction) | Cys103 |
| ⭐ | 8HV7 | 2023 | 2.69 | N8O | F1 | — | acrylamide (free drug pre-reaction) | Cys82 |
| ⭐ | 5XDL | 2017 | 2.70 | 8JC | F1 | — | acrylamide (free drug pre-reaction) | Cys106 |
| ⭐ | 9NHW | 2025 | 2.73 | A1BYD | F1 | Oritinib | acrylamide | Cys102 |
| ⭐ | 8HVA | 2023 | 2.77 | N9R | F1 | — | acrylamide (free drug pre-reaction) | Cys82 |
| ⭐ | 5GMP | 2017 | 2.80 | F62 | F1 | — | acrylamide (free drug pre-reaction) | Cys106 |
| ⭐ | 8HV2 | 2023 | 2.80 | MWU | F1 | Pyridin-2-yl-prop-2-enamide | acrylamide (pre) | Cys84 |
| ⭐ | 8F1H | 2023 | 2.80 | X9H | F1 | — | acrylamide (free drug pre-reaction) | Cys106 |
| ⭐ | 5J9Y | 2016 | 2.80 | 6HL | F1 | Ibrutinib analog (naphthyl) | acrylamide (pre) | Cys101 |
| ⭐ | 3IKA | 2010 | 2.90 | 0UN | F1 | — | acrylamide (free drug pre-reaction) | Cys106 |
| ⭐ | 8HY7 | 2023 | 2.91 | NSO | F1 | — | acrylamide (free drug pre-reaction) | Cys103 |
| ⭐ | 7LG8 | 2022 | 2.93 | 8RC | F1 | — | acrylamide (free drug pre-reaction) | Cys106 |
| ⭐ | 5GTZ | 2017 | 3.00 | 81C | F1 | — | acrylamide (free drug pre-reaction) | Cys106 |
| ⭐ | 2J5F | 2007 | 3.00 | DJK | F1 | — | acrylamide (free drug pre-reaction) | Cys102 |
| ⭐ | 5GTY | 2017 | 3.14 | 816 | F1 | — | acrylamide (free drug pre-reaction) | Cys106 |
| ⭐ | 8KFQ | 2024 | 3.22 | VUZ | F1 | — | acrylamide (free drug pre-reaction) | Cys101 |
| ⭐ | 5Y9T | 2018 | 3.25 | 8RC | F1 | — | acrylamide (free drug pre-reaction) | Cys108 |
| ⭐ | 8EME | 2023 | 3.32 | ZNL | F1 | — | acrylamide (free drug pre-reaction) | Cys106 |
| · | 5UG9 | 2017 | 1.33 | 8AM | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys104 |
| · | 5HG8 | 2016 | 1.42 | 634 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys104 |
| · | 5UG8 | 2017 | 1.46 | 8BP | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys104 |
| · | 6TFV | 2020 | 1.50 | N7Q | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys108 |
| · | 6TG0 | 2020 | 1.50 | N78 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys108 |
| · | 5HG5 | 2016 | 1.52 | 633 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys104 |
| · | 5UGC | 2017 | 1.58 | 8BS | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys104 |
| · | 6TG1 | 2020 | 1.60 | N82 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys108 |
| · | 8PO4 | 2024 | 1.62 | 26X | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys103 |
| · | 6TFY | 2020 | 1.70 | N7Z | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys108 |
| · | 6V66 | 2020 | 1.79 | QP1 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys102 |
| · | 6TFZ | 2020 | 1.80 | N7B | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys108 |
| · | 5HG7 | 2016 | 1.85 | 630 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys104 |
| · | 7A2A | 2020 | 1.90 | 7G9 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys108 |
| · | 9GC6 | 2025 | 1.90 | A1IZ9 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys105 |
| · | 9GC5 | 2025 | 1.91 | A1IZ8 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys105 |
| · | 9FZR | 2025 | 1.99 | A1IHC | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys104 |
| · | 7A6J | 2022 | 2.00 | R2E | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys108 |
| · | 7A6K | 2022 | 2.00 | R28 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys108 |
| · | 6TFU | 2020 | 2.00 | N7K | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys108 |
| · | 6TFW | 2020 | 2.00 | N7W | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys108 |
| · | 6Z4D | 2020 | 2.00 | 8BS | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys108 |
| · | 6XL4 | 2021 | 2.06 | Q6K | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys103 |
| · | 9GHR | 2026 | 2.10 | A1ILN | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys108 |
| · | 6V6O | 2020 | 2.10 | QQM | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys102 |
| · | 8PO1 | 2024 | 2.11 | 2EI | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys107 |
| · | 8PO3 | 2024 | 2.13 | 2II | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys105 |
| · | 5HG9 | 2016 | 2.15 | 63A | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys104 |
| · | 7T4J | 2022 | 2.20 | R28 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys106 |
| · | 6V6K | 2020 | 2.20 | QQJ | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys102 |
| · | 9GDV | 2025 | 2.22 | Q6K | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys105 |
| · | 9GHU | 2026 | 2.25 | A1ILK | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys108 |
| · | 8PO2 | 2024 | 2.28 | 26X | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys107 |
| · | 8GK5 | 2024 | 2.30 | Q6K | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys106 |
| · | 8F1X | 2023 | 2.30 | R28 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys106 |
| · | 7A6I | 2022 | 2.40 | R1W | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys108 |
| · | 7UKV | 2022 | 2.40 | ZRT | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys103 |
| · | 7JXL | 2021 | 2.40 | VO7 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys106 |
| · | 9GC4 | 2025 | 2.42 | A1IZ7 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys107 |
| · | 9HBO | 2025 | 2.45 | A1IUK | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys107 |
| · | 9GHV | 2026 | 2.50 | A1ILI | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys108 |
| · | 7B85 | 2022 | 2.50 | R28 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys108 |
| · | 6Z4B | 2020 | 2.50 | Q6K | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys108 |
| · | 8PNZ | 2024 | 2.51 | 2I0 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys104 |
| · | 8PO0 | 2024 | 2.52 | 2I6 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys107 |
| · | 6D8E | 2018 | 2.54 | FZP | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys102 |
| · | 9NM0 | 2025 | 2.59 | VO7 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys102 |
| · | 9GHS | 2026 | 2.60 | A1ILJ | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys108 |
| · | 7UKW | 2022 | 2.60 | ZRT | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys103 |
| · | 7T4I | 2022 | 2.61 | R28 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys103 |
| · | 5FED | 2016 | 2.65 | 5X4 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys103 |
| · | 8TJL | 2024 | 2.70 | HZ6 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys106 |
| · | 5FEE | 2016 | 2.70 | 5X4 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys103 |
| · | 8F1Y | 2023 | 2.75 | R2E | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys106 |
| · | 6VH4 | 2020 | 2.80 | QQM | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys102 |
| · | 7JXI | 2021 | 3.00 | 8BS | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys106 |
| · | 4R5S | 2014 | 3.00 | FI3 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys106 |
| · | 5UWD | 2017 | 3.06 | 8OV | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys104 |
| · | 7JXK | 2021 | 3.10 | 8BS | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys106 |
| · | 7LGS | 2021 | 3.10 | Q6K | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys106 |
| · | 8F1W | 2023 | 3.20 | R2E | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys106 |
| · | 4WD5 | 2016 | 3.30 | 3LH | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys106 |
| · | 4LRM | 2014 | 3.53 | YUN | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys109 |
| · | 6VHP | 2020 | 3.60 | QP1 | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys102 |
| · | 4LL0 | 2013 | 4.00 | YUN | F1/F2-ambig | — | post-product propanamide (parent: acrylamide F1 or terminal  | Cys106 |
|   | 9H42 | 2026 | 2.60 | A1IR8 | F3 | EGFR pyrido[2,3-d]pyrimidin-7-one (5-ethyl) | pyrido-pyrimidinone Michael acceptor (no acrylamide in name) | Cys81 |
|   | 5Y25 | 2018 | 3.10 | 8LU | F4 | EGFR 2-fluoroacetyl-pyrrolidine probe | 2-fluoroacetamide (haloacetyl, SN2) | Cys107 |
|   | 9H46 | 2024 | 3.16 | A1ISA | F3 | EGFR pyrido[2,3-d]pyrimidin-7-one (5-ethyl, 2-methoxy) | pyrido-pyrimidinone Michael acceptor | Cys81 |