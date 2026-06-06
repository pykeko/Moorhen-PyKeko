import json
with open('/tmp/btk-egfr-inventory/BTK_all_ids.json') as f:
    btk = json.load(f)['ids']
print("5KUP in list:", "5KUP" in btk)
print("5P9K in list:", "5P9K" in btk)
print("5P9L in list:", "5P9L" in btk)
print("5P9J in list:", "5P9J" in btk)
print("5P9M in list:", "5P9M" in btk)
print("6O8I in list:", "6O8I" in btk)
print("BTK total:", len(btk))
