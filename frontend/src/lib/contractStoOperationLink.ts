/** Contract Details List STO — Operation ID is a link only when it can be opened. */

export function stoOperationIdIsOpenable(row: {
  operation_id?: string | null
  id?: string | null
  status?: string | null
}): boolean {
  const op = String(row.operation_id ?? '').trim()
  if (!op || op === '-' || op === '—') return false
  const entityId = String(row.id ?? '').trim()
  if (entityId) return true
  const status = String(row.status ?? '').trim().toUpperCase()
  return status === 'UNPLANNED' || status === 'PREPLANNED'
}

export function stoOperationIdDisplay(row: {
  operation_id?: string | null
  id?: string | null
  status?: string | null
}): string {
  if (!stoOperationIdIsOpenable(row)) return '—'
  return String(row.operation_id ?? '').trim()
}
