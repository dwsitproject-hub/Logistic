"""Merges the rows of the vessel list that are one vessel. Used by build-vessel-prefix.py (--combine). `python -I docs/scripts/vessel_combine.py` runs the self-test.

What is one vessel: the same prefix (BG. / TB. / MT. / SPOB.) and the same name once the voyage number is dropped ('BG. LUMINOR 9 V23' is 'BG. LUMINOR 9'); and a name with
NO prefix at all ('AS GLORY 16') when exactly one prefixed vessel has that name ('BG. AS GLORY 16'). A tug and a barge with the same name are two vessels and are never merged;
a prefixless name that fits both is left alone and reported.

A vessel that sits in several pairs keeps one row per pair (that is the NAS layout: a Pair ID and its two vessels), so rows WITH a Pair ID are never merged with each other.
What is merged is every row WITHOUT a Pair ID into the row(s) with one, or - when no row has a Pair ID - into one row. The kept row gets what the others hold and it lacks;
where two rows hold different values the kept row's value stays and the difference is written down. Transaksi Klip is the largest of the rows (the rows describe the same
transactions; adding would count them twice).
"""
import collections
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import difflib  # noqa: E402

from vessel_common import key, owner_key, search_name  # noqa: E402

# the layout of the vessel list (Vessel_Gabungan / Vessel_Prefix columns A:Q)
PAIR, NAME, JUMLAH, TX, COMPANY, OWNER, CAP, TYPE, HEAT, LAMB, CHARTER, DRAFT, LOA, HULL, YEAR, CODE, SUMBER = range(17)
FILL_FIELDS = [(COMPANY, 'Company Code'), (OWNER, 'Vessel Owner'), (CAP, 'Vessel Capacity'), (TYPE, 'Vessel Type'), (HEAT, 'Heating'), (LAMB, 'Type Lambung'),
               (CHARTER, 'Charter Type'), (DRAFT, 'Vessel Draft'), (LOA, 'Vessel LOA'), (HULL, 'Vessel Hull Type'), (YEAR, 'Vessel Registration Year')]
_PREFIX = re.compile(r'^(BG|TB|MT|SPOB)\.\s')
_ANY_PREFIX = re.compile(r'^(BG|TB|MT|SPOB|TK|KLM|KM|MV)\b', re.I)


def blank(v):
    return v is None or (isinstance(v, str) and not v.strip())


def same(a, b, owner=False):
    if owner:
        return owner_key(a) == owner_key(b)
    try:
        return float(a) == float(b)
    except (TypeError, ValueError):
        return str(a).strip().upper() == str(b).strip().upper()


def split_name(name):
    """-> (prefix or '', base key without the voyage number, has_other_prefix)."""
    text = str(name or '').strip()
    m = _PREFIX.match(text)
    return (m.group(1) if m else ''), key(search_name(text)), bool(not m and _ANY_PREFIX.match(text))


def _sumber_tokens(text):
    text = re.sub(r'\(mirip:[^)]*\)', '', str(text or ''))
    return [t.strip() for t in text.split(' + ') if t.strip()]


def _codes(*values):
    out = []
    for v in values:
        for c in str(v or '').split(','):
            c = c.strip()
            if c and c not in out:
                out.append(c)
    return ', '.join(out) or None


def _filled(row):
    return sum(1 for i in range(CODE + 1) if not blank(row[i]))


def merge_into(target, other, log):
    """Pull what `other` holds into `target` (both are rows). Records what was filled and what differs."""
    for idx, label in FILL_FIELDS:
        if blank(target[idx]) and not blank(other[idx]):
            target[idx] = other[idx]
            log['filled'].add(label)
        elif not blank(target[idx]) and not blank(other[idx]) and not same(target[idx], other[idx], owner=(idx == OWNER)):
            log['conflicts'].append(f'{label}: {target[idx]} / {other[idx]}')
    merged_code = _codes(target[CODE], other[CODE])
    if merged_code != _codes(target[CODE]):
        log['filled'].add('Vessel Code SAP')
    target[CODE] = merged_code
    try:
        target[TX] = max(float(target[TX] or 0), float(other[TX] or 0))
        target[TX] = int(target[TX]) if float(target[TX]).is_integer() else target[TX]
    except (TypeError, ValueError):
        pass
    tokens = _sumber_tokens(target[SUMBER]) + [t for t in _sumber_tokens(other[SUMBER]) if t not in _sumber_tokens(target[SUMBER])]
    target[SUMBER] = ' + '.join(tokens) or None


