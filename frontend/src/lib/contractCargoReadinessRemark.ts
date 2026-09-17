import { formatDateDMY } from '@/lib/dateFormat'

function formatRemarkDate(iso: string | null | undefined): string {
  if (!iso) return '-'
  return formatDateDMY(iso) || '-'
}

function normalizeIsoDate(iso: string | null | undefined): string {
  if (!iso) return ''
  return String(iso).trim().slice(0, 10)
}

export function cargoReadinessDatesEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return normalizeIsoDate(a) === normalizeIsoDate(b)
}

export function buildCargoReadinessChangeRemark(
  oldIso: string | null | undefined,
  newIso: string | null | undefined,
  userRemark: string,
): string {
  const remark = userRemark.trim()
  if (!remark) {
    throw new Error('Remark is required')
  }
  const oldLabel = formatRemarkDate(oldIso)
  const newLabel = formatRemarkDate(newIso)
  return `Cargo Readiness Date: ${oldLabel} → ${newLabel}\n${remark}`
}
