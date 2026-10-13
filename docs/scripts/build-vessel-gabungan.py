"""Builds the sheet Vessel_Gabungan in a copy of the Vessel Cleanup workbook: every vessel in one list, laid out like the NAS sheet "Vessel - Pair".

  python -I docs/scripts/build-vessel-gabungan.py [source.xlsx] [output.xlsx]
  (defaults: docs/Vessel Cleanup (Jovin, Klip, SAP) v4.xlsx -> ... v6.xlsx; the source is never modified. If the output is open in Excel the save fails: pick another name.)

Columns: A:O are exactly the NAS sheet (Pair ID, Nama Vessel, Jumlah pair, Transaksi Klip, Company Code, Owner, Capacity, Vessel Type, Heating, Type Lambung,
Charter Type, Draft, LOA, Hull Type, Registration Year), P = Vessel Code SAP, Q = Sumber (info, not part of the paste range).
Rows, in order: pair vessels (Vessel_Master_Bersih), vessels input via KLIP, master_vessels production used by KLIP transactions, the rest of that master
(DHM sync), Jovin rows nothing else has. 'Transaksi Klip' is the SAP row count for a pair vessel and the active KLIP shipments for the others.
Vessel Code SAP follows the rule: only from a SAP row with a plain vessel name, never from a TB+BG combination; KLIP-made TMP- codes and the codes of
vessels input via KLIP are not SAP codes. The result is then normalised by build-vessel-prefix.py.
Needs openpyxl. Reads sheets: Vessel_Master_Bersih, Master_Prod_Klasifikasi, Jovin, KLIP, SAP, SAP_02Oct2026, Jovin_SAP_Mapping.
"""
import re
import sys
import collections
import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

SRC = sys.argv[1] if len(sys.argv) > 1 else 'D:/Project/Klip/docs/Vessel Cleanup (Jovin, Klip, SAP) v4.xlsx'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'D:/Project/Klip/docs/Vessel Cleanup (Jovin, Klip, SAP) v6.xlsx'
SHEET = 'Vessel_Gabungan'

wb = openpyxl.load_workbook(SRC)


def rows(name):
    return [list(r) for r in wb[name].iter_rows(values_only=True)]


def key(s):
    return re.sub(r'[^A-Z0-9]', '', str(s or '').upper())


def code_key(s):
    c = str(s or '').strip().upper()
    return c or None


def num(v):
    if v is None or v == '':
        return None
    if isinstance(v, (int, float)):
        return v
    t = str(v).strip().replace(',', '')
    try:
        f = float(t)
    except ValueError:
        return t
    return int(f) if f == int(f) else f


def txt(v):
    t = str(v).strip() if v is not None else ''
    return t or None


# ---------------------------------------------------------------- sources
master = rows('Vessel_Master_Bersih')
prod = rows('Master_Prod_Klasifikasi')[1:]
jovin = rows('Jovin')[1:]
klip_old = rows('KLIP')[1:]
sap02 = rows('SAP_02Oct2026')[1:]

# Jovin (DHM file): by name key. First row with the most filled fields wins.
jovin_by_key = {}
for r in jovin:
    k = key(r[0])
    if not k:
        continue
    filled = sum(1 for x in r if x not in (None, ''))
    cur = jovin_by_key.get(k)
    if cur is None or filled > cur[0]:
        jovin_by_key[k] = (filled, r)
jovin_by_key = {k: v[1] for k, v in jovin_by_key.items()}

klip_old_by_code = {code_key(r[1]): r for r in klip_old if code_key(r[1])}
klip_old_by_key = {key(r[0]): r for r in klip_old if key(r[0])}

sap02_by_code = {code_key(r[0]): r for r in sap02 if code_key(r[0])}
sap02_by_key = {key(r[1]): r for r in sap02 if key(r[1])}

prod_by_key = {}
prod_by_code = {}
for r in prod:
    prod_by_key.setdefault(key(r[3]), r)
    if code_key(r[2]):
        prod_by_code.setdefault(code_key(r[2]), r)

# SAP vessel codes by plain vessel name (rule: never from a TB+BG combination, where one code stands for two vessels)
COMBO = re.compile(r'(/|TB.*BG|BG.*TB)')
sap_plain_by_key = collections.defaultdict(list)
for r in rows('SAP')[1:]:
    c, n = code_key(r[0]), txt(r[1])
    if not c or not n or COMBO.search(n.upper()):
        continue
    if c not in sap_plain_by_key[key(n)]:
        sap_plain_by_key[key(n)].append(c)
jovin_map_by_key = collections.defaultdict(list)
for r in rows('Jovin_SAP_Mapping')[1:]:
    c, n = code_key(r[1]), txt(r[2])
    if r[12] != 'exact' or not c or not n or ',' in c or COMBO.search(n.upper()):
        continue
    if c not in jovin_map_by_key[key(n)]:
        jovin_map_by_key[key(n)].append(c)


