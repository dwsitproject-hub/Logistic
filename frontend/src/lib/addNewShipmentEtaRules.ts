/** Normalize contract incoterm for Add Shipment ETA rules. */
export function normalizeShipmentIncoterm(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

export function isCifShipmentIncoterm(value: unknown): boolean {
  return normalizeShipmentIncoterm(value) === 'CIF'
}

export function areAllSelectionKeysCif(
  selectionKeys: string[],
  getIncoterm: (selectionKey: string) => string,
): boolean {
  if (selectionKeys.length === 0) return false
  return selectionKeys.every((key) => isCifShipmentIncoterm(getIncoterm(key)))
}

export function blockSelectionKeysAllCif(
  selectionKeys: string[],
  getIncoterm: (selectionKey: string) => string,
): boolean {
  const ids = selectionKeys.filter(Boolean)
  if (ids.length === 0) return false
  return ids.every((key) => isCifShipmentIncoterm(getIncoterm(key)))
}

export type EtaScheduleBlock = {
  contractIds: string[]
  loadingPort: string
  [etaField: string]: string | string[] | undefined
}

export function etaDetailHasAnyDate(
  d: Record<string, unknown>,
  fieldKeys: readonly string[],
): boolean {
  return fieldKeys.some((key) => Boolean(String(d[key] ?? '').trim()))
}

export function etaDetailHasAllRequiredDates(
  d: Record<string, unknown>,
  fieldKeys: readonly string[],
): boolean {
  return fieldKeys.every((key) => Boolean(String(d[key] ?? '').trim()))
}

export function isEtaScheduleCompleteForCreate(opts: {
  contractIds: string[]
  etaBlocks: EtaScheduleBlock[]
  etaFieldKeys: readonly string[]
  getIncoterm: (selectionKey: string) => string
}): boolean {
  const { contractIds, etaBlocks, etaFieldKeys, getIncoterm } = opts
  if (contractIds.length === 0) return false
  if (areAllSelectionKeysCif(contractIds, getIncoterm)) return true

  const covered = new Set<string>()
  for (const block of etaBlocks) {
    const selectedIds = block.contractIds.filter(Boolean)
    if (selectedIds.length === 0) continue

    const blockAllCif = blockSelectionKeysAllCif(selectedIds, getIncoterm)
    if (!blockAllCif) {
      if (!block.loadingPort.trim()) return false
      if (!etaDetailHasAllRequiredDates(block, etaFieldKeys)) return false
    }

    for (const cid of selectedIds) covered.add(cid)
  }

  return contractIds.every((cid) => {
    if (isCifShipmentIncoterm(getIncoterm(cid))) return true
    return covered.has(cid)
  })
}
