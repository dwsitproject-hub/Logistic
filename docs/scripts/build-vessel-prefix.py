"""Adds the sheet Vessel_Prefix to a copy of the Vessel Cleanup workbook: the Vessel_Gabungan rows, normalised.

  python -I docs/scripts/build-vessel-prefix.py [source.xlsx] [sheet] [output.xlsx]
  (defaults: docs/Vessel Cleanup (Jovin, Klip, SAP) v6.xlsx / Vessel_Gabungan -> ... v7.xlsx; falls back to v8 when v7 is open in Excel)

Columns A:Q keep the layout of the NAS sheet "Vessel - Klip (Final Validation)" so they can be pasted over it; R:V are info only.
Rules: every value in A:Q upper-case. Vessel name: the prefix is added from Vessel Type (BARGE -> BG., TUG BOAT -> TB., TANKER -> MT., SPOB -> SPOB.),
a prefix without its dot or glued to the name is rewritten as 'XX. NAME', TK. becomes BG.; KLM. / KM. / MV. only get their space and are flagged.
Vessel Owner: 'PT.' moved to the front, 'PT.' added when missing, 'PT' / 'P.T.' written as 'PT.'; CV. is kept (moved to the front); two companies joined by ' / '
are treated one by one; a value cut at SAP's 35 characters ending ' P' is restored to PT.; an incoterm (CIF) in the owner column is NOT a company: left and flagged.
Rows that need a decision are yellow, changed rows green. Nothing is dropped: every Pair ID and every other column is copied as it was.
Needs openpyxl.
"""
import re
import sys
import collections
import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

SRC = sys.argv[1] if len(sys.argv) > 1 else 'D:/Project/Klip/docs/Vessel Cleanup (Jovin, Klip, SAP) v6.xlsx'
SHEET_IN = sys.argv[2] if len(sys.argv) > 2 else 'Vessel_Gabungan'
OUT = sys.argv[3] if len(sys.argv) > 3 else 'D:/Project/Klip/docs/Vessel Cleanup (Jovin, Klip, SAP) v7.xlsx'
SHEET_OUT = 'Vessel_Prefix'

TYPE_PREFIX = {'BARGE': 'BG.', 'TUG BOAT': 'TB.', 'TANKER': 'MT.', 'SPOB': 'SPOB.'}
# a prefix the rule knows (with or without the dot / the space after it)
KNOWN = re.compile(r'^\s*(BG|TB|MT|SPOB)\b\s*\.?\s*', re.I)
CLEAN = re.compile(r'^(BG|TB|MT|SPOB)\. \S', re.I)
# TK. (tongkang) became BG. in the earlier cleanup of the pair list; KLM. / MV. / KM. were never decided
TK = re.compile(r'^\s*TK\b\s*\.?\s*', re.I)
OTHER = re.compile(r'^\s*(KLM|MV|KM)\b\s*\.?\s*', re.I)


NOT_A_COMPANY = {'CIF', 'FOB', 'CFR', 'FRC', 'LCO'}  # an incoterm sitting in the owner column
LEGAL = r'(PT|CV|UD|PD)'


def norm_owner_segment(seg, truncated):
    """One company name -> 'PT. NAME' (legal form moved to the front, dotted; PT. added when the name has none). Returns (text, notes)."""
    notes = []
    seg = re.sub(r'\s+', ' ', seg).strip().upper()
    seg = re.sub(r'\bP\.\s?T\.?(?=\s|$)', 'PT.', seg)  # P.T. -> PT.
    if truncated and re.search(r' P$', seg):
        seg = seg[:-2] + ' PT.'
        notes.append('PT. terpotong di 35 karakter SAP, dipulihkan')
    m = re.match(r'^' + LEGAL + r'\b\.?\s*(.*)$', seg)
    legal, body = (m.group(1), m.group(2)) if m else (None, seg)
    if not m:
        m = re.match(r'^(.*?)[\s,]+' + LEGAL + r'\.?$', seg)
        if m:
            legal, body = m.group(2), m.group(1).strip()
            notes.append(f'{legal}. dipindah ke depan')
    if legal is None:
        legal = 'PT'
        notes.append('PT. ditambah')
    elif not m or not seg.startswith(f'{legal}. '):
        if 'dipindah ke depan' not in ' '.join(notes) and 'terpotong' not in ' '.join(notes):
            notes.append('PT. dirapikan')
    if re.search(r'\bSDN\s*BHD\b', body):
        notes.append('SDN BHD (perusahaan Malaysia): cek apakah PT. tepat')
    return f'{legal}. {body}', notes


