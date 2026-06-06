"""Re-query RCSB with BOTH human BTK (Q06187) and mouse BTK (P35991)."""
import json, urllib.request

SEARCH_URL = "https://search.rcsb.org/rcsbsearch/v2/query"

def query(accs):
    nodes = [
        {
            "type": "group", "logical_operator": "or",
            "nodes": [
                {
                    "type": "terminal", "service": "text",
                    "parameters": {
                        "attribute": "rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_accession",
                        "operator": "exact_match", "value": acc
                    }
                } for acc in accs
            ]
        },
        {
            "type": "terminal", "service": "text",
            "parameters": {
                "attribute": "rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_name",
                "operator": "exact_match", "value": "UniProt"
            }
        },
    ]
    return {
        "query": {"type":"group","logical_operator":"and","nodes":nodes},
        "return_type": "entry",
        "request_options": {
            "results_content_type": ["experimental"],
            "paginate": {"start": 0, "rows": 5000},
            "results_verbosity": "compact"
        }
    }

def run(accs, label):
    q = query(accs)
    req = urllib.request.Request(SEARCH_URL, data=json.dumps(q).encode(),
                                 headers={"Content-Type":"application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        body = json.loads(r.read())
    ids = body.get("result_set", [])
    print(f"{label} ({','.join(accs)}): {len(ids)} entries")
    with open(f'/tmp/btk-egfr-inventory/{label}_all_ids.json','w') as f:
        json.dump({"uniprots": accs, "count": len(ids), "ids": ids}, f, indent=2)
    return ids

# BTK: Q06187 (human), P35991 (mouse) — both treated as in-scope since the 
# kinase domain is conserved. Also include P51813 (BMX/ETK), which is the BTK
# Tec-family neighbor — many "BTK selectivity probe" structures pop here.
# Actually the user explicitly said BTK (human). I'll do Q06187 + P35991 (both
# BTK orthologs) but NOT BMX. We can flag BMX separately if found via title.
btk = run(["Q06187", "P35991"], "BTK")
egfr = run(["P00533"], "EGFR")
# Also try EGFR mouse (Q01279)
egfr_mouse = run(["P00533", "Q01279"], "EGFR_with_mouse")
