/**
 * TransporterHistoryModal — partition oil-loss contract rows by SAP status (Open vs Close).
 */

export function normalizeOilLossContractStatus(status: string | null | undefined): string {
  return String(status ?? '')
    .trim()
    .toLowerCase()
}

export function isOilLossOpenStatus(status: string | null | undefined): boolean {
  const s = normalizeOilLossContractStatus(status)
  return s === 'open' || s === 'in progress' || s === 'in_progress'
}

export function isOilLossCloseStatus(status: string | null | undefined): boolean {
  const s = normalizeOilLossContractStatus(status)
  return s === 'close' || s === 'closed' || s === 'completed'
}

export function partitionTransporterContractsByStatus<T extends { status?: string | null }>(
  rows: readonly T[],
): { onGoingContracts: T[]; closeContracts: T[] } {
  const onGoingContracts: T[] = []
  const closeContracts: T[] = []
  for (const row of rows) {
    if (isOilLossCloseStatus(row.status)) {
      closeContracts.push(row)
    } else if (isOilLossOpenStatus(row.status)) {
      onGoingContracts.push(row)
    }
  }
  return { onGoingContracts, closeContracts }
}
