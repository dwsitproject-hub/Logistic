"""Matches the rows pasted from the Dephub ship registry back to the vessels of the lookup template, and writes the English columns.

  python -I docs/scripts/match-vessel-registry.py "docs/Vessel Registry Lookup (Dephub).xlsx" [output.xlsx]
  python -I docs/scripts/match-vessel-registry.py --selftest

Input: the template from build-vessel-registry-template.py, with the sheet `Hasil` filled by hand. The input is never modified; the output is a copy with two
sheets added (default: "<input> - matched.xlsx"):
  Registry_Match    one row per vessel: match status and score, the registry attributes in English, and a check of each against what KLIP holds
  Registry_Summary  counts by status, and what the checks say about the KLIP columns (Draft above all)
  Registry_Unused   rows pasted from the registry that matched no vessel (a different vessel with the same search text, or a typo)

A match is never guessed from a partial name: the attributes are filled only for an exact name or a former name (Eks Nama Kapal). Candidates are scored on name,
vessel type (Jenis Kapal), LOA, year and owner; two exact-name candidates that score within 10 of each other are AMBIGUOUS and get no attributes, only a note.
The checks matter more than the fill: KLIP's Vessel Draft / Vessel LOA (from SAP) turned out to hold the registry's Dalam / Lebar / Panjang in different vessels,
so each is compared with every registry dimension and the output says which one it equals.
All text in the output is upper-case. Needs openpyxl.
"""
import os
import sys
import collections

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vessel_common import key, norm_owner, owner_key, parse_number, type_compat  # noqa: E402

TOL_DIM = 0.5     # metres: LOA / length agree within this
TOL_EXACT = 0.011  # metres: a KLIP dimension 'equals' a registry one
AMBIGUOUS_GAP = 10


def score_candidate(lookup, reg, term_key):
    """How well one registry row fits one vessel. Returns (score, name_kind, reasons)."""
    reasons = []
    nama, eks = key(reg.get('Nama Kapal')), key(reg.get('Eks Nama Kapal'))
    if nama == term_key:
        name_kind, score = 'EXACT', 50
    elif eks == term_key:
        name_kind, score = 'FORMER', 35
        reasons.append('NAME IS A FORMER NAME (EKS NAMA KAPAL)')
    elif len(term_key) >= 5 and nama and (term_key in nama or nama in term_key):
        name_kind, score = 'PARTIAL', 10
        reasons.append('PARTIAL NAME ONLY')
    else:
        return 0, 'NONE', ['NAME DOES NOT MATCH']
    tc = type_compat(lookup.get('Vessel Type'), reg.get('Jenis Kapal'))
    if tc > 0:
        score += 15
        reasons.append('TYPE AGREES')
    elif tc < 0:
        score -= 20
        reasons.append(f"TYPE DIFFERS (KLIP {str(lookup.get('Vessel Type')).upper()} / REGISTRY {str(reg.get('Jenis Kapal')).upper()})")
    loa_k, loa_r, len_r = parse_number(lookup.get('Vessel LOA (KLIP)')), parse_number(reg.get('LOA')), parse_number(reg.get('Panjang'))
    if loa_k is not None:
        if loa_r is not None and abs(loa_k - loa_r) <= TOL_DIM:
            score += 15
            reasons.append('LOA AGREES')
        elif len_r is not None and abs(loa_k - len_r) <= TOL_DIM:
            score += 10
            reasons.append('KLIP LOA = REGISTRY LENGTH')
    if lookup.get('Vessel Registration Year (KLIP)') is not None and parse_number(lookup.get('Vessel Registration Year (KLIP)')) == parse_number(reg.get('Tahun')):
        score += 10
        reasons.append('YEAR AGREES')
    if lookup.get('Vessel Owner (KLIP)') and reg.get('Nama Pemilik') and owner_key(lookup['Vessel Owner (KLIP)']) == owner_key(reg['Nama Pemilik']):
        score += 10
        reasons.append('OWNER AGREES')
    return score, name_kind, reasons


