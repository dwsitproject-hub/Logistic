"""Reads what people filled in on the NAS sheet 'Vessel - Pair' (Vessel Owner, Vessel Type, Charter Type, Vessel Capacity) per vessel.
Used by build-vessel-prefix.py (--nas). `python -I docs/scripts/vessel_nas_merge.py` runs the self-test.

The sheet cannot be read by column position: rows were pasted from earlier layouts of the vessel list, so about a fifth of them sit one column to the
right (Vessel Type under Heating's neighbour, a capacity under Vessel Type). Each row is realigned from what its cells HOLD - a Vessel Type word, a
Company Code (LN + digits), a charter code (V/C, T/C), a hull code (DHDB, SHSB, ...), Yes / No, a capacity number - and a row whose anchors disagree is left
out rather than guessed.
"""
import collections
import os
import re
import sys

import openpyxl

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vessel_common import fix_vessel_name, key, norm_owner, parse_number  # noqa: E402

TYPES = {'BARGE', 'TUG BOAT', 'TANKER', 'SPOB'}
CHARTER = {'V/C', 'T/C'}
_COMPANY = re.compile(r'^LN\d{6,}$')
_LAMBUNG = re.compile(r'^[DS]H[DS][BR]$')

# the NAS 'Vessel - Pair' layout: A Pair ID, B Nama, C Jumlah, D Transaksi, E Vessel Code SAP, F Company Code, G Owner, H Capacity, I Type, J Heating, K Lambung, L Charter ...
IDX = {'company': 5, 'owner': 6, 'capacity': 7, 'type': 8, 'heating': 9, 'lambung': 10, 'charter': 11}


def _cell(row, i):
    if i < 0 or i >= len(row) or row[i] is None:
        return ''
    return str(row[i]).strip()


def detect_shift(row):
    """0 when the row sits where the header says, 1 when its cells from Company Code on are one column to the right, None when it cannot be told."""
    votes = collections.Counter()
    for base, test in ((IDX['type'], lambda s: s.upper() in TYPES), (IDX['company'], lambda s: bool(_COMPANY.match(s))),
                       (IDX['charter'], lambda s: s.upper() in CHARTER), (IDX['heating'], lambda s: s.upper() in ('YES', 'NO')),
                       (IDX['lambung'], lambda s: bool(_LAMBUNG.match(s.upper())))):
        for shift in (0, 1):
            if test(_cell(row, base + shift)):
                votes[shift] += 1
    cap0, cap1 = parse_number(_cell(row, IDX['capacity'])), parse_number(_cell(row, IDX['capacity'] + 1))
    if cap0 is not None and cap0 >= 100 and cap1 is None:
        votes[0] += 1
    if cap1 is not None and cap1 >= 100 and cap0 is None:
        votes[1] += 1
    if not votes:
        return 0 if all(_cell(row, i) == '' for i in range(IDX['company'], IDX['charter'] + 3)) else None  # nothing filled in: nothing to read either way
    top = votes.most_common()
    if len(top) > 1 and top[0][1] == top[1][1]:
        return None
    return top[0][0]


def read_row(row):
    """The four fields of one NAS row, realigned. Returns (fields, shift)."""
    s = detect_shift(row)
    if s is None:
        return None, None
    owner = _cell(row, IDX['owner'] + s)
    typ = _cell(row, IDX['type'] + s).upper()
    charter = _cell(row, IDX['charter'] + s).upper()
    cap = parse_number(_cell(row, IDX['capacity'] + s))
    fields = {
        'owner': norm_owner(owner)[0] if owner and not _COMPANY.match(owner) and parse_number(owner) is None else None,
        'type': typ if typ in TYPES else None,
        'charter': charter if charter in CHARTER else None,
        'capacity': cap if cap is not None and cap >= 100 else None,
    }
    return fields, s


