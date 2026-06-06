#!/usr/bin/env python3
"""Query RCSB Search API for entries linked to BTK or EGFR UniProt accession.

We pull the FULL set of entries per target, then intersect with the existing
2026-06-05 Cys-covalent classified survey to get the covalent subset. This is
more robust than relying on the LIGAND_COVALENT_LINKAGE feature flag (whose
exact attribute name in the search index has shifted across RCSB versions).
"""
import json
import urllib.request

SEARCH_URL = "https://search.rcsb.org/rcsbsearch/v2/query"

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
    with urllib.request.urlopen(req, timeout=60) as r:
        body = json.loads(r.read())
    ids = body.get("result_set", [])
    print(f"{label} ({uniprot_acc}) all entries: {len(ids)}")
    out_path = f"/tmp/btk-egfr-inventory/{label}_all_ids.json"
    with open(out_path, "w") as f:
        json.dump({"uniprot": uniprot_acc, "count": len(ids), "ids": ids}, f, indent=2)
    return ids

if __name__ == "__main__":
    btk_all = run("Q06187", "BTK")
    egfr_all = run("P00533", "EGFR")
