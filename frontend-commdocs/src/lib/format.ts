const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * The calendar date of an API value. Postgres DATE columns arrive as '2026-07-23' or as midnight UTC
 * ('2026-07-23T00:00:00.000Z'); both are read as that calendar day, never shifted by the viewer's timezone.
 */
function dateParts(value: string | null | undefined): { y: number; m: number; d: number } | null {
  if (!value) return null
  const plain = /^(\d{4})-(\d{2})-(\d{2})(?:$|T00:00:00(?:\.000)?Z$)/.exec(value)
  if (plain) return { y: +plain[1], m: +plain[2], d: +plain[3] }
  const t = new Date(value)
  if (Number.isNaN(t.getTime())) return null
  return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() }
}

/** dd/mm/yy - used ONLY for the dates in the Documents table (Ryan, 2026-10-26). */
export function ddmmyy(value: string | null | undefined): string {
  const p = dateParts(value)
  return p ? `${pad(p.d)}/${pad(p.m)}/${String(p.y).slice(2)}` : '-'
}

/** dd/mm/yyyy - the Tanda Terima Send Date, as in KLIP. */
export function ddmmyyyy(value: string | null | undefined): string {
  const p = dateParts(value)
  return p ? `${pad(p.d)}/${pad(p.m)}/${p.y}` : '-'
}

/** "22 Oct 2026" */
export function longDate(value: string | null | undefined): string {
  const p = dateParts(value)
  return p ? `${pad(p.d)} ${MONTHS[p.m - 1]} ${p.y}` : '-'
}

/** "22 Oct 2026 09:14" in the viewer's local time - history and audit entries. */
export function dateTime(value: string | null | undefined): string {
  if (!value) return '-'
  const t = new Date(value)
  if (Number.isNaN(t.getTime())) return '-'
  return `${pad(t.getDate())} ${MONTHS[t.getMonth()]} ${t.getFullYear()} ${pad(t.getHours())}:${pad(t.getMinutes())}`
}

/** Local calendar date as YYYY-MM-DD (what the API's dateFrom / dateTo / sendDate expect). */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** "dd/mm/yyyy" typed by a user -> YYYY-MM-DD, or null when it is not a real date. */
export function parseDdMmYyyy(value: string): string | null {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(value)
  if (!m) return null
  const d = +m[1]
  const mo = +m[2]
  const y = +m[3]
  const t = new Date(y, mo - 1, d)
  if (t.getFullYear() !== y || t.getMonth() !== mo - 1 || t.getDate() !== d) return null
  return `${y}-${pad(mo)}-${pad(d)}`
}

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

export function num(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-'
  const n = Number(value)
  return Number.isFinite(n) ? nf.format(n) : '-'
}

/**
 * Unit / Total Price cell: the number alone when the row is in IDR (the column header says IDR, as in KLIP); a row in another
 * currency keeps its code so the header does not mislabel it.
 */
export function priceCell(value: number | null | undefined, currency: string | null | undefined): string {
  const n = Number(value)
  if (value === null || value === undefined || !Number.isFinite(n)) return '-'
  const formatted = n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  const cur = (String(currency || '').trim() || 'IDR').toUpperCase()
  return cur === 'IDR' ? formatted : `${formatted} ${cur}`
}

/** Percentage to one decimal. */
export function pct(part: number, whole: number): number {
  if (!whole) return 0
  return Math.round((part / whole) * 1000) / 10
}

export function initials(name: string | null | undefined): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

/** Page buttons with gaps: 1 … 4 5 6 … 20 */
export function pageList(page: number, pages: number): Array<number | 'gap'> {
  const out: Array<number | 'gap'> = []
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) out.push(p)
    else if (out[out.length - 1] !== 'gap') out.push('gap')
  }
  return out
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
}

/** Date ranges offered by the Contract date filter. */
export type DatePreset = 'ytd' | 'last30' | 'last90' | 'lastYear' | 'all' | 'custom'

export function presetRange(preset: DatePreset, today = new Date()): { dateFrom: string; dateTo: string } | null {
  const y = today.getFullYear()
  const back = (days: number) => {
    const d = new Date(today)
    d.setDate(d.getDate() - days)
    return isoDate(d)
  }
  switch (preset) {
    case 'ytd':
      return { dateFrom: `${y}-01-01`, dateTo: isoDate(today) }
    case 'last30':
      return { dateFrom: back(30), dateTo: isoDate(today) }
    case 'last90':
      return { dateFrom: back(90), dateTo: isoDate(today) }
    case 'lastYear':
      return { dateFrom: `${y - 1}-01-01`, dateTo: `${y - 1}-12-31` }
    case 'all':
      // The API defaults an empty range to this year, so "all" is an explicit wide range.
      return { dateFrom: '2000-01-01', dateTo: `${y + 1}-12-31` }
    default:
      return null
  }
}