def norm_owner(value):
    """Vessel Owner (Company Name): upper-case, PT. at the front, PT. added where missing. Returns (new, note)."""
    if value is None or str(value).strip() == '':
        return None, ''
    raw = str(value)
    text = re.sub(r'\s+', ' ', raw).strip().upper()
    if text in NOT_A_COMPANY:
        return text, 'Bukan nama perusahaan (incoterm di kolom owner) - tidak diubah, perlu dikoreksi'
    truncated = len(raw.strip()) == 35
    parts, notes = [], []
    for seg in re.split(r'\s/\s', text):
        out_seg, n = norm_owner_segment(seg, truncated)
        parts.append(out_seg)
        notes += n
    if len(parts) > 1:
        notes.append('dua perusahaan dipisah " / ", tiap nama diperlakukan sendiri')
    new = ' / '.join(parts)
    note = '; '.join(dict.fromkeys(notes))
    if not note and new != text:
        note = 'PT. dirapikan'
    return new, note


def key(s):
    return re.sub(r'[^A-Z0-9]', '', str(s or '').upper())


wb = openpyxl.load_workbook(SRC)
ws_in = wb[SHEET_IN]
data = [list(r) for r in ws_in.iter_rows(values_only=True)]
header, rows = data[0], data[1:]
ncol = min(len(header), 17)  # A:Q (A:O NAS, P Vessel Code SAP, Q Sumber) = the layout of 'Vessel - Klip (Final Validation)'

out = []
for r in rows:
    name = str(r[1]).strip() if r[1] is not None else ''
    vtype = str(r[7]).strip().upper() if r[7] is not None else ''
    new, note = name, ''
    if not name:
        note = 'Nama kosong'
    elif KNOWN.match(name):
        m = KNOWN.match(name)
        base = name[m.end():].strip()
        pre = m.group(1).upper() + '.'
        want = TYPE_PREFIX.get(vtype)
        new = f'{pre} {base}'
        if new != name:
            note = 'Titik / spasi prefix dirapikan'
        if want and want != pre:
            note = (note + '; ' if note else '') + f'Prefix {pre} tidak cocok dengan Vessel Type {r[7]} (seharusnya {want}) - tidak diubah'
    elif TK.match(name):
        base = name[TK.match(name).end():].strip()
        new = f'BG. {base}'
        note = 'TK. diganti BG. (aturan cleanup sebelumnya: tongkang = BG.)'
    elif OTHER.match(name):
        m = OTHER.match(name)
        new = f'{m.group(1).upper()}. {name[m.end():].strip()}'
        note = f'Prefix {m.group(1).upper()}. belum ada aturannya - perlu diputuskan' + ('; spasi setelah prefix ditambah' if new != name else '')
    elif vtype in TYPE_PREFIX:
        new = f'{TYPE_PREFIX[vtype]} {name}'
        note = f'Prefix {TYPE_PREFIX[vtype]} ditambah dari Vessel Type {r[7]}'
    else:
        note = 'Perlu diputuskan: tanpa prefix dan tanpa Vessel Type'
    out.append((r, name, new, note))

# the same vessel under two spellings: after the prefix, two rows carry one name
count = collections.Counter(key(new) for _, _, new, _ in out if new)
first_pair = {}
for r, _, new, _ in out:
    if new and r[0]:
        first_pair.setdefault(key(new), (r[0], new))

if SHEET_OUT in wb.sheetnames:
    del wb[SHEET_OUT]
ws = wb.create_sheet(SHEET_OUT, 1)
font = Font(name='Arial', size=10)
head_font = Font(name='Arial', size=10, bold=True, color='FFFFFF')
blue, purple, grey = (PatternFill('solid', fgColor=c) for c in ('1F4E79', '7030A0', '595959'))
changed_fill = PatternFill('solid', fgColor='E2EFDA')
decide_fill = PatternFill('solid', fgColor='FFF2CC')
dupe_fill = PatternFill('solid', fgColor='FCE4D6')

