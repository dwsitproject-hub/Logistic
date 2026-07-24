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

function resolveEffectiveQtyKg(
  row: VesselPortsQuantityRow,
  edits: VesselPortsQuantityEdits,
  field: 'quantity_delivered' | 'quantity_receive',
): number | null {
  const edited = edits[row.rowKey]?.[field]
  if (edited !== undefined) {
    if (edited === null) return null
    const n = Number(edited)
    return Number.isFinite(n) ? n : null
  }
  const base = row[field]
  if (base == null) return null
  const n = Number(base)
  return Number.isFinite(n) ? n : null
}

/** Per-PO KLIP qty payload for PUT /shipments/:id/po-klip-qty. */
export function buildPoKlipQtySaveRows(
  rows: VesselPortsQuantityRow[],
  edits: VesselPortsQuantityEdits,
): Array<{
  contractNumber: string
  poNumber: string | null
  quantityDeliveredKlipKg: number | null
  quantityReceiveKlipKg: number | null
}> {
  return rows
    .map((row) => {
      const contractNumber = String(row.contract_ext_no ?? '').trim()
      if (!contractNumber) return null
      return {
        contractNumber,
        poNumber: row.po_number != null && String(row.po_number).trim() !== ''
          ? String(row.po_number).trim()
          : null,
        quantityDeliveredKlipKg: resolveEffectiveQtyKg(row, edits, 'quantity_delivered'),
        quantityReceiveKlipKg: resolveEffectiveQtyKg(row, edits, 'quantity_receive'),
      }
    })
    .filter((r): r is NonNullable<typeof r> => r != null)
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
