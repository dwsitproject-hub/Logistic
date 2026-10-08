"""
Regenerate docs/scripts/load-vessel-master-bersih.cjs from the sheet Vessel_Master_Bersih of
"docs/Vessel Cleanup (Jovin, Klip, SAP) v2.xlsx".

    python docs/scripts/build-vessel-load-script.py

What goes into the script
  - every row whose "Kesiapan insert" is "Siap", and every held row whose "Nama final" has been filled in (that name is used);
    a held row without a final name is left out, and the pairs it belongs to are left out with it (the loader reports them);
  - one vessel per (role, name); codes only as the sheet gives them (never from a TB+BG combined name);
  - one pair per Pair ID, with the combined SAP names from the sheet Vessel_Split (names only, never codes).
Needs openpyxl.
"""
import collections
import datetime
import json
import os
import re
import sys

import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.dirname(HERE)
SRC = os.path.join(DOCS, 'Vessel Cleanup (Jovin, Klip, SAP) v2.xlsx')
TEMPLATE = os.path.join(HERE, 'load-vessel-master-bersih.template.cjs')
OUT = os.path.join(HERE, 'load-vessel-master-bersih.cjs')

wb = openpyxl.load_workbook(SRC, data_only=True)


def rows(name):
    it = wb[name].iter_rows(values_only=True)
    hdr = [str(h) for h in next(it)]
    return [dict(zip(hdr, r)) for r in it if any(c is not None for c in r)]


def clean(v):
    if v is None:
        return None
    s = re.sub(r'\s+', ' ', str(v).replace('\xa0', ' ')).strip()
    return s or None


def iso(v):
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.strftime('%Y-%m-%d')
    return None


def number(v):
    if v is None or str(v).strip() == '':
        return None
    try:
        f = float(str(v).replace(',', ''))
    except ValueError:
        return None
    return int(f) if f.is_integer() else f


def yes_no(v):
    s = (clean(v) or '').upper()
    return True if s in ('YES', 'Y', 'TRUE') else False if s in ('NO', 'N', 'FALSE') else None


master = rows('Vessel_Master_Bersih')
split = rows('Vessel_Split')
pair_link = rows('Vessel_Pair_Link')

old2new = {}
for r in pair_link:
    for o in re.split(r'[,;\s]+', str(r['Pair ID lama yang digabung'] or '')):
        if o:
            old2new[o] = r['Pair ID']

vessels = {}
final_name = {}  # (pair, role) -> name used, or None when held without a final name
for r in master:
    role = r['Role']
    final = clean(r['Nama final (isi bila perlu diubah)'])
    name = final or clean(r['Nama Vessel (bersih)'])
    ready = r['Kesiapan insert'] == 'Siap' or bool(final)
    final_name[(r['Pair ID'], role)] = name if (ready and name) else None
    if not (ready and name):
        continue
    key = (role, name)
    if key in vessels:
        continue
    codes = [c.strip() for c in str(r['Vessel Code (SAP)'] or '').split(',') if c.strip()]
    vessels[key] = {
        'role': role,
        'name': name,
        'codes': codes,
        'owner': (clean(r['Vessel Owner (Company Name)']) or '').upper() or None,
        'capacity': None if role == 'TB' else number(r['Vessel Capacity']),
        'vesselType': (clean(r['Vessel Type']) or '').upper() or None,
        'heating': yes_no(r['Heating']),
        'lambung': (clean(r['Type Lambung']) or '').upper() or None,
        'terms': (clean(r['Charter Type']) or '').upper() or None,
    }

sap_names = collections.defaultdict(list)
for r in split:
    pid = old2new.get(r['Pair ID'], r['Pair ID'])
    n = clean(r['SAP Vessel Name (asal)'])
    if n and n not in sap_names[pid]:
        sap_names[pid].append(n)

pairs = []
seen = set()
for r in master:
    pid = r['Pair ID']
    if pid in seen:
        continue
    seen.add(pid)
    pairs.append({
        'pairCode': pid,
        'tb': final_name.get((pid, 'TB')),
        'bg': final_name.get((pid, 'BG')),
        'firstContractDate': iso(r['Contract Date Pertama']),
        'lastContractDate': iso(r['Contract Date Terakhir']),
        'sapRows2026': number(r['Jumlah baris SAP (2026)']),
        'note': clean(r['Catatan pair']),
        'sapNames': sap_names.get(pid, []),
    })

data = {'vessels': list(vessels.values()), 'pairs': pairs}
template = open(TEMPLATE, encoding='utf-8').read()
assert '__DATA__' in template
open(OUT, 'w', encoding='utf-8', newline='\n').write(template.replace('__DATA__', json.dumps(data, indent=1, ensure_ascii=False)))
print(f"wrote {OUT}: {len(data['vessels'])} vessels "
      f"({sum(1 for v in data['vessels'] if v['role'] == 'TB')} TB, {sum(1 for v in data['vessels'] if v['role'] == 'BG')} BG), "
      f"{len(pairs)} pairs ({sum(1 for p in pairs if p['tb'] and p['bg'])} with both vessels), "
      f"{sum(1 for v in data['vessels'] if v['codes'])} vessels with codes", file=sys.stderr)
