#!/usr/bin/env python3
"""Bulk-fetch _struct_conn + chem_comp data for all FGFR entries via the
RCSB Data GraphQL API. Same query as BTK/EGFR.
"""
import json
import urllib.request
import time

GQL = "https://data.rcsb.org/graphql"

QUERY = """
query Get($ids: [String!]!) {
  entries(entry_ids: $ids) {
    rcsb_id
    rcsb_entry_info {
      resolution_combined
      experimental_method
      inter_mol_covalent_bond_count
    }
    rcsb_accession_info {
      initial_release_date
    }
    struct {
      title
    }
    polymer_entities {
      rcsb_polymer_entity_container_identifiers {
        reference_sequence_identifiers {
          database_accession
          database_name
        }
      }
      polymer_entity_instances {
        rcsb_polymer_entity_instance_container_identifiers {
          asym_id
          auth_asym_id
        }
        rcsb_polymer_struct_conn {
          connect_type
          dist_value
          value_order
          connect_partner {
            label_asym_id
            label_atom_id
            label_comp_id
            label_seq_id
            label_alt_id
          }
          connect_target {
            label_asym_id
            label_atom_id
            label_comp_id
            label_seq_id
            label_alt_id
          }
        }
      }
    }
    nonpolymer_entities {
      rcsb_nonpolymer_entity_container_identifiers {
        nonpolymer_comp_id
        chem_ref_def_id
      }
      nonpolymer_comp {
        chem_comp {
          id
          name
          formula
          type
        }
      }
      nonpolymer_entity_instances {
        rcsb_nonpolymer_entity_instance_container_identifiers {
          asym_id
          auth_asym_id
          comp_id
        }
        rcsb_nonpolymer_struct_conn {
          connect_type
          dist_value
          value_order
          connect_partner {
            label_asym_id
            label_atom_id
            label_comp_id
            label_seq_id
            label_alt_id
          }
          connect_target {
            label_asym_id
            label_atom_id
            label_comp_id
            label_seq_id
            label_alt_id
          }
        }
      }
    }
  }
}
"""

def batch(ids, n=25):
    for i in range(0, len(ids), n):
        yield ids[i:i+n]

def fetch_ids(ids):
    payload = {"query": QUERY, "variables": {"ids": ids}}
    req = urllib.request.Request(
        GQL,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read())

def run():
    with open('/tmp/fgfr-inventory/ALL_FGFR_ids.json') as f:
        ids = json.load(f)['ids']
    print(f"Fetching {len(ids)} FGFR entries...")
    out_path = '/tmp/fgfr-inventory/FGFR_raw.jsonl'
    with open(out_path, 'w') as fout:
        for i, b in enumerate(batch(ids, 25)):
            for attempt in range(3):
                try:
                    res = fetch_ids(b)
                    break
                except Exception as e:
                    print(f"  batch {i} attempt {attempt+1} failed: {e}")
                    time.sleep(5)
            else:
                print(f"  batch {i} GAVE UP")
                continue
            entries = res.get('data', {}).get('entries') or []
            for e in entries:
                if e:
                    fout.write(json.dumps(e) + '\n')
            print(f"  batch {i+1}: {len(entries)} entries")
            time.sleep(0.5)
    print(f"  -> {out_path}")

if __name__ == "__main__":
    run()
