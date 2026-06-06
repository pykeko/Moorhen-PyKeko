#!/usr/bin/env python3
"""Fetch UniProt offset (ref_beg - entity_beg) for each FGFR entry so we can
report the auth/UniProt Cys number per covalent hit.

The label_seq_id in struct_conn is the entity-numbered seq id (1-based on the
polymer entity). UniProt position = label_seq_id + (ref_beg - entity_beg).
"""
import json
import urllib.request
import time
from collections import defaultdict

Q = """query Q($ids: [String!]!) {
  entries(entry_ids: $ids) {
    rcsb_id
    polymer_entities {
      rcsb_polymer_entity_container_identifiers {
        entity_id
      }
      rcsb_polymer_entity_align {
        reference_database_accession
        reference_database_name
        aligned_regions {
          entity_beg_seq_id
          ref_beg_seq_id
          length
        }
      }
    }
  }
}"""

UNIPROT_TARGET = {
    'P11362': 'FGFR1', 'P21802': 'FGFR2', 'P22607': 'FGFR3', 'P22455': 'FGFR4',
    'P16092': 'FGFR1', 'P21803': 'FGFR2', 'Q61851': 'FGFR3', 'Q03142': 'FGFR4',
}
REACTIVE_CYS = {'FGFR1': 488, 'FGFR2': 491, 'FGFR3': 482, 'FGFR4': 552}


def batch(ids, n=25):
    for i in range(0, len(ids), n):
        yield ids[i:i+n]


def fetch(ids):
    body = json.dumps({'query': Q, 'variables': {'ids': ids}}).encode()
    req = urllib.request.Request('https://data.rcsb.org/graphql', data=body,
                                  headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def main():
    with open('/tmp/fgfr-inventory/FGFR_per_entry_refined.json') as f:
        rows = json.load(f)
    ids = sorted({r['entry'] for r in rows})

    offsets = {}  # entry -> {target: [(entity_beg, ref_beg, length), ...]}
    for i, b in enumerate(batch(ids, 25)):
        for attempt in range(3):
            try:
                res = fetch(b)
                break
            except Exception as e:
                print(f'batch {i} attempt {attempt+1} failed: {e}')
                time.sleep(5)
        ents = (res.get('data') or {}).get('entries') or []
        for e in ents:
            if not e:
                continue
            eid = e['rcsb_id']
            d = defaultdict(list)
            for pe in (e.get('polymer_entities') or []):
                for al in (pe.get('rcsb_polymer_entity_align') or []):
                    if al.get('reference_database_name') != 'UniProt':
                        continue
                    acc = al.get('reference_database_accession')
                    tgt = UNIPROT_TARGET.get(acc)
                    if tgt is None:
                        continue
                    for reg in (al.get('aligned_regions') or []):
                        d[tgt].append({
                            'entity_beg': reg['entity_beg_seq_id'],
                            'ref_beg': reg['ref_beg_seq_id'],
                            'length': reg['length'],
                            'offset': reg['ref_beg_seq_id'] - reg['entity_beg_seq_id'],
                        })
            offsets[eid] = dict(d)
        print(f'  batch {i+1}: {len(ents)} entries')
        time.sleep(0.3)

    # Annotate each row
    for r in rows:
        eid = r['entry']
        tgts = r.get('fgfr_targets') or []
        cys_seq = r.get('cys_seq')
        if cys_seq is None or not tgts:
            r['cys_uniprot'] = None
            r['cys_uniprot_target'] = None
            r['cys_is_reactive'] = None
            continue
        # For each target, see which aligned region contains the cys_seq
        best = None
        for tgt in tgts:
            regs = offsets.get(eid, {}).get(tgt, [])
            for reg in regs:
                if reg['entity_beg'] <= cys_seq < reg['entity_beg'] + reg['length']:
                    uniprot_pos = cys_seq + reg['offset']
                    candidate = (tgt, uniprot_pos)
                    # Prefer the candidate whose UniProt pos matches the known
                    # reactive Cys
                    if uniprot_pos == REACTIVE_CYS.get(tgt):
                        best = candidate
                        break
                    if best is None:
                        best = candidate
            if best and best[1] == REACTIVE_CYS.get(best[0]):
                break
        if best:
            r['cys_uniprot_target'] = best[0]
            r['cys_uniprot'] = best[1]
            r['cys_is_reactive'] = (best[1] == REACTIVE_CYS.get(best[0]))
        else:
            r['cys_uniprot_target'] = tgts[0] if tgts else None
            r['cys_uniprot'] = None
            r['cys_is_reactive'] = None

    with open('/tmp/fgfr-inventory/FGFR_per_entry_with_cys.json', 'w') as fo:
        json.dump(rows, fo, indent=2)

    # Summary
    print('\nCys position attribution:')
    for tgt in ('FGFR1', 'FGFR2', 'FGFR3', 'FGFR4'):
        sub = [r for r in rows if r.get('cys_uniprot_target') == tgt]
        reactive = sum(1 for r in sub if r.get('cys_is_reactive'))
        other = len(sub) - reactive
        positions = sorted({r.get('cys_uniprot') for r in sub if r.get('cys_uniprot')})
        print(f'  {tgt}: n={len(sub)}, hit Cys{REACTIVE_CYS[tgt]}: {reactive}, other Cys: {other}, positions: {positions}')


if __name__ == '__main__':
    main()
