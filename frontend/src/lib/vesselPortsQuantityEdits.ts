export type VesselPortsQuantityRow = {
  rowKey: string
  contract_ext_no?: string | null
  po_number?: string | null
  contract_qty?: number | null
  sto_qty?: number | null
  quantity_delivered?: number | null
  quantity_receive?: number | null
  locked_from_sap?: boolean
}

export type VesselPortsQuantityEdits = Record<
  string,
  { quantity_delivered?: number | null; quantity_receive?: number | null }
>

/** Compare quantity fields stored as kg in API rows. */
export function quantityKgValuesEqual(a: unknown, b: unknown): boolean {
  const pa = a === null || a === undefined || a === '' ? null : Number(a)
  const pb = b === null || b === undefined || b === '' ? null : Number(b)
  if (pa === null && pb === null) return true
  if (pa === null || pb === null || Number.isNaN(pa) || Number.isNaN(pb)) return false
  return Math.abs(pa - pb) < 0.001
}

/** True only when the user changed Delivered / Receive in the qty edit grid (not mere load/sum drift). */
export function hasVesselPortsQuantityUserEdits(
  rows: VesselPortsQuantityRow[],
  edits: VesselPortsQuantityEdits,
): boolean {
  for (const [rowKey, edit] of Object.entries(edits)) {
    const row = rows.find((r) => r.rowKey === rowKey)
    if (!row) continue
    if (
      edit.quantity_delivered !== undefined
      && !quantityKgValuesEqual(edit.quantity_delivered, row.quantity_delivered)
    ) {
      return true
    }
    if (
      edit.quantity_receive !== undefined
      && !quantityKgValuesEqual(edit.quantity_receive, row.quantity_receive)
    ) {
      return true
    }
  }
  return false
}
