export type SapStoPriorityRow = {
  sto_number?: string | null
  row_kind?: string | null
}

export function shouldPrioritizeSapStoRows(statusFilter: string): boolean {
  const normalized = String(statusFilter ?? '').trim().toUpperCase()
  return normalized === 'UNPLANNED' || normalized === 'PLANNED'
}

export function hasSapStoListRow(row: SapStoPriorityRow): boolean {
  if (String(row.row_kind ?? '').trim() === 'contract_backlog') return false
  const sto = String(row.sto_number ?? '').trim()
  return sto.length > 0 && sto !== '-'
}

/** Negative when `a` should appear above `b` (STO rows first). */
export function compareSapStoListRowPriority(a: SapStoPriorityRow, b: SapStoPriorityRow): number {
  const aHas = hasSapStoListRow(a)
  const bHas = hasSapStoListRow(b)
  if (aHas === bHas) return 0
  return aHas ? -1 : 1
}