def real_code(c):
    c = code_key(c)
    return c if c and not c.startswith('TMP-') else None


PREFIX = re.compile(r'^(BG|TB|TK|MT|MV|SPOB|KM)')


def strip_prefix(k):
    return PREFIX.sub('', k)


# ---------------------------------------------------------------- pair rows
# master columns: 0 Pair ID, 2 Role, 3 Nama bersih, 7 jumlah pair, 11 jumlah baris SAP, 17 kode SAP, 20 company code, 21 owner, 22 capacity,
# 23 type, 24 heating, 25 lambung, 26 charter, 27 draft, 28 LOA, 29 hull type, 30 year, 35 nama final
OUT_ROWS = []  # dicts with the 15 NAS columns + sources + flags
used_keys = set()   # name keys already on the sheet
used_codes = set()  # vessel codes already on the sheet


def attrs_from_sources(name, code):
    """Attribute candidates for a vessel from Jovin / old KLIP list / production master / SAP 02 Okt, in that priority."""
    k = key(name)
    j = jovin_by_key.get(k)
    ko = klip_old_by_code.get(code_key(code)) or klip_old_by_key.get(k)
    pr = prod_by_code.get(code_key(code)) or prod_by_key.get(k)
    s2 = sap02_by_code.get(code_key(code)) or sap02_by_key.get(k)
    a = {}
    codes = []

    def add_code(c):
        c = real_code(c)
        if c and c not in codes:
            codes.append(c)

    for c in sap_plain_by_key.get(k, []):
        add_code(c)
    for c in jovin_map_by_key.get(k, []):
        add_code(c)
    if j:
        a['company_code'] = txt(j[1])
        a['owner'] = txt(j[2])
        a['capacity'] = num(j[3])
        a['type'] = txt(j[4])
        a['heating'] = txt(j[5])
        a['lambung'] = txt(j[6])
        a['charter'] = txt(j[7])
    if ko:
        a.setdefault('owner', None)
        a['owner'] = a.get('owner') or txt(ko[3])
        a['capacity'] = a.get('capacity') or num(ko[2])
        a['type'] = a.get('type') or txt(ko[5])
        a['heating'] = a.get('heating') or txt(ko[7])
        a['lambung'] = a.get('lambung') or txt(ko[8])
    if pr:
        a['owner'] = a.get('owner') or txt(pr[5])
        a['capacity'] = a.get('capacity') or num(pr[6])
    if pr:
        add_code(pr[2])
    if ko:
        add_code(ko[1])
    if s2:
        add_code(s2[0])
        a['draft'] = num(s2[2])
        a['loa'] = num(s2[3])
        a['capacity'] = a.get('capacity') or num(s2[4])
        a['hull'] = txt(s2[5])
        a['year'] = num(s2[6])
    a['codes'] = codes
    return a, {'jovin': bool(j), 'klip_old': bool(ko), 'prod': bool(pr)}


for r in master[1:]:
    name = txt(r[35]) or txt(r[3])
    role = r[2]
    row = {
        'pair': txt(r[0]),
        'name': name,
        'pairs': num(r[7]) or 0,
        'tx': num(r[11]) or 0,
        'company_code': txt(r[20]),
        'owner': txt(r[21]),
        'capacity': num(r[22]),
        'type': txt(r[23]),
        'heating': txt(r[24]),
        'lambung': txt(r[25]),
        'charter': txt(r[26]),
        'draft': num(r[27]),
        'loa': num(r[28]),
        'hull': txt(r[29]),
        'year': num(r[30]),
        'code': txt(r[17]),
        'sources': ['Pair SAP'],
        'klip_input': False,
        'group': 0,
        'order': (txt(r[0]) or '', 0 if role == 'TB' else 1),
    }
    code = r[17]
    extra, found = attrs_from_sources(name, code) if name else ({}, {})
    for f in ('company_code', 'owner', 'capacity', 'type', 'heating', 'lambung', 'charter', 'draft', 'loa', 'hull', 'year'):
        if f == 'capacity' and role == 'TB':
            continue  # by design the cleaned list leaves tug capacity empty
        if row[f] in (None, '') and extra.get(f) not in (None, ''):
            row[f] = extra[f]
    if found.get('prod'):
        row['sources'].append('Master KLIP')
    if found.get('jovin'):
        row['sources'].append('Jovin/DHM')
    if found.get('klip_old'):
        row['sources'].append('KLIP (daftar lama)')
    OUT_ROWS.append(row)
    if name:
        used_keys.add(key(name))
    if code_key(code):
        used_codes.add(code_key(code))

