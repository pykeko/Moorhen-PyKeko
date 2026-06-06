# Reference papers for the covalent-ligand workflow

This directory holds PDFs of the canonical reference literature for
[`../covalent-ligand-plan.md`](../covalent-ligand-plan.md). PDFs are not
committed to git by default (CCP4 papers are gold OA, but the IUCr / PMC
servers gate automated download with reCAPTCHA / Cloudflare, so each download
has to come from a browser). Drop the PDFs here manually and the plan-doc
will resolve its references against them.

## The CCP4 covalent-link papers (the canonical pair)

Both published as a paired set in *Acta Cryst* D77, Part 6, June 2021,
by the Murshudov group at the MRC LMB. Open access (gold OA in IUCr's
diamond OA Acta D model).

### Methods recipe → `nicholls-modelling-2021.pdf`

> **Nicholls, R.A., Joosten, R.P., Long, F., Wojdyr, M., Lebedev, A.,
> Krissinel, E., Catapano, L., Fischer, M., Emsley, P. & Murshudov, G.N.
> (2021).** "Modelling covalent linkages in CCP4."
> *Acta Cryst* D**77**, 712–726.

- DOI: [10.1107/S2059798321001753](https://doi.org/10.1107/S2059798321001753)
- IUCr article ID: **ir5021**
- PMC: [PMC8171069](https://pmc.ncbi.nlm.nih.gov/articles/PMC8171069/)
- PubMed: 34076587
- Browser URLs (any of these will pass the reCAPTCHA challenge in a real browser):
  - PMC PDF: https://pmc.ncbi.nlm.nih.gov/articles/PMC8171069/pdf/d-77-00712.pdf
  - IUCr: https://journals.iucr.org/d/issues/2021/06/00/ir5021/index.html

**What it's for:** the recipe. Documents the CCP4 Monomer Library
link-dictionary format (`_chem_link`, `_chem_link_bond/angle/tor/chir/plane`,
paired `data_mod_*` records with `_chem_mod_atom` / `_chem_mod_bond`), the
AceDRG three-stage process (declare → composite → diff-against-unmodified),
and four worked examples: **NAG-ASN** (N-glycosylation), **LYS-PLP** (Schiff
base — closest mechanistic analogue to a Cys-warhead Michael addition),
**MET-TYR / TYR-TRP cross-links**, **HEC-CYS thioether**. Our plan-doc's
Appendix A.1 template format follows this paper directly.

### Empirical survey + worked case study → `nicholls-missing-link-2021.pdf`

> **Nicholls, R.A., Wojdyr, M., Joosten, R.P., Catapano, L., Long, F.,
> Fischer, M., Emsley, P. & Murshudov, G.N. (2021).** "The missing link:
> covalent linkages in structural models."
> *Acta Cryst* D**77**, 727–745.

- DOI: [10.1107/S2059798321003934](https://doi.org/10.1107/S2059798321003934)
- IUCr article ID: **ir5022**
- PMC: [PMC8171067](https://pmc.ncbi.nlm.nih.gov/articles/PMC8171067/)
- PubMed: 34076588
- Browser URLs:
  - PMC PDF: https://pmc.ncbi.nlm.nih.gov/articles/PMC8171067/pdf/d-77-00727.pdf
  - IUCr: https://journals.iucr.org/d/issues/2021/06/00/ir5022/index.html

**What it's for:** the empirical backbone. Scans the PDB for unannotated
Cys-S↔non-S close contacts (independently validating our own §2.0 survey
five years later), quantifies the **systematic geometric drift** when LINK
records are missing (bonds refine ~0.1 Å too long), announces the recent
CCP4-ML expansion of >16,000 new + >11,000 replaced component dictionaries
via AceDRG, and includes a **SARS-CoV-2 main protease covalent inhibitor
case study** — chloroacetamide warhead vs Cys145, our closest published
worked analogue to the BTK Cys-covalent F2 workflow. **Read §6 (the Mpro
case study) before authoring the F2 link CIF in production**; it gives
tightened restraint targets and shows the no-link / LINK-only / LINK+dict
spread of post-refinement outcomes.

### Modern Refmac5 frontend → `yamashita-2023-gemmi-servalcat.pdf`

> **Yamashita, K., Wojdyr, M., Long, F., Nicholls, R.A. & Murshudov, G.N. (2023).**
> "GEMMI and Servalcat restrain REFMAC5."
> *Acta Cryst* D**79**, 368–373.

- DOI: [10.1107/S2059798323002413](https://doi.org/10.1107/S2059798323002413)
- IUCr article ID: **qe5004**
- PMC: [PMC10167671](https://pmc.ncbi.nlm.nih.gov/articles/PMC10167671/)
- PubMed: 37158197
- Browser URLs:
  - PMC PDF: https://pmc.ncbi.nlm.nih.gov/articles/PMC10167671/pdf/d-79-00368.pdf
  - IUCr: https://journals.iucr.org/d/issues/2023/05/00/qe5004/index.html

**What it's for:** the modern Refmac5 frontend architecture. Documents how
Servalcat (the orchestrator) + Gemmi (the library) now drive Refmac5's
restraint generation, with `_struct_conn` auto-perception, link-specificity
matching, and atom-name aliases for nonstandard monomers. The drop-in
`refmacat XYZIN model.cif HKLIN data.mtz LIBIN lig.cif` command is the
new entry point. Versions reported: REFMAC5.8.0405 / GEMMI 0.6.0 /
Servalcat 0.4.0. Both Gemmi and Servalcat are **MPL-2.0 licensed**
(industrial-friendly); CCP4-ML monomers are LGPL. **Read this before
writing any external-tool integration code in PyKeko** — it's the spec
sheet for what `_struct_conn` means at refinement time, including the
chirality + torsion tie-breaking for multi-link-match disambiguation.

## Other refs worth pinning here later

If we move into the AceDRG-fallback path for novel warheads outside the
pre-baked library (task #133), add:

> **Long, F., Nicholls, R.A., Emsley, P., Brzozowski, A.M., Pannu, N.S.,
> Lebedev, A.A. & Murshudov, G.N. (2017).** "AceDRG: a stereochemical
> description generator for ligands." *Acta Cryst* D**73**, 112–122.
> DOI 10.1107/S2059798317000067 · PMC5571904.

For the F2-specific BTK structural references (acalabrutinib, tirabrutinib),
also worth grabbing:

> **Lin, D.Y. & Andreotti, A.H. (2023).** "Structure of BTK kinase domain
> with the second-generation inhibitors acalabrutinib and tirabrutinib."
> *PLoS ONE* **18**(8), e0290872. PMC10470882.

And the original acalabrutinib pharmacology / medchem rationale:

> **Barf, T. *et al.* (2017).** "Acalabrutinib (ACP-196): A covalent
> Bruton tyrosine kinase inhibitor with a differentiated selectivity and
> in vivo potency profile." *J. Pharmacol. Exp. Ther.* **363**(2), 240–252.
> PMID 28882879.

## .gitignore policy

Per-file decision when each PDF lands here:

- **Commit it** if the paper is small (< 2 MB) and gold OA (we have the
  right to redistribute, and it keeps the project archive self-contained).
- **`.gitignore` it** if either (a) the paper is large or (b) we're not
  certain about the redistribution license. In that case the `README.md`
  pointer at the top of this file still makes the paper one click away
  for any future reader.

Both Nicholls 2021 papers are CC-BY (gold OA in Acta D); committing the
PDFs is safe. **Both PDFs are present as of 2026-06-06**:

- `nicholls-modelling-2021.pdf` (1.9 MB, 15 pages, methods recipe)
- `nicholls-missing-link-2021.pdf` (2.3 MB, 19 pages, empirical survey + Mpro case)
