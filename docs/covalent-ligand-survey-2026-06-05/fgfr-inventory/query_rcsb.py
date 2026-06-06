#!/usr/bin/env python3
"""Query RCSB Search API for entries linked to FGFR1/2/3/4 UniProt accessions.

Pattern mirrors BTK/EGFR: pull FULL set per UniProt, then later intersect with
the 2026-06-05 Cys-covalent classified survey AND re-classify directly via
struct_conn data for completeness.
"""
import json
import urllib.request

SEARCH_URL = "https://search.rcsb.org/rcsbsearch/v2/query"

TARGETS = [
    # Human
    ("P11362", "FGFR1"),
    ("P21802", "FGFR2"),
    ("P22607", "FGFR3"),
    ("P22455", "FGFR4"),
    # Mouse (include for completeness; small)
    ("P16092", "FGFR1_MOUSE"),
    ("P21803", "FGFR2_MOUSE"),
    ("Q61851", "FGFR3_MOUSE"),
    ("Q03142", "FGFR4_MOUSE"),
]

def build_query(uniprot_acc):
    return {
        "query": {
            "type": "group",
            "logical_operator": "and",
            "nodes": [
                {
                    "type": "terminal",
                    "service": "text",
                    "parameters": {
                        "attribute": "rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_accession",
                        "operator": "exact_match",
                        "value": uniprot_acc
                    }
                },
                {
                    "type": "terminal",
                    "service": "text",
                    "parameters": {
                        "attribute": "rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_name",
                        "operator": "exact_match",
                        "value": "UniProt"
                    }
                },
            ]
        },
        "return_type": "entry",
        "request_options": {
            "results_content_type": ["experimental"],
            "paginate": {"start": 0, "rows": 5000},
            "results_verbosity": "compact"
        }
    }

def run(uniprot_acc, label):
    q = build_query(uniprot_acc)
    req = urllib.request.Request(SEARCH_URL,
                                  data=json.dumps(q).encode(),
                                  headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            if not raw.strip():
                body = {}
            else:
                body = json.loads(raw)
    except urllib.error.HTTPError as e:
        if e.code == 204:
            body = {}
        else:
            raise
    ids = body.get("result_set", [])
    print(f"{label} ({uniprot_acc}): {len(ids)} entries")
    out_path = f"/tmp/fgfr-inventory/{label}_all_ids.json"
    with open(out_path, "w") as f:
        json.dump({"uniprot": uniprot_acc, "label": label, "count": len(ids), "ids": ids}, f, indent=2)
    return ids

if __name__ == "__main__":
    all_ids = {}
    for acc, lab in TARGETS:
        all_ids[lab] = run(acc, lab)
    # Combined dedup
    combined = sorted(set(i for ids in all_ids.values() for i in ids))
    with open('/tmp/fgfr-inventory/ALL_FGFR_ids.json', 'w') as f:
        json.dump({'count': len(combined), 'ids': combined}, f, indent=2)
    print(f"\nCombined (dedup) FGFR1-4 (human+mouse): {len(combined)}")
