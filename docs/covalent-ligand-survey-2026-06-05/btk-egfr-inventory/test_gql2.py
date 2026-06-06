import json, urllib.request
GQL = "https://data.rcsb.org/graphql"
q = open('/tmp/btk-egfr-inventory/fetch_entries.py').read()
# extract QUERY
import re
m = re.search(r'QUERY = """(.*?)"""', q, re.S)
query = m.group(1)
payload = {"query": query, "variables": {"ids": ["8FD9"]}}
req = urllib.request.Request(GQL, data=json.dumps(payload).encode(),
                              headers={"Content-Type":"application/json"})
with urllib.request.urlopen(req, timeout=30) as r:
    body = json.loads(r.read())
print(json.dumps(body, indent=2)[:2000])
