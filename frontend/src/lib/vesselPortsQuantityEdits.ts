export type VesselPortsQuantityRow = {
  rowKey: string
  contract_ext_no?: string | null
  po_number?: string | null
  contract_qty?: number | null
  sto_qty?: number | null
  quantity_delivered?: number | null
  quantity_receive?: number | null
  /** Planned quantity of this PO on the shipment (kg). A plan is not a delivery: it does not reduce OS. */
  quantity_shipment_plan?: number | null
  locked_from_sap?: boolean
}

export type VesselPortsQuantityEdits = Record<
  string,
  { quantity_delivered?: number | null; quantity_receive?: number | null; quantity_shipment_plan?: number | null }
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
  field: 'quantity_delivered' | 'quantity_receive' | 'quantity_shipment_plan',
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

/** Per-PO KLIP qty payload for PUT /shipments/:id/po-klip-qty (changed rows only). */
export function buildPoKlipQtySaveRows(
  rows: VesselPortsQuantityRow[],
  edits: VesselPortsQuantityEdits,
): Array<{
  contractNumber: string
  poNumber: string | null
  quantityDeliveredKlipKg: number | null
  quantityReceiveKlipKg: number | null
  /** Present only on a row whose Shipment Plan Qty the user changed. */
  quantityShipmentPlanKg?: number | null
}> {
  return rows
    .map((row) => {
      const contractNumber = String(row.contract_ext_no ?? '').trim()
      if (!contractNumber) return null
      const edit = edits[row.rowKey]
      if (!edit) return null
      const deliveredChanged =
        edit.quantity_delivered !== undefined
        && !quantityKgValuesEqual(edit.quantity_delivered, row.quantity_delivered)
      const receiveChanged =
        edit.quantity_receive !== undefined
        && !quantityKgValuesEqual(edit.quantity_receive, row.quantity_receive)
      const planChanged =
        edit.quantity_shipment_plan !== undefined
        && !quantityKgValuesEqual(edit.quantity_shipment_plan, row.quantity_shipment_plan)
      if (!deliveredChanged && !receiveChanged && !planChanged) return null
      return {
        contractNumber,
        poNumber: row.po_number != null && String(row.po_number).trim() !== ''
          ? String(row.po_number).trim()
          : null,
        quantityDeliveredKlipKg: deliveredChanged
          ? resolveEffectiveQtyKg(row, edits, 'quantity_delivered')
          : null,
        quantityReceiveKlipKg: receiveChanged
          ? resolveEffectiveQtyKg(row, edits, 'quantity_receive')
          : null,
        ...(planChanged
          ? { quantityShipmentPlanKg: resolveEffectiveQtyKg(row, edits, 'quantity_shipment_plan') ?? 0 }
          : {}),
      }
    })
    .filter((r): r is NonNullable<typeof r> => r != null)
}

/** True only when the user changed Delivered / Receive in the qty edit grid (not mere load/sum drift). */
export function hasVesselPortsQuantityFieldEdits(
  rows: VesselPortsQuantityRow[],
  edits: VesselPortsQuantityEdits,
  field: 'quantity_delivered' | 'quantity_receive',
): boolean {
  for (const [rowKey, edit] of Object.entries(edits)) {
    const row = rows.find((r) => r.rowKey === rowKey)
    if (!row) continue
    if (edit[field] !== undefined && !quantityKgValuesEqual(edit[field], row[field])) {
      return true
    }
  }
  return false
}

/**
 * True when the user changed a Shipment Plan Qty. Kept apart from hasVesselPortsQuantityUserEdits on purpose: that one drives the Delivered / Receive
 * sums and status logic of the save, which a plan (not a delivery) must not touch.
 */
export function hasShipmentPlanQtyEdits(
  rows: VesselPortsQuantityRow[],
  edits: VesselPortsQuantityEdits,
): boolean {
  for (const [rowKey, edit] of Object.entries(edits)) {
    const row = rows.find((r) => r.rowKey === rowKey)
    if (!row) continue
    if (
      edit.quantity_shipment_plan !== undefined
      && !quantityKgValuesEqual(edit.quantity_shipment_plan, row.quantity_shipment_plan)
    ) {
      return true
    }
  }
  return false
}

export function hasVesselPortsQuantityUserEdits(
  rows: VesselPortsQuantityRow[],
  edits: VesselPortsQuantityEdits,
): boolean {
  return (
    hasVesselPortsQuantityFieldEdits(rows, edits, 'quantity_delivered')
    || hasVesselPortsQuantityFieldEdits(rows, edits, 'quantity_receive')
  )
}