def decide(lookup, candidates, term_key):
    """candidates: registry rows that came back for this vessel. Returns (status, chosen_row_or_None, score, notes)."""
    if not candidates:
        return 'NOT FOUND', None, 0, []
    scored = sorted(((score_candidate(lookup, c, term_key), c) for c in candidates), key=lambda x: -x[0][0])
    named = [x for x in scored if x[0][1] in ('EXACT', 'FORMER')]
    if not named:
        top = scored[0]
        return 'POSSIBLE (PARTIAL NAME - CHECK)', None, top[0][0], [f"{c.get('Nama Kapal')} / {c.get('Nama Pemilik')}" for _, c in scored[:3]]
    (s1, kind1, why1), best = named[0]
    if len(named) > 1 and s1 - named[1][0][0] <= AMBIGUOUS_GAP:
        return 'AMBIGUOUS', None, s1, [f"{c.get('Nama Kapal')} / {c.get('Nama Pemilik')} / {c.get('TPK')} ({sc[0]})" for sc, c in named[:4]]
    confirmed = any(w in why1 for w in ('TYPE AGREES', 'LOA AGREES', 'YEAR AGREES', 'OWNER AGREES', 'KLIP LOA = REGISTRY LENGTH'))
    if kind1 == 'FORMER':
        status = 'MATCHED (FORMER NAME)'
    else:
        status = 'MATCHED' if confirmed else 'MATCHED (NAME ONLY)'
    notes = list(why1)
    if len(named) > 1:
        notes.append(f'{len(named)} REGISTRY ROWS WITH THIS NAME; THIS ONE SCORED HIGHEST')
    return status, best, s1, notes


def dimension_check(klip_value, reg):
    """Which registry dimension does a KLIP number equal? -> text."""
    k = parse_number(klip_value)
    if k is None:
        return 'KLIP BLANK'
    hits = [label for label, field in (('LOA', 'LOA'), ('LENGTH', 'Panjang'), ('BREADTH', 'Lebar'), ('DEPTH', 'Dalam')) if parse_number(reg.get(field)) is not None and abs(parse_number(reg.get(field)) - k) <= TOL_EXACT]
    return ('EQUALS REGISTRY ' + ' / '.join(hits)) if hits else 'EQUALS NO REGISTRY DIMENSION'


# ------------------------------------------------------------------------------------------------------------------------------ I/O
def read_sheet(wb, name):
    if name not in wb.sheetnames:
        sys.exit(f'sheet {name} not found in the workbook (is this the template from build-vessel-registry-template.py?)')
    data = [list(r) for r in wb[name].iter_rows(values_only=True)]
    header = [str(h).strip() if h is not None else '' for h in data[0]]
    return header, [dict(zip(header, r)) for r in data[1:] if any(c not in (None, '') for c in r)]