def combine(items):
    """items: list of {'r': row (list, A:Q layout), 'new': name with its prefix settled}. Returns (kept items in the original order, log, near) - the rows of the dropped
    items are merged into kept ones; `near` lists prefixless names that fit two prefixed vessels (not merged)."""
    groups = collections.defaultdict(list)
    prefixless = collections.defaultdict(list)
    for it in items:
        pre, base, other_prefix = split_name(it['new'])
        if not base:
            groups[('', '', id(it))].append(it)
        elif pre:
            groups[(pre, base)].append(it)
        elif other_prefix:
            groups[('', base, 'other')].append(it)
        else:
            prefixless[base].append(it)
    near = []
    for base, its in prefixless.items():
        targets = [k for k in groups if k[0] and k[1] == base]
        if len(targets) == 1:
            groups[targets[0]].extend(its)
        elif len(targets) > 1:
            near.append((its[0]['new'], [f'{k[0]}. ...' for k in targets]))
            for it in its:
                groups[('', base, id(it))].append(it)
        else:
            groups[('', base)].extend(its)

    dropped, log = set(), []
    for k, its in groups.items():
        if len(its) < 2:
            continue
        paired = [it for it in its if not blank(it['r'][PAIR])]
        loose = [it for it in its if blank(it['r'][PAIR])]
        if not loose:
            continue  # several pair rows of one vessel: the layout, not a duplicate
        # the name the vessel keeps: a prefixed one, without a voyage number
        named = [it for it in its if _PREFIX.match(str(it['new']))] or its
        display = min(named, key=lambda it: (len(it['new']), it['new']))['new']
        if paired:
            targets, sources = paired, loose
        else:
            primary = max(loose, key=lambda it: (float(it['r'][TX] or 0), _filled(it['r'])))
            targets, sources = [primary], [it for it in loose if it is not primary]
        entry = {'name': display, 'pairs': [it['r'][PAIR] for it in paired], 'merged': [f"{it['old'] if 'old' in it else it['new']}" for it in sources],
                 'filled': set(), 'conflicts': []}
        for src in sources:
            for t in targets:
                merge_into(t['r'], src['r'], entry)
            dropped.add(id(src))
        for t in targets:
            t['r'][NAME] = display
            t['new'] = display
            t['combined'] = f"Digabung dari {len(sources) + len(targets)} baris" + (f"; diisi: {', '.join(sorted(entry['filled']))}" if entry['filled'] else '')
            if entry['conflicts']:
                t['combined'] += '; beda nilai (nilai baris ini dipakai): ' + ' | '.join(dict.fromkeys(entry['conflicts']))
        entry['filled'] = sorted(entry['filled'])
        log.append(entry)
    return [it for it in items if id(it) not in dropped], log, near


_NUMERAL = re.compile(r'^(\S*\d\S*|[IVXLC]+)$')  # any token with a digit (289, 1908C, D12) or a Roman numeral (VII)


def near_parts(name):
    """-> (prefix, words key, numerals): the name split into its words and its numbers / Roman numerals."""
    pre, _, _ = split_name(name)
    tokens = re.sub(r'\.', '', search_name(name)).split()
    return pre, key(''.join(t for t in tokens if not _NUMERAL.match(t))), tuple(t for t in tokens if _NUMERAL.match(t))


def near_pairs(names, threshold=0.9):
    """Names that look alike but are NOT the same (a spelling variant like SAMUDRA / SAMUDERA, or maybe a different vessel). Same prefix and the SAME numbers / Roman numerals
    ('ARIEL TRIJAYA II' and 'III' are two vessels), words that differ a little. `names`: list of (name, pair_id). Returns [(a, pair_a, b, pair_b, ratio)]."""
    parts = [(n, p, near_parts(n)) for n, p in names]
    out = []
    for i, (na, pa, (pre_a, wa, nums_a)) in enumerate(parts):
        for nb, pb, (pre_b, wb, nums_b) in parts[i + 1:]:
            if not pre_a or pre_a != pre_b or nums_a != nums_b or not wa or wa == wb:
                continue
            sm = difflib.SequenceMatcher(None, wa, wb)
            if sm.real_quick_ratio() >= threshold and sm.quick_ratio() >= threshold and sm.ratio() >= threshold:
                out.append((na, pa, nb, pb, round(sm.ratio(), 2)))
    return out


