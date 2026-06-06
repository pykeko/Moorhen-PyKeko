import json
with open('/tmp/btk-egfr-inventory/BTK_all_ids.json') as f:
    btk_all = set(json.load(f)['ids'])
with open('/tmp/btk-egfr-inventory/BTK_final.json') as f:
    btk_found = {r['entry'] for r in json.load(f)}
missing = btk_all - btk_found
print(f"BTK: {len(btk_all)} total, {len(btk_found)} with Cys-SG covalent, {len(missing)} missing/non-covalent")
print("Notable BTK F2 entries that we missed (no covale row?):")
key_f2 = {'5KUP', '5P9M', '5P9J', '5P9K', '5P9L', '6O8I', '8FD9', '8FF0', '8X2A', '9CUW', '9CUX', '9YSI'}
for k in sorted(key_f2):
    if k in btk_all:
        if k not in btk_found:
            print(f"  {k}: in target but NOT detected as Cys-SG covalent")
        else:
            print(f"  {k}: detected OK")
    else:
        print(f"  {k}: NOT in BTK target list")

# Same for EGFR
with open('/tmp/btk-egfr-inventory/EGFR_all_ids.json') as f:
    egfr_all = set(json.load(f)['ids'])
with open('/tmp/btk-egfr-inventory/EGFR_final.json') as f:
    egfr_found = {r['entry'] for r in json.load(f)}
print(f"\nEGFR: {len(egfr_all)} total, {len(egfr_found)} with Cys-SG covalent, {len(egfr_all - egfr_found)} missing/non-covalent")
key_egfr_f2 = {'4I24', '4G5J', '4G5P', '4LRM', '4LL0', '5HG5', '5HG7', '5HG8', '5HG9', '5UG8', '5UG9', '5UGC',
               '6V66', '6V6K', '6XL4', '6Z4B', '6Z4D', '7A2A', '7A6K', '7B85', '7JXH', '7JXI', '7JXK', '7JXL',
               '7LGS', '7MAU', '7MAV', '7MB2', '7MB3', '7WNV', '8A1N', '8ETK', '8EWT', '8R5F', '9CUW', '9D02',
               '9DF4', '9F65', '9GHV', '9GL8', '9GL9', '9OGN', '9YSI', '9ZAW', '2QLQ', '2QQ7', '5QIU', '5VIE',
               '5X02', '6E37', '6OWC', '6Q2A', '7DHJ', '7GHH'}
for k in sorted(key_egfr_f2):
    if k in egfr_all and k not in egfr_found:
        print(f"  EGFR F2-from-plan missing: {k}")