def run(path_in, path_out):
    wb = openpyxl.load_workbook(path_in)
    _, lookup = read_sheet(wb, 'Lookup')
    hh, hasil = read_sheet(wb, 'Hasil')
    term_col = hh[0]
    SITE = ['Nama Kapal', 'Eks Nama Kapal', 'Call Sign', 'Jenis Kapal', 'Nama Pemilik', 'TPK', 'Panjang', 'Lebar', 'Dalam', 'LOA', 'GT', 'Isi Bersih', 'IMO', 'Tahun', 'Mesin']
    searched, by_term, all_reg = set(), collections.defaultdict(list), []
    for row in hasil:
        tk = key(row.get(term_col))
        if not tk:
            continue
        searched.add(tk)
        if any(row.get(c) not in (None, '') for c in SITE):
            by_term[tk].append(row)
            all_reg.append(row)
    by_name, by_eks = collections.defaultdict(list), collections.defaultdict(list)
    for r in all_reg:
        by_name[key(r.get('Nama Kapal'))].append(r)
        if key(r.get('Eks Nama Kapal')):
            by_eks[key(r.get('Eks Nama Kapal'))].append(r)

    out_rows, used_ids, stats = [], set(), collections.Counter()
    checks = collections.defaultdict(collections.Counter)
    for L in lookup:
        term = L.get('Cari dengan (ketik ini di situs)')
        tk = key(term)
        base = {'Pair ID': L.get('Pair ID'), 'Nama Vessel (KLIP)': L.get('Nama Vessel (KLIP)'), 'Vessel Type': L.get('Vessel Type'), 'Transaksi Klip': L.get('Transaksi Klip'),
                'Cari dengan': term, 'Prioritas': L.get('Prioritas (1 = dipakai transaksi KLIP)')}
        if tk not in searched:
            out_rows.append({**base, 'Match Status': 'NOT SEARCHED', 'Match Score': None, 'Notes': ''})
            stats['NOT SEARCHED'] += 1
            continue
        cands, seen = [], set()
        for r in by_term.get(tk, []) + by_name.get(tk, []) + by_eks.get(tk, []):
            if id(r) not in seen:
                seen.add(id(r))
                cands.append(r)
        lk = {**L, 'Vessel LOA (KLIP)': L.get('Vessel LOA (KLIP)'), 'Vessel Registration Year (KLIP)': L.get('Vessel Registration Year (KLIP)'), 'Vessel Owner (KLIP)': L.get('Vessel Owner (KLIP)')}
        status, reg, score, notes = decide(lk, cands, tk)
        stats[status] += 1
        rec = {**base, 'Match Status': status, 'Match Score': score or None, 'Notes': '; '.join(notes)}
        if reg is not None:
            used_ids.add(id(reg))
            owner_new, _ = norm_owner(reg.get('Nama Pemilik'))
            rec.update({
                'Vessel Owner (Registry)': owner_new, 'Vessel Length (Registry)': parse_number(reg.get('Panjang')), 'Vessel Breadth (Registry)': parse_number(reg.get('Lebar')),
                'Vessel Depth (Registry)': parse_number(reg.get('Dalam')), 'Vessel LOA (Registry)': parse_number(reg.get('LOA')), 'Vessel GT (Registry)': parse_number(reg.get('GT')),
                'Vessel NT (Registry)': parse_number(reg.get('Isi Bersih')), 'Vessel Registration Year (Registry)': parse_number(reg.get('Tahun')),
                'Registration No (TPK)': reg.get('TPK'), 'Call Sign': reg.get('Call Sign'), 'IMO': reg.get('IMO'), 'Former Name': reg.get('Eks Nama Kapal'), 'Registry Vessel Type': reg.get('Jenis Kapal'),
            })
            klip_owner = L.get('Vessel Owner (KLIP)')
            if not klip_owner:
                rec['Owner Check'] = 'KLIP BLANK'
            else:
                rec['Owner Check'] = 'SAME' if owner_key(klip_owner) == owner_key(reg.get('Nama Pemilik')) else 'DIFFERENT'
            loa_k = parse_number(L.get('Vessel LOA (KLIP)'))
            rec['LOA Check'] = dimension_check(L.get('Vessel LOA (KLIP)'), reg)
            rec['Draft Check'] = dimension_check(L.get('Vessel Draft (KLIP)'), reg)
            yk, yr = parse_number(L.get('Vessel Registration Year (KLIP)')), parse_number(reg.get('Tahun'))
            rec['Year Check'] = 'KLIP BLANK' if yk is None else ('SAME' if yr is not None and yk == yr else 'DIFFERENT')
            for name in ('Owner Check', 'LOA Check', 'Draft Check', 'Year Check'):
                checks[name][rec[name]] += 1
        out_rows.append(rec)

    unused = [r for r in all_reg if id(r) not in used_ids]
    jenis = collections.Counter(str(r.get('Jenis Kapal') or '').upper() for r in all_reg)

    # ------------------------------------------------------------------------------------------------------ write
    for name in ('Registry_Match', 'Registry_Summary', 'Registry_Unused'):
        if name in wb.sheetnames:
            del wb[name]
    font, bold = Font(name='Arial', size=10), Font(name='Arial', size=10, bold=True)
    head_font = Font(name='Arial', size=10, bold=True, color='FFFFFF')
    blue, purple, grey = (PatternFill('solid', fgColor=c) for c in ('1F4E79', '7030A0', '595959'))
    ok, warn, bad = (PatternFill('solid', fgColor=c) for c in ('E2EFDA', 'FFF2CC', 'FCE4D6'))

    cols = ['Pair ID', 'Nama Vessel (KLIP)', 'Vessel Type', 'Transaksi Klip', 'Prioritas', 'Cari dengan', 'Match Status', 'Match Score',
            'Vessel Owner (Registry)', 'Vessel Length (Registry)', 'Vessel Breadth (Registry)', 'Vessel Depth (Registry)', 'Vessel LOA (Registry)', 'Vessel GT (Registry)', 'Vessel NT (Registry)',
            'Vessel Registration Year (Registry)', 'Registration No (TPK)', 'Call Sign', 'IMO', 'Former Name', 'Registry Vessel Type',
            'Owner Check', 'LOA Check', 'Draft Check', 'Year Check', 'Notes']
    ws = wb.create_sheet('Registry_Match')
    for c, h in enumerate(cols, 1):
        x = ws.cell(row=1, column=c, value=h)
        x.font, x.alignment = head_font, Alignment(horizontal='center', vertical='center', wrap_text=True)
        x.fill = blue if c <= 8 else (purple if c <= 21 else grey)
    ws.row_dimensions[1].height = 42
    for i, rec in enumerate(out_rows, 2):
        for c, h in enumerate(cols, 1):
            v = rec.get(h)
            if isinstance(v, str):
                v = v.upper()
            x = ws.cell(row=i, column=c, value=v)
            x.font = font
        st = rec['Match Status']
        ws.cell(row=i, column=7).fill = ok if st.startswith('MATCHED') and 'NAME ONLY' not in st else (warn if st.startswith(('MATCHED', 'POSSIBLE', 'AMBIGUOUS')) else bad)
    for c, w in enumerate([10, 30, 12, 10, 9, 28, 26, 9, 38, 11, 11, 11, 11, 10, 10, 13, 22, 12, 12, 18, 14, 11, 30, 30, 11, 70], 1):
        ws.column_dimensions[get_column_letter(c)].width = w
    ws.freeze_panes = 'C2'
    ws.auto_filter.ref = f'A1:{get_column_letter(len(cols))}{len(out_rows) + 1}'

    ws = wb.create_sheet('Registry_Summary')
    r = 1
    def put(a, b=None, strong=False):
        nonlocal r
        ws.cell(row=r, column=1, value=a).font = bold if strong else font
        if b is not None:
            ws.cell(row=r, column=2, value=b).font = font
        r += 1
    put('Vessels in the lookup', len(lookup), True)
    for st, n in stats.most_common():
        put('  ' + st, n)
    put('Registry rows pasted', len(all_reg), True)
    put('  not used by any vessel (see Registry_Unused)', len(unused))
    r += 1
    for name, label in (('Owner Check', 'Vessel Owner: KLIP vs registry'), ('LOA Check', 'KLIP Vessel LOA equals which registry dimension'), ('Draft Check', 'KLIP Vessel Draft equals which registry dimension'), ('Year Check', 'Registration Year: KLIP vs registry')):
        put(label, None, True)
        for k, n in checks[name].most_common():
            put('  ' + k, n)
        r += 1
    put("Registry 'Jenis Kapal' values seen (extend TYPE_KEYWORDS in vessel_common.py if one is unknown)", None, True)
    for k, n in jenis.most_common():
        put('  ' + (k or '(BLANK)'), n)
    ws.column_dimensions['A'].width = 78
    ws.column_dimensions['B'].width = 12

    ws = wb.create_sheet('Registry_Unused')
    for c, h in enumerate([term_col] + SITE, 1):
        x = ws.cell(row=1, column=c, value=h)
        x.font, x.fill = head_font, grey
    for i, row in enumerate(unused, 2):
        for c, h in enumerate([term_col] + SITE, 1):
            v = row.get(h)
            ws.cell(row=i, column=c, value=v.upper() if isinstance(v, str) else v).font = font

    try:
        wb.save(path_out)
    except PermissionError:
        path_out = path_out.replace('.xlsx', ' (2).xlsx')
        print('output is open in Excel, saving as', path_out)
        wb.save(path_out)
    print(f'{len(lookup)} vessels | ' + ' | '.join(f'{k}: {n}' for k, n in stats.most_common()))
    print(f'registry rows pasted {len(all_reg)}, unused {len(unused)}')
    for name in ('Owner Check', 'LOA Check', 'Draft Check', 'Year Check'):
        if checks[name]:
            print(f'{name}:', dict(checks[name]))
    print('saved', path_out)