def keep_one_pair(items, name, pair_id, reason):
    """A vessel that sits in several pairs is one row per pair. When a decision says the vessel is ONE and belongs to `pair_id`, the other pair rows of it are merged into that
    row (what they hold and it lacks is filled; the vessel is then in as many pairs as there were rows). The other pairs keep their other vessel's row - only this vessel's row
    leaves them. Returns (items, log entry or None)."""
    want = key(name)
    rows = [it for it in items if key(it['new']) == want and not blank(it['r'][PAIR])]
    target = next((it for it in rows if it['r'][PAIR] == pair_id), None)
    if len(rows) < 2 or target is None:
        return items, None
    others = [it for it in rows if it is not target]
    entry = {'name': target['new'], 'pairs': [it['r'][PAIR] for it in rows], 'merged': [f"{it['new']} ({it['r'][PAIR]})" for it in others], 'filled': set(), 'conflicts': []}
    for it in others:
        merge_into(target['r'], it['r'], entry)
    target['r'][JUMLAH] = len(rows)
    target['combined'] = f"Satu vessel di {len(rows)} pair; Pair ID dipertahankan {pair_id}, baris pair {', '.join(it['r'][PAIR] for it in others)} digabung ({reason})"
    entry['filled'] = sorted(entry['filled'])
    drop = {id(it) for it in others}
    return [it for it in items if id(it) not in drop], entry


def keep_latest_pairs(items, pair_dates, pair_source=None, skip=()):
    """Every vessel that still sits in several pair rows becomes ONE row, keeping the Pair ID of its latest contract (`pair_dates`: pair id -> date or None).
    When no pair has a date, or two share the latest, the lowest Pair ID is kept and the row says so. `skip`: vessel name keys already decided by hand.
    Returns (items, [log entries])."""
    by_vessel = collections.OrderedDict()
    for it in items:
        if not blank(it['r'][PAIR]):
            by_vessel.setdefault(key(it['new']), []).append(it)
    log = []
    for vk, rows in by_vessel.items():
        if len(rows) < 2 or vk in skip:
            continue
        dated = [(pair_dates.get(it['r'][PAIR]), it['r'][PAIR]) for it in rows]
        known = [d for d, _ in dated if d is not None]
        latest = max(known) if known else None
        winners = sorted(p for d, p in dated if d == latest and (latest is not None or d is None))
        target_pair = winners[0]
        why = (f"contract terakhir {latest}" if latest and len(winners) == 1 else
               f"contract terakhir {latest} (sama di {', '.join(winners)}; Pair ID terkecil dipilih)" if latest else
               "tidak ada contract date untuk pair mana pun; Pair ID terkecil dipilih")
        items, entry = keep_one_pair(items, rows[0]['new'], target_pair, why)
        if entry:
            entry['dates'] = ' | '.join(f"{p}: {d or '(tidak ada)'}" for d, p in dated)
            target = next(it for it in items if key(it['new']) == vk and it['r'][PAIR] == target_pair)
            target['combined'] += '. Tanggal: ' + entry['dates']
            log.append(entry)
    return items, log


