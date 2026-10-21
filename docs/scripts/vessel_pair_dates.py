"""The latest contract date of each vessel pair, for deciding which Pair ID a vessel that sits in several pairs keeps. Used by build-vessel-prefix.py (--latest-pair).

Two sources, the later date wins:
  * Vessel_Pair_Link 'Contract Date Terakhir' in the vessel workbook (from the SAP export of 01 Jan - 02 Oct 2026)
  * the SAP logistics export given with --sap (ZMMLOG_RPT ... .xlsx): the rows whose Vessel Name is the raw name SAP sent for that pair (Vessel_Split 'SAP Vessel Name (asal)').
    Matched by NAME, not by vessel code: one SAP code is reused across pairs, and counting by code credits a pair with another pair's contracts.
A pair that no SAP row names has no date.
"""
import datetime
import os
import sys

import openpyxl

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vessel_common import key  # noqa: E402


def to_date(v):
    if isinstance(v, datetime.datetime):
        return v.date()
    if isinstance(v, datetime.date):
        return v
    s = str(v or '').strip()
    for fmt in ('%m/%d/%y', '%Y-%m-%d', '%d/%m/%Y', '%m/%d/%Y'):
        try:
            return datetime.datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


def load_pair_dates(workbook, sap_path=None):
    """workbook: an openpyxl workbook with Vessel_Pair_Link and Vessel_Split. -> ({pair id: latest date or None}, {pair id: 'where the date came from'})."""
    dates, source = {}, {}
    link = [list(r) for r in workbook['Vessel_Pair_Link'].iter_rows(values_only=True)]
    for r in link[1:]:
        if r[0]:
            d = to_date(r[3])
            dates[r[0]] = d
            source[r[0]] = 'Pair_Link' if d else None
    if not sap_path:
        return dates, source
    split = [list(r) for r in workbook['Vessel_Split'].iter_rows(values_only=True)]
    name_to_pairs = {}
    for r in split[1:]:
        if r[0] and r[9]:
            name_to_pairs.setdefault(key(r[9]), set()).add(r[0])
    wb = openpyxl.load_workbook(sap_path, read_only=True, data_only=True)
    it = wb[wb.sheetnames[0]].iter_rows(values_only=True)
    header = [str(x).strip() if x is not None else '' for x in next(it)]
    i_name, i_date = header.index('Vessel Name'), header.index('Contract Date')
    for row in it:
        pairs = name_to_pairs.get(key(row[i_name]))
        if not pairs:
            continue
        d = to_date(row[i_date])
        if d is None:
            continue
        for p in pairs:
            if dates.get(p) is None or d > dates[p]:
                dates[p] = d
                source[p] = 'SAP export'
    return dates, source


if __name__ == '__main__':
    assert to_date('10/13/26') == datetime.date(2026, 10, 13) and to_date(datetime.datetime(2026, 5, 15)) == datetime.date(2026, 5, 15) and to_date('') is None
    print('vessel_pair_dates self-test ok')
