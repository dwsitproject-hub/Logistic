/**
 * Number formats for the Section 1 recap tables of Quality Claim and Shortage Claim.
 */

/**
 * Short form for a recap cell, where a full "34.460.622.316" per cell makes the table too wide:
 * 34,46 B (billion), 5,87 M (million). Under a million the number is shown whole. The full figure
 * goes in the cell's tooltip, and the view tables keep full numbers.
 */
export function formatClaimCompact(n: number | undefined | null): string {
  const v = Number(n || 0)
  if (!v) return '-'
  const abs = Math.abs(v)
  const fmt = (x: number) => x.toLocaleString('id-ID', { maximumFractionDigits: 2 })
  if (abs >= 1e12) return `${fmt(v / 1e12)} T`
  if (abs >= 1e9) return `${fmt(v / 1e9)} B`
  if (abs >= 1e6) return `${fmt(v / 1e6)} M`
  return Math.round(v).toLocaleString('id-ID')
}

/** A value's share of a total, "56.2%"; a dash when either is zero, as the workbooks show it. */
export function formatShare(part: number, total: number): string {
  if (!total || !part) return '-'
  // A real but tiny share (Rp 2 M of Rp 34 B) must not read as "0%", which looks like no claim.
  if (Math.abs(part / total) < 0.001) return '<0.1%'
  return `${((part / total) * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`
}