# a production master vessel that is one of the pair vessels (by name or code) is the same vessel: tag those rows as 'Master KLIP'
pair_row_by_key = collections.defaultdict(list)
for row in OUT_ROWS:
    if row['name']:
        pair_row_by_key[key(row['name'])].append(row)
for r in master[1:]:
    if code_key(r[17]):
        pc = prod_by_code.get(code_key(r[17]))
        if pc:
            for row in pair_row_by_key.get(key(txt(r[35]) or txt(r[3])), []):
                if 'Master KLIP' not in row['sources']:
                    row['sources'].append('Master KLIP')
                if pc[14] == 'Ya' and 'Input via KLIP' not in row['sources']:
                    row['sources'].append('Input via KLIP')
                    row['klip_input'] = True
for pr in prod:
    for row in pair_row_by_key.get(key(pr[3]), []):
        if pr[14] == 'Ya' and 'Input via KLIP' not in row['sources']:
            row['sources'].append('Input via KLIP')
            row['klip_input'] = True

# ---------------------------------------------------------------- production master (DHM sync, KLIP input)
used_keys_nostrip = set(used_keys)


def matched_to_existing(name, code):
    k = key(name)
    if k in used_keys or (code_key(code) and code_key(code) in used_codes and not str(code).upper().startswith('TMP-')):
        return True
    return False


prod_sorted = sorted(prod, key=lambda r: (str(r[3] or '').upper()))
for pr in prod_sorted:
    name, code = txt(pr[3]), pr[2]
    if not name or matched_to_existing(name, code):
        continue
    extra, found = attrs_from_sources(name, code)
    klip_input = pr[14] == 'Ya'
    tx = max(num(pr[9]) or 0, num(pr[10]) or 0)
    row = {
        'pair': None, 'name': name, 'pairs': 0, 'tx': tx,
        'company_code': extra.get('company_code'), 'owner': extra.get('owner'), 'capacity': extra.get('capacity'),
        'type': extra.get('type'), 'heating': extra.get('heating'), 'lambung': extra.get('lambung'), 'charter': extra.get('charter'),
        'draft': extra.get('draft'), 'loa': extra.get('loa'), 'hull': extra.get('hull'), 'year': extra.get('year'),
        'code': ', '.join(extra.get('codes') or []) or None,
        'sources': ['Master KLIP'], 'klip_input': klip_input,
        'group': 1 if klip_input else (2 if tx > 0 else 3),
        'order': (name.upper(),),
    }
    if klip_input:
        row['sources'].append('Input via KLIP')
        row['code'] = None  # the code of a vessel typed into KLIP is KLIP's own (KEIHO, KDAH ...); SAP does not know it yet
    if found.get('jovin'):
        row['sources'].append('Jovin/DHM')
    if found.get('klip_old'):
        row['sources'].append('KLIP (daftar lama)')
    OUT_ROWS.append(row)
    used_keys.add(key(name))
    if code_key(code):
        used_codes.add(code_key(code))

# ---------------------------------------------------------------- Jovin / DHM file rows no other source has
for r in sorted(jovin, key=lambda r: str(r[0] or '').upper()):
    name = txt(r[0])
    if not name or key(name) in used_keys:
        continue
    extra, found = attrs_from_sources(name, None)
    row = {
        'pair': None, 'name': name, 'pairs': 0, 'tx': 0,
        'company_code': extra.get('company_code'), 'owner': extra.get('owner'), 'capacity': extra.get('capacity'),
        'type': extra.get('type'), 'heating': extra.get('heating'), 'lambung': extra.get('lambung'), 'charter': extra.get('charter'),
        'draft': extra.get('draft'), 'loa': extra.get('loa'), 'hull': extra.get('hull'), 'year': extra.get('year'),
        'code': ', '.join(extra.get('codes') or []) or None,
        'sources': ['Jovin/DHM'], 'klip_input': False, 'group': 4, 'order': (name.upper(),),
    }
    OUT_ROWS.append(row)
    used_keys.add(key(name))

# ---------------------------------------------------------------- old KLIP list rows no other source has (match by code, then by name without prefix)
all_stripped = {strip_prefix(k) for k in used_keys}
for r in sorted(klip_old, key=lambda r: str(r[0] or '').upper()):
    name, code = txt(r[0]), r[1]
    if not name:
        continue
    if key(name) in used_keys or (code_key(code) and code_key(code) in used_codes) or strip_prefix(key(name)) in all_stripped:
        continue
    extra, found = attrs_from_sources(name, code)
    row = {
        'pair': None, 'name': name, 'pairs': 0, 'tx': 0,
        'company_code': extra.get('company_code'), 'owner': extra.get('owner'), 'capacity': extra.get('capacity'),
        'type': extra.get('type'), 'heating': extra.get('heating'), 'lambung': extra.get('lambung'), 'charter': extra.get('charter'),
        'draft': extra.get('draft'), 'loa': extra.get('loa'), 'hull': extra.get('hull'), 'year': extra.get('year'),
        'code': ', '.join(extra.get('codes') or []) or None,
        'sources': ['KLIP (daftar lama)'], 'klip_input': False, 'group': 5, 'order': (name.upper(),),
    }
    OUT_ROWS.append(row)
    used_keys.add(key(name))