heads = list(header[:ncol]) + ['Nama sebelum (info)', 'Prefix: apa yang dilakukan (info)', 'Nama sama dengan baris lain (info)', 'Owner sebelum (info)', 'Owner: apa yang dilakukan (info)']
for c, h in enumerate(heads, 1):
    cell = ws.cell(row=1, column=c, value=h)
    cell.font = head_font
    cell.fill = blue if c <= 4 else (purple if c <= 16 else grey)
    cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
ws.row_dimensions[1].height = 42

stats = collections.Counter()
for i, (r, old, new, note) in enumerate(out, 2):
    values = list(r[:ncol])
    values[1] = new or None
    owner_new, owner_note = norm_owner(r[5])
    values[5] = owner_new
    values = [v.upper() if isinstance(v, str) else v for v in values]
    dup = ''
    if new and count[key(new)] > 1:
        group = [o for o in out if o[2] and key(o[2]) == key(new)]
        loose = [o for o in group if not o[0][0]]  # rows with no Pair ID
        # a vessel that sits in several pairs is normal; the case to look at is a row WITHOUT a Pair ID that is the same vessel as another row
        if loose:
            pair_ids = sorted({o[0][0] for o in group if o[0][0]})
            if not r[0]:
                dup = 'Sama dengan baris ber-Pair ID: ' + ', '.join(pair_ids) if pair_ids else f'{len(group)} baris tanpa Pair ID bernama sama'
            else:
                dup = 'Ada baris tanpa Pair ID dengan nama sama'
    row_fill = None
    if new != old and note.startswith(('Prefix', 'Titik', 'TK.')) and 'tidak cocok' not in note:
        row_fill = changed_fill
        stats['diubah'] += 1
    if note.startswith('Perlu diputuskan') or 'belum ada aturannya' in note or 'tidak cocok' in note or note == 'Nama kosong':
        row_fill = decide_fill
        stats['perlu diputuskan'] += 1
    if dup:
        stats['nama kembar'] += 1
    for c, v in enumerate(values, 1):
        cell = ws.cell(row=i, column=c, value=v)
        cell.font = font
        if row_fill:
            cell.fill = row_fill
    ws.cell(row=i, column=ncol + 1, value=old if old != new else None).font = font
    ws.cell(row=i, column=ncol + 2, value=note or None).font = font
    ws.cell(row=i, column=ncol + 4, value=(str(r[5]).strip() if r[5] is not None and owner_new != str(r[5]).strip() else None)).font = font
    ws.cell(row=i, column=ncol + 5, value=owner_note or None).font = font
    if owner_note:
        stats['owner diubah'] += 1
    if owner_note.startswith('Bukan nama'):
        stats['owner bukan perusahaan'] += 1
    d = ws.cell(row=i, column=ncol + 3, value=dup or None)
    d.font = font
    if dup:
        d.fill = dupe_fill

widths = [10, 30, 12, 12, 14, 38, 12, 12, 9, 12, 11, 11, 11, 16, 14, 24, 52, 30, 54, 44, 40, 60]
for c, w in enumerate(widths[:len(heads)], 1):
    ws.column_dimensions[get_column_letter(c)].width = w
ws.freeze_panes = 'C2'
ws.auto_filter.ref = f'A1:{get_column_letter(len(heads))}{len(out) + 1}'
try:
    wb.save(OUT)
except PermissionError:
    OUT = OUT.replace(' v7.xlsx', ' v8.xlsx')
    print('v7 is open in Excel, saving as', OUT)
    wb.save(OUT)

by_note = collections.Counter()
for _, _, _, note in out:
    k = note.split(' dari ')[0].split(' - ')[0] if note else '(sudah benar)'
    by_note[re.sub(r'Prefix (BG|TB|MT|SPOB)\. ditambah', 'Prefix ditambah', k)] += 1
print('rows', len(out))
for k, v in by_note.most_common():
    print(f'  {v:4}  {k}')
print('changed:', stats['diubah'], '| need a decision:', stats['perlu diputuskan'], '| rows sharing a name with another row:', stats['nama kembar'])
print('owner rows changed:', stats['owner diubah'], '| not a company:', stats['owner bukan perusahaan'])
print('saved', OUT)
