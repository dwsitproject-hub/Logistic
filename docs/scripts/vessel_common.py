"""Rules shared by the vessel workbook scripts (build-vessel-prefix.py, build-vessel-registry-template.py, match-vessel-registry.py).
One place, so a rule is written once: a second spelling of a rule is how the pages of this system drifted apart before.
Plain functions, no I/O. `python -I docs/scripts/vessel_common.py` runs the self-test.
"""
import re

# ---------------------------------------------------------------------------------------------------------------------------------- names
PREFIXES = ('BG', 'TB', 'MT', 'SPOB', 'TK', 'KLM', 'KM', 'MV')
_PREFIX_RE = re.compile(r'^\s*(' + '|'.join(PREFIXES) + r')\b\s*\.?\s*', re.I)
_VOYAGE_RE = re.compile(r'\s+V\.?\s*\d+(?:\s*/\s*\d+)?\s*$', re.I)  # 'LUMINOR 9 V23', 'ALISHA V.06/24'


def key(s):
    """Comparable form of a name: upper-case letters and digits only."""
    return re.sub(r'[^A-Z0-9]', '', str(s or '').upper())


def strip_prefix(name):
    """'BG. SOLID 10' -> 'SOLID 10' (BG / TB / MT / SPOB / TK / KLM / KM / MV, with or without dot or space)."""
    text = str(name or '').strip()
    m = _PREFIX_RE.match(text)
    return text[m.end():].strip() if m else text


def search_name(name):
    """What to type into the Dephub search box: the name without its prefix and without a trailing voyage number."""
    base = strip_prefix(name)
    base = _VOYAGE_RE.sub('', base)
    return re.sub(r'\s+', ' ', base).strip().upper()


# ---------------------------------------------------------------------------------------------------------------------------------- owner
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


def owner_key(value):
    """Owners compare equal when they differ only in PT. placement, case and punctuation."""
    new, _ = norm_owner(value)
    return key(new)


# ---------------------------------------------------------------------------------------------------------------------------------- numbers and types
def parse_number(value):
    """'52.67' / '52,67' / 52.67 -> 52.67; blank or text -> None."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(' ', '')
    if not text:
        return None
    if ',' in text and '.' in text:
        text = text.replace(',', '') if text.rfind('.') > text.rfind(',') else text.replace('.', '').replace(',', '.')
    elif ',' in text:
        text = text.replace(',', '.')
    try:
        return float(text)
    except ValueError:
        return None


# Dephub 'Jenis Kapal' -> our Vessel Type. The registry's vocabulary is only partly known (we have seen 'Barge'), so this is keyword based and meant to be extended.
TYPE_KEYWORDS = {
    'BARGE': ('BARGE', 'TONGKANG', 'PONTON'),
    'TUG BOAT': ('TUG', 'TUNDA', 'TB'),
    'TANKER': ('TANKER', 'TANGKI'),
    'SPOB': ('SPOB', 'SELF PROPELLED OIL BARGE'),
}


def type_compat(vessel_type, jenis_kapal):
    """+1 compatible, -1 clearly different, 0 unknown. `vessel_type` is ours (BARGE / TUG BOAT / TANKER / SPOB)."""
    ours = str(vessel_type or '').strip().upper()
    theirs = str(jenis_kapal or '').strip().upper()
    if not ours or not theirs or ours not in TYPE_KEYWORDS:
        return 0
    if any(k in theirs for k in TYPE_KEYWORDS[ours]):
        return 1
    for other, kws in TYPE_KEYWORDS.items():
        if other != ours and any(k in theirs for k in kws):
            return -1
    return 0


# ---------------------------------------------------------------------------------------------------------------------------------- self-test
def _selftest():
    assert key('BG. Solid-10') == 'BGSOLID10'
    assert search_name('BG. SOLID 10') == 'SOLID 10'
    assert search_name('BG.LUMINOR 9 V23') == 'LUMINOR 9'
    assert search_name('MT ALISHA V.06/24') == 'ALISHA'
    assert search_name('TB. ARGO 10') == 'ARGO 10'
    assert search_name('AS GLORY 15') == 'AS GLORY 15'
    assert search_name('KLM. HIKMAH INDAH') == 'HIKMAH INDAH'
    assert norm_owner('MAXIMA LINERS PT.')[0] == 'PT. MAXIMA LINERS'
    assert norm_owner('Kapuas Armada Nusantara')[0] == 'PT. KAPUAS ARMADA NUSANTARA'
    assert norm_owner('BINTANG BAHARI JAYA CV.')[0] == 'CV. BINTANG BAHARI JAYA'
    assert norm_owner('CIF')[0] == 'CIF'
    assert norm_owner(None) == (None, '')
    assert owner_key('PELAYARAN ARGO MITRA SUKSES PT.') == owner_key('PT. PELAYARAN ARGO MITRA SUKSES')
    assert parse_number('52.67') == 52.67 and parse_number('52,67') == 52.67 and parse_number('1,112.5') == 1112.5 and parse_number('') is None
    assert type_compat('BARGE', 'Barge') == 1 and type_compat('TUG BOAT', 'Tug Boat') == 1
    assert type_compat('BARGE', 'Tanker') == -1 and type_compat('BARGE', 'Kapal Lain') == 0 and type_compat(None, 'Barge') == 0
    print('vessel_common self-test ok')


if __name__ == '__main__':
    _selftest()
