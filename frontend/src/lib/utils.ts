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

/** Contract/shipment quantities are stored in kg; display as whole MT (no decimals by default). */
export function formatQtyMtFromKg(kg: number | string | null | undefined, opts?: { maxFractionDigits?: number }) {
  if (kg === null || kg === undefined || kg === '') return '-'
  const raw =
    typeof kg === 'string' ? kg.replace(/,/g, '').replace(/\s+/g, '').trim() : kg
  const n = typeof raw === 'string' ? Number(raw) : raw
  if (!Number.isFinite(n)) return '-'
  // MT quantities display as whole numbers (no decimals). Callers can still opt into
  // decimals by passing maxFractionDigits explicitly.
  const maxFractionDigits = opts?.maxFractionDigits ?? 0
  return `${(n / 1000).toLocaleString('en-US', { maximumFractionDigits: maxFractionDigits })} MT`
}

/** Outstanding qty in kg; over-delivery (negative kg) shows +MT; remaining (positive kg) shows MT without minus. */
export function formatOutstandingQtyMtFromKg(
  kg: number | string | null | undefined,
  opts?: { maxFractionDigits?: number },
) {
  if (kg === null || kg === undefined || kg === '') return '-'
  const n = typeof kg === 'string' ? Number(kg) : kg
  if (!Number.isFinite(n)) return '-'
  const maxFractionDigits = opts?.maxFractionDigits ?? 0
  const mt = n / 1000
  // Whole-number MT (no decimals) across all pages (override via maxFractionDigits).
  const absFmt = Math.abs(mt).toLocaleString('en-US', { maximumFractionDigits: maxFractionDigits })
  if (n < 0) return `+${absFmt} MT`
  if (n > 0) return `${absFmt} MT`
  return `${(0).toLocaleString('en-US', { maximumFractionDigits: maxFractionDigits })} MT`
}

/** View-table text color for outstanding qty (kg): green over-delivery, black remaining, gray zero. */
export function outstandingQtyMtColorClass(kg: number | string | null | undefined): string {
  if (kg === null || kg === undefined || kg === '') return 'text-gray-400'
  const n = typeof kg === 'string' ? Number(kg) : kg
  if (!Number.isFinite(n)) return 'text-gray-400'
  if (n < 0) return 'text-green-600'
  if (n > 0) return 'text-gray-900'
  return 'text-gray-500'
}