OUT_ROWS.sort(key=lambda r: (r['group'], r['order']))

# Same vessel under two spellings (prefix differs: 'AS GLORY 15' in the master, 'BG. AS GLORY 15' in the DHM file): point them at each other.
# Not merged on purpose - a tug and a barge can share a base name - the person confirming decides.
by_stripped = collections.defaultdict(list)
for row in OUT_ROWS:
    if row['name']:
        by_stripped[strip_prefix(key(row['name']))].append(row)
for group in by_stripped.values():
    names = {key(r['name']) for r in group}
    if len(names) < 2:
        continue
    for row in group:
        others = sorted({r['name'] for r in group if key(r['name']) != key(row['name'])})
        row['sources'][-1] = row['sources'][-1] + ' (mirip: ' + ' | '.join(others) + ')'

# ---------------------------------------------------------------- write the sheet
if SHEET in wb.sheetnames:
    del wb[SHEET]
ws = wb.create_sheet(SHEET, 0)

HEADERS = [
    'Pair ID', 'Nama Vessel', 'Jumlah pair vessel ini', 'Transaksi Klip', 'Company Code', 'Vessel Owner (Company Name)',
    'Vessel Capacity', 'Vessel Type', 'Heating', 'Type Lambung', 'Charter Type', 'Vessel Draft', 'Vessel LOA',
    'Vessel Hull Type', 'Vessel Registration Year', 'Vessel Code SAP',
]
FIELDS = ['pair', 'name', 'pairs', 'tx', 'company_code', 'owner', 'capacity', 'type', 'heating', 'lambung', 'charter', 'draft', 'loa', 'hull', 'year', 'code']

font = Font(name='Arial', size=10)
head_font = Font(name='Arial', size=10, bold=True, color='FFFFFF')
blue = PatternFill('solid', fgColor='1F4E79')
purple = PatternFill('solid', fgColor='7030A0')
grey = PatternFill('solid', fgColor='595959')
yellow = PatternFill('solid', fgColor='FFF2CC')

for c, h in enumerate(HEADERS, 1):
    cell = ws.cell(row=1, column=c, value=h)
    cell.font = head_font
    cell.fill = blue if c <= 4 else purple
    cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
cell = ws.cell(row=1, column=17, value='Sumber (info, tidak ikut disalin ke NAS)')
cell.font = head_font
cell.fill = grey
cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
ws.row_dimensions[1].height = 42

for i, row in enumerate(OUT_ROWS, 2):
    for c, f in enumerate(FIELDS, 1):
        v = row[f]
        cell = ws.cell(row=i, column=c, value=v)
        cell.font = font
        if row['klip_input']:
            cell.fill = yellow
    p = ws.cell(row=i, column=17, value=' + '.join(row['sources']))
    p.font = font
    if row['klip_input']:
        p.fill = yellow

widths = [10, 30, 12, 12, 14, 38, 12, 12, 9, 12, 11, 11, 11, 16, 14, 24, 52]
for c, w in enumerate(widths, 1):
    ws.column_dimensions[get_column_letter(c)].width = w
ws.freeze_panes = 'C2'
ws.auto_filter.ref = f'A1:Q{len(OUT_ROWS) + 1}'

wb.save(OUT)

# ---------------------------------------------------------------- report
by_group = collections.Counter(r['group'] for r in OUT_ROWS)
print('rows', len(OUT_ROWS))
print('by group (0 pair, 1 KLIP input, 2 master used, 3 master unused, 4 Jovin only, 5 old KLIP only):', dict(sorted(by_group.items())))
print('rows with Transaksi Klip > 0:', sum(1 for r in OUT_ROWS if (r['tx'] or 0) > 0))
print('rows with a SAP code:', sum(1 for r in OUT_ROWS if r['code']), '| pair rows:', sum(1 for r in OUT_ROWS if r['group'] == 0 and r['code']), '| non-pair rows:', sum(1 for r in OUT_ROWS if r['group'] != 0 and r['code']))
print('KLIP input rows:', sum(1 for r in OUT_ROWS if r['klip_input']))
print('unique names (key):', len({key(r['name']) for r in OUT_ROWS if r['name']}))
print('saved', OUT)