# ------------------------------------------------------------------------------------------------------------------------------ self-test
def _selftest():
    base = {'Vessel Type': 'BARGE', 'Vessel LOA (KLIP)': 54.86, 'Vessel Registration Year (KLIP)': 2015, 'Vessel Owner (KLIP)': 'PELAYARAN ARGO MITRA SUKSES PT.'}
    solid = {'Nama Kapal': 'SOLID 10', 'Jenis Kapal': 'Barge', 'Nama Pemilik': 'PT. PELAYARAN ARGO MITRA SUKSES', 'LOA': '54.86', 'Panjang': '52.67', 'Lebar': '19.51', 'Dalam': '4.27', 'Tahun': '2015', 'TPK': 'A'}
    st, reg, score, _ = decide(base, [solid], key('SOLID 10'))
    assert st == 'MATCHED' and reg is solid and score == 50 + 15 + 15 + 10 + 10, (st, score)
    # a different vessel with the same name and a worse fit does not make it ambiguous when it is clearly worse
    other = {**solid, 'Jenis Kapal': 'Tanker', 'LOA': '120', 'Tahun': '1990', 'Nama Pemilik': 'PT. LAIN', 'TPK': 'B'}
    st, reg, _, notes = decide(base, [solid, other], key('SOLID 10'))
    assert st == 'MATCHED' and reg is solid and any('2 REGISTRY ROWS' in n for n in notes)
    # two equally good exact names -> AMBIGUOUS, nothing filled
    twin = {**solid, 'TPK': 'C'}
    st, reg, _, _ = decide(base, [solid, twin], key('SOLID 10'))
    assert st == 'AMBIGUOUS' and reg is None
    # former name
    anak = {'Nama Kapal': 'ANAK LAUT 289', 'Eks Nama Kapal': 'DOLPHIN', 'Jenis Kapal': 'Barge', 'Panjang': '79.01', 'Lebar': '21.34', 'Dalam': '4.88', 'LOA': '82.30', 'Tahun': '2003'}
    st, reg, _, _ = decide({'Vessel Type': 'BARGE'}, [anak], key('DOLPHIN'))
    assert st == 'MATCHED (FORMER NAME)' and reg is anak
    # name only, no attribute to confirm it
    st, reg, _, _ = decide({'Vessel Type': None}, [{'Nama Kapal': 'SOLID 10'}], key('SOLID 10'))
    assert st == 'MATCHED (NAME ONLY)'
    # partial name is never filled
    st, reg, _, _ = decide(base, [{'Nama Kapal': 'SOLID 10 PRIMA', 'Jenis Kapal': 'Barge'}], key('SOLID 10'))
    assert st.startswith('POSSIBLE') and reg is None
    assert decide(base, [], key('SOLID 10'))[0] == 'NOT FOUND'
    # the Draft diagnosis: SAP's 'draft' is the registry's Dalam for one vessel and its Lebar for another
    assert dimension_check(4.27, solid) == 'EQUALS REGISTRY DEPTH'
    assert dimension_check(21.34, anak) == 'EQUALS REGISTRY BREADTH'
    assert dimension_check(79.01, anak) == 'EQUALS REGISTRY LENGTH'
    assert dimension_check(9.99, anak) == 'EQUALS NO REGISTRY DIMENSION' and dimension_check(None, anak) == 'KLIP BLANK'
    print('match-vessel-registry self-test ok')


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--selftest':
        _selftest()
    elif len(sys.argv) > 1:
        src = sys.argv[1]
        run(src, sys.argv[2] if len(sys.argv) > 2 else src.replace('.xlsx', ' - matched.xlsx'))
    else:
        sys.exit(__doc__)
