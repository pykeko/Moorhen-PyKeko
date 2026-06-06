import json, urllib.request
GQL = "https://data.rcsb.org/graphql"
q = '''{ entries(entry_ids: ["8FD9","8FF0"]) { rcsb_id struct { title } } }'''
req = urllib.request.Request(GQL, data=json.dumps({"query":q}).encode(),
                              headers={"Content-Type":"application/json"})
with urllib.request.urlopen(req, timeout=30) as r:
    print(json.dumps(json.loads(r.read()), indent=2))