def _selftest():
    def row(name, pair=None, tx=0, **kw):
        r = [None] * 17
        r[PAIR], r[NAME], r[JUMLAH], r[TX] = pair, name, 1 if pair else 0, tx
        for f, v in kw.items():
            r[{'owner': OWNER, 'cap': CAP, 'type': TYPE, 'code': CODE, 'sumber': SUMBER, 'year': YEAR}[f]] = v
        return r

    def item(name, **kw):
        r = row(name, **kw)
        return {'r': r, 'new': name}

    # two rows without a Pair ID, one vessel: merged, the busier row kept, blanks filled
    a, b = item('BG. AS GLORY 19', tx=22, sumber='Master KLIP', code='MGL19'), item('BG. AS GLORY 19', owner='PT. KAPUAS', cap=5000, sumber='Jovin/DHM (mirip: AS GLORY 19)', code='MGLORY19')
    kept, log, near = combine([a, b])
    assert len(kept) == 1 and kept[0] is a and a['r'][OWNER] == 'PT. KAPUAS' and a['r'][CAP] == 5000 and a['r'][TX] == 22
    assert a['r'][CODE] == 'MGL19, MGLORY19' and a['r'][SUMBER] == 'Master KLIP + Jovin/DHM'
    # a row without a Pair ID folds into the pair rows of the same vessel; the pair rows (one per pair) stay
    p1, p2, loose = item('BG. LUMINOR 6', pair='TBG-013'), item('BG. LUMINOR 6', pair='TBG-037'), item('BG. LUMINOR 6', owner='PT. X', tx=46)
    kept, log, _ = combine([p1, loose, p2])
    assert [it['r'][PAIR] for it in kept] == ['TBG-013', 'TBG-037'] and p1['r'][OWNER] == 'PT. X' and p2['r'][OWNER] == 'PT. X' and p1['r'][TX] == 46
    # pair rows alone are the layout, not a duplicate
    assert len(combine([item('TB. BAHTERA 7', pair='TBG-002'), item('TB. BAHTERA 7', pair='TBG-004')])[0]) == 2
    # voyage number: 'BG. LUMINOR 9 V23' is 'BG. LUMINOR 9', and the shorter name is kept
    kept, _, _ = combine([item('BG. LUMINOR 9 V23', tx=10), item('BG. LUMINOR 9')])
    assert len(kept) == 1 and kept[0]['r'][NAME] == 'BG. LUMINOR 9'
    # a prefixless name joins the one prefixed vessel with that name; a tug and a barge are never one vessel
    kept, _, _ = combine([item('AS GLORY 16'), item('BG. AS GLORY 16', tx=3)])
    assert len(kept) == 1 and kept[0]['r'][NAME] == 'BG. AS GLORY 16'
    kept, _, near = combine([item('TB. AS MARINA 9'), item('BG. AS MARINA 9'), item('AS MARINA 9')])
    assert len(kept) == 3 and near and near[0][0] == 'AS MARINA 9'
    # different values: the kept row's value stays and the difference is noted
    x, y = item('BG. Z 1', owner='PT. A', tx=5), item('BG. Z 1', owner='PT. B')
    kept, log, _ = combine([x, y])
    assert x['r'][OWNER] == 'PT. A' and 'Vessel Owner: PT. A / PT. B' in x['combined']
    # owners are compared as companies: PT. at the end or the front is the same owner
    p, q = item('BG. W 1', owner='MAXIMA LINERS PT.', tx=2), item('BG. W 1', owner='PT. MAXIMA LINERS')
    combine([p, q])
    assert 'combined' in p and 'beda nilai' not in p['combined']
    # near duplicates: a spelling variant is listed; a different Roman numeral or number is not
    pairs = near_pairs([('BG. PAYUNG SAMUDRA 5', None), ('BG. PAYUNG SAMUDERA 5', 'TBG-1'), ('BG. ARIEL TRIJAYA II', None), ('BG. ARIEL TRIJAYA III', None), ('BG. KAPUAS 168', None), ('BG. KAPUAS 169', None), ('BG. SEJAHTERA D12', None), ('BG. SEJAHTERA D28', None)])
    assert [(a, b) for a, _, b, _, _ in pairs] == [('BG. PAYUNG SAMUDRA 5', 'BG. PAYUNG SAMUDERA 5')], pairs
    # a decision: this tug is one vessel, keep pair TBG-052; the other pair row is merged into it
    t1, t2, bg = item('TB. BRAWIJAYA I', pair='TBG-052'), item('TB. BRAWIJAYA I', pair='TBG-053', owner='PT. B'), item('BG. TUNGGADEWI I', pair='TBG-053')
    kept, entry = keep_one_pair([t1, bg, t2], 'TB. BRAWIJAYA I', 'TBG-052', 'tes')
    assert kept == [t1, bg] and t1['r'][JUMLAH] == 2 and t1['r'][OWNER] == 'PT. B' and entry['pairs'] == ['TBG-052', 'TBG-053']
    assert keep_one_pair([t1, bg], 'TB. BRAWIJAYA I', 'TBG-052', 'tes')[1] is None
    # the latest contract decides; no date at all -> the lowest Pair ID, and it says so
    import datetime as _dt
    a1, a2, a3 = item('BG. LUMINOR 6', pair='TBG-013'), item('BG. LUMINOR 6', pair='TBG-037'), item('BG. LUMINOR 6', pair='TBG-081')
    kept, entries = keep_latest_pairs([a1, a2, a3], {'TBG-013': _dt.date(2026, 5, 15), 'TBG-037': None, 'TBG-081': _dt.date(2026, 8, 1)})
    assert [it['r'][PAIR] for it in kept] == ['TBG-081'] and kept[0]['r'][JUMLAH] == 3 and 'contract terakhir 2026-08-01' in kept[0]['combined']
    b1, b2 = item('BG. X', pair='TBG-002'), item('BG. X', pair='TBG-001')
    kept, _ = keep_latest_pairs([b1, b2], {})
    assert [it['r'][PAIR] for it in kept] == ['TBG-001'] and 'Pair ID terkecil' in kept[0]['combined']
    assert len(keep_latest_pairs([item('BG. Y', pair='TBG-005')], {})[0]) == 1
    print('vessel_combine self-test ok')


if __name__ == '__main__':
    _selftest()
