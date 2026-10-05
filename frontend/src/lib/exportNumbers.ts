/**
 * Download files carry numbers as numbers and the unit in the column header.
 *
 * The tables show "1,234 MT" / "2.5%" / "12 days" - fine on screen, but in a spreadsheet that is
 * text: SUM skips it, COUNT does not count it, and a thousands comma makes it unparseable. So an
 * export cell is a plain number and the unit moves to the header: "Contract Qty (MT)".
 */

/** pg numeric often arrives as a string ("3002849.00", "1,234") - parse it, or null when missing. */
export function parseExportNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const n = Number(String(value).replace(/,/g, '').replace(/\s+/g, '').trim())
  return Number.isFinite(n) ? n : null
}

/** A number cell, or an empty cell when the value is missing - empty is not counted by COUNT. */
export function exportNumberCell(value: unknown): number | '' {
  return parseExportNumber(value) ?? ''
}

/** Strip floating-point noise (205.78000000000003) without dropping real decimals. */
function tidy(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

/**
 * kg -> MT as an exact number (not rounded to whole MT, so a column sums to the same total as the
 * kg behind it). A missing value is 0, as in the tables. Over-delivered outstanding stays negative.
 */
export function kgToMtNumber(kg: unknown): number {
  return tidy((parseExportNumber(kg) ?? 0) / 1000)
}

/** Same, but an empty cell for a missing value (for columns where 0 would be a made-up value). */
export function kgToMtCell(kg: unknown): number | '' {
  const n = parseExportNumber(kg)
  return n === null ? '' : tidy(n / 1000)
}

/**
 * "Contract Qty" + "MT" -> "Contract Qty (MT)". A label that already names its unit - "(Kg)", "%",
 * "(IDR/Kg)", or the bare word as in "Estimated NM" - is left alone so the unit is never written
 * twice.
 */
export function exportHeaderWithUnit(label: string, unit?: string): string {
  if (!unit) return label
  if (/\([^)]*\)/.test(label) || label.includes('%')) return label
  const escaped = unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (new RegExp(`(^|[^A-Za-z])${escaped}($|[^A-Za-z])`, 'i').test(label)) return label
  return `${label} (${unit})`
}
