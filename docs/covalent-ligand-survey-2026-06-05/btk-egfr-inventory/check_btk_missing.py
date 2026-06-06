"""Check what UniProt accession 8FD9 / 8FF0 carry."""
import json, urllib.request
GQL = "https://data.rcsb.org/graphql"
q = '''
{
  entries(entry_ids: ["8FD9","8FF0","8X2A","9CUW","9CUX","9YSI","8ETK","8EWT","8R5F","9D02","9OGN","9ZAW","7DHJ","7GHH","7JXH","7MAU","7MAV","7MB2","7MB3","7WNV","8A1N","6OWC","6Q2A","2QLQ","2QQ7","4I24","5QIU","5VIE","5X02","6E37","8FD9"]) {
    rcsb_id
    struct { title }
    polymer_entities {
      rcsb_polymer_entity_container_identifiers {
        reference_sequence_identifiers { database_accession database_name }
      }
    }
  }
}
'''
req = urllib.request.Request(GQL, data=json.dumps({"query":q}).encode(), headers={"Content-Type":"application/json"})
with urllib.request.urlopen(req, timeout=60) as r:
    body = json.loads(r.read())
for e in body.get('data',{}).get('entries') or []:
    if not e: continue
    accs = []
    for pe in e.get('polymer_entities') or []:
        for ri in (pe.get('rcsb_polymer_entity_container_identifiers') or {}).get('reference_sequence_identifiers') or []:
            accs.append(f"{ri.get('database_name')}:{ri.get('database_accession')}")
    print(f"{e['rcsb_id']:8} {','.join(accs):60} title={e['struct']['title'][:80]}")
