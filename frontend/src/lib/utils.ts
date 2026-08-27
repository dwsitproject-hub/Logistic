import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatNumber(v: number | string | null | undefined, opts?: { maxFractionDigits?: number }) {
  if (v === null || v === undefined || v === '') return '0'
  const n = typeof v === 'string' ? Number(v) : v
  if (!Number.isFinite(n)) return '0'
  const maxFractionDigits = opts?.maxFractionDigits ?? 2
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: maxFractionDigits, useGrouping: true })
}

export function formatRupiah(v: number | string | null | undefined) {
  const n = typeof v === 'string' ? Number(v) : (v ?? 0)
  return `Rp. ${formatNumber(Number.isFinite(n) ? n : 0)}`
}

// UI display helpers: display labels as Kg without scaling values.
export function toKgFromMt(mt: number | string | null | undefined) {
  const n = typeof mt === 'string' ? Number(mt) : (mt ?? 0)
  return (Number.isFinite(n) ? n : 0)
}

export function formatKgFromMt(mt: number | string | null | undefined) {
  return `${formatNumber(toKgFromMt(mt))} Kg`
}

function parseQtyKgOrZero(kg: number | string | null | undefined): number {
  if (kg === null || kg === undefined || kg === '') return 0
  const raw =
    typeof kg === 'string' ? kg.replace(/,/g, '').replace(/\s+/g, '').trim() : kg
  const n = typeof raw === 'string' ? Number(raw) : raw
  return Number.isFinite(n) ? n : 0
}

/** Contract/shipment quantities are stored in kg; display as whole MT (no decimals by default). Null/empty → 0 MT. */
export function formatQtyMtFromKg(kg: number | string | null | undefined, opts?: { maxFractionDigits?: number }) {
  const n = parseQtyKgOrZero(kg)
  // MT quantities display as whole numbers (no decimals). Callers can still opt into
  // decimals by passing maxFractionDigits explicitly.
  const maxFractionDigits = opts?.maxFractionDigits ?? 0
  return `${(n / 1000).toLocaleString('en-US', { maximumFractionDigits: maxFractionDigits })} MT`
}

/** Parse absolute MT already formatted via toLocaleString (grouping commas stripped). */
function outstandingDisplayedAbsMt(
  kg: number,
  maxFractionDigits: number,
): number {
  const absFmt = Math.abs(kg / 1000).toLocaleString('en-US', {
    maximumFractionDigits: maxFractionDigits,
  })
  const parsed = Number(absFmt.replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

/** Outstanding qty in kg; over-delivery (negative kg) shows +MT; remaining (positive kg) shows MT without minus. Null/empty → 0 MT. */
export function formatOutstandingQtyMtFromKg(
  kg: number | string | null | undefined,
  opts?: { maxFractionDigits?: number },
) {
  const n = parseQtyKgOrZero(kg)
  const maxFractionDigits = opts?.maxFractionDigits ?? 0
  const displayedAbs = outstandingDisplayedAbsMt(n, maxFractionDigits)
  const absFmt = displayedAbs.toLocaleString('en-US', {
    maximumFractionDigits: maxFractionDigits,
  })
  // After whole-MT rounding, residual kg (e.g. -60 kg → 0.06 MT) must show as plain 0 MT.
  if (displayedAbs === 0) {
    return `${(0).toLocaleString('en-US', { maximumFractionDigits: maxFractionDigits })} MT`
  }
  if (n < 0) return `+${absFmt} MT`
  return `${absFmt} MT`
}

/** View-table text color for outstanding qty (kg): green over-delivery, black remaining, gray zero. Null/empty treated as 0. */
export function outstandingQtyMtColorClass(
  kg: number | string | null | undefined,
  opts?: { maxFractionDigits?: number },
): string {
  const n = parseQtyKgOrZero(kg)
  const maxFractionDigits = opts?.maxFractionDigits ?? 0
  // Color follows the rounded display value, not raw kg residual.
  if (outstandingDisplayedAbsMt(n, maxFractionDigits) === 0) return 'text-gray-500'
  if (n < 0) return 'text-green-600'
  if (n > 0) return 'text-gray-900'
  return 'text-gray-500'
}

