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