def load_nas_edits(path, sheet='Vessel - Pair'):
    """-> (edits, stats). edits[canonical name key] = {'name', 'rows', 'owner': Counter, 'type': Counter, 'charter': Counter, 'capacity': Counter}; a Counter's
    order is first-seen order of its values. The canonical key is the key of the name with its prefix settled (fix_vessel_name) from the row's own Vessel Type."""
    wb = openpyxl.load_workbook(path, read_only=True)
    if sheet not in wb.sheetnames:
        sys.exit(f'sheet {sheet} not found in {path}')
    data = [list(r) for r in wb[sheet].iter_rows(values_only=True)]
    stats = collections.Counter()
    edits = {}
    for row in data[1:]:
        name = _cell(row, 1)
        if not name:
            continue
        stats['rows'] += 1
        fields, shift = read_row(row)
        if fields is None:
            stats['rows left out (alignment unclear)'] += 1
            continue
        stats[f'rows shifted by {shift}'] += 1
        canon, _ = fix_vessel_name(name, fields['type'])
        e = edits.setdefault(key(canon), {'name': canon, 'rows': 0, 'owner': collections.Counter(), 'type': collections.Counter(),
                                          'charter': collections.Counter(), 'capacity': collections.Counter()})
        e['rows'] += 1
        for f in ('owner', 'type', 'charter', 'capacity'):
            if fields[f] is not None:
                e[f][fields[f]] += 1
    return edits, stats


def pick(values, ours):
    """Which NAS value to use for one field of one vessel. `values` is a Counter of the distinct non-empty NAS values, `ours` what the list holds now.
    NAS wins. When the NAS rows disagree among themselves the value that DIFFERS from ours is taken as the edit (a stale copy of the old value is the other row);
    if several differ, the most frequent. Returns (value or None, conflict_note)."""
    if not values:
        return None, ''
    if len(values) == 1:
        return next(iter(values)), ''
    differing = [v for v in values if v != ours]
    if len(differing) == 1:
        return differing[0], 'baris NAS tidak seragam (' + ' | '.join(str(v) for v in values) + '): dipakai yang berbeda dari data kita'
    best = max(differing, key=lambda v: (values[v], -list(values).index(v)))
    return best, 'baris NAS tidak seragam (' + ' | '.join(str(v) for v in values) + '): dipakai yang paling sering'


def _selftest():
    aligned = [None, 'MT. ASIKE I', 0, 3, 'MASIKE', '', 'Margo Indonesia', 5000, 'Tanker', 'No', 'SHDB', 'V/C', None, None, None, None, 'x']
    shifted = ['TBG-021', 'BG. MARINE P', 1, 0, '', '', 'LN12000866', 'SAMUDERA AMAN', '', 'Barge', '', '', 'V/C', None, None, None, 'x']
    assert detect_shift(aligned) == 0 and detect_shift(shifted) == 1
    f, s = read_row(shifted)
    assert (f['owner'], f['type'], f['charter'], f['capacity'], s) == ('PT. SAMUDERA AMAN', 'BARGE', 'V/C', None, 1), f
    f, s = read_row(aligned)
    assert (f['owner'], f['type'], f['charter'], f['capacity']) == ('PT. MARGO INDONESIA', 'TANKER', 'V/C', 5000)
    # a row that only carries a capacity under Vessel Type is read as shifted, not as a type
    cap_shift = [None, 'BG. X', 0, 0, '', '', '', '', 4000, 'Barge', 'No', 'DHDB', 'V/C', None, None, None, 'x']
    assert detect_shift(cap_shift) == 1 and read_row(cap_shift)[0]['capacity'] == 4000
    # nothing filled in: nothing to read
    assert read_row([None, 'BG. Y', 0, 0, '', '', '', '', '', '', '', '', '', None, None, None, 'x'])[0] == {'owner': None, 'type': None, 'charter': None, 'capacity': None}
    # conflict rule: the value that differs from ours is the edit
    c = collections.Counter({'BARGE': 2, 'TANKER': 1})
    assert pick(c, 'BARGE')[0] == 'TANKER' and pick(collections.Counter({'V/C': 1}), None)[0] == 'V/C' and pick(collections.Counter(), 'X') == (None, '')
    print('vessel_nas_merge self-test ok')


if __name__ == '__main__':
    _selftest()
