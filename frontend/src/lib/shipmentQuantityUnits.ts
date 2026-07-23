/**
 * Quantity units in KLIP:
 * - shipments.quantity_delivered / actual_vessel_qty_receive: kg (DB)
 * - GET /shipments/contracts/details quantity_delivered|quantity_receive: kg (SAP-normalized)
 * - UI edit grid (MtQtyInput): kg internally, MT display
 */

/** Legacy: unconditional MT → kg (prefer sapContractDetailQtyToKg for contract-detail API). */
export function sapDeliveredOrReceiveMtToKg(mt: number | null | undefined): number | null {
  if (mt === null || mt === undefined) return null
  const n = Number(mt)
  if (!Number.isFinite(n)) return null
  return n * 1000
}

/** SAP contract-detail qty → kg (MT-scale when value is much smaller than contract qty). */
export function sapContractDetailQtyToKg(
  value: number | null | undefined,
  contractQtyKg?: number | null,
): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const contractKg = contractQtyKg ?? 0
  if (contractKg > 0 && n > 0 && n <= contractKg / 100) {
    return n * 1000
  }
  return n
}

function isMeaningfulManualShipmentQtyKg(kg: number | null): boolean {
  return kg !== null && kg > 0
}

export function shipmentStoredQtyKg(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const raw = typeof value === 'string' ? value.replace(/,/g, '').trim() : value
  const n = typeof raw === 'string' ? Number(raw) : Number(raw)
  return Number.isFinite(n) ? n : null
}

/** Prefer manual shipment row qty (kg) when it differs from SAP contract-detail rows. */
export function mergeShipmentQtyOverridesOnContractRows<
  T extends { quantity_delivered?: number | null; quantity_receive?: number | null },
>(rows: T[], shipmentDeliveredKg: number | null, shipmentReceiveKg: number | null): T[] {
  if (rows.length === 0) return rows
  const sumDelivered = rows.reduce((s, r) => s + (r.quantity_delivered ?? 0), 0)
  const sumReceive = rows.reduce((s, r) => s + (r.quantity_receive ?? 0), 0)
  const deliveredDiffers =
    isMeaningfulManualShipmentQtyKg(shipmentDeliveredKg)
    && Math.abs(sumDelivered - shipmentDeliveredKg!) > 0.5
  const receiveDiffers =
    isMeaningfulManualShipmentQtyKg(shipmentReceiveKg)
    && Math.abs(sumReceive - shipmentReceiveKg!) > 0.5

  if (rows.length === 1) {
    const row = rows[0]
    return [
      {
        ...row,
        quantity_delivered: deliveredDiffers ? shipmentDeliveredKg : row.quantity_delivered,
        quantity_receive: receiveDiffers ? shipmentReceiveKg : row.quantity_receive,
      },
    ]
  }

  if (!deliveredDiffers && !receiveDiffers) return rows

  // Multi-PO: per-row SAP delivered/receive is authoritative when the shipment shell
  // stores a partial total (often one PO line). Only redistribute when the user
  // raised the shipment header above the SAP row sum.
  if (rows.length > 1) {
    const copy = rows.map((r) => ({ ...r }))
    if (deliveredDiffers && shipmentDeliveredKg !== null && shipmentDeliveredKg > sumDelivered + 0.5) {
      let idx = 0
      for (let i = 1; i < copy.length; i += 1) {
        if ((copy[i].quantity_delivered ?? 0) > (copy[idx].quantity_delivered ?? 0)) idx = i
      }
      copy[idx] = {
        ...copy[idx],
        quantity_delivered: shipmentDeliveredKg - sumDelivered + (copy[idx].quantity_delivered ?? 0),
      }
    }
    if (receiveDiffers && shipmentReceiveKg !== null && shipmentReceiveKg > sumReceive + 0.5) {
      let idx = 0
      for (let i = 1; i < copy.length; i += 1) {
        if ((copy[i].quantity_receive ?? 0) > (copy[idx].quantity_receive ?? 0)) idx = i
      }
      copy[idx] = {
        ...copy[idx],
        quantity_receive: shipmentReceiveKg - sumReceive + (copy[idx].quantity_receive ?? 0),
      }
    }
    return copy
  }

  return rows
}

/**
 * Seed per-PO KLIP delivered/receive for Edit Shipment PO table without overwriting SAP display.
 * Prefers quantity_delivered_klip; falls back to legacy quantity_delivered only when it differs
 * from the SAP row sum. Receive uses actual_vessel_qty_receive when meaningful.
 */
export function seedKlipQtyFromShipmentHeader(
  sapRows: Array<{ quantity_delivered?: number | null; quantity_receive?: number | null }>,
  opts: {
    shipmentDeliveredKlipKg: number | null
    shipmentDeliveredKg: number | null
    shipmentReceiveKg: number | null
  },
): Array<{ quantity_delivered: number | null; quantity_receive: number | null }> {
  if (sapRows.length === 0) return []

  const sumDelivered = sapRows.reduce((s, r) => s + (r.quantity_delivered ?? 0), 0)

  const deliveredKg = isMeaningfulManualShipmentQtyKg(opts.shipmentDeliveredKlipKg)
    ? opts.shipmentDeliveredKlipKg
    : (
        isMeaningfulManualShipmentQtyKg(opts.shipmentDeliveredKg)
        && Math.abs(sumDelivered - opts.shipmentDeliveredKg!) > 0.5
      )
      ? opts.shipmentDeliveredKg
      : null
  const receiveKg = isMeaningfulManualShipmentQtyKg(opts.shipmentReceiveKg)
    ? opts.shipmentReceiveKg
    : null

  if (deliveredKg == null && receiveKg == null) {
    return sapRows.map(() => ({ quantity_delivered: null, quantity_receive: null }))
  }

  if (sapRows.length === 1) {
    return [{ quantity_delivered: deliveredKg, quantity_receive: receiveKg }]
  }

  const baseline = sapRows.map((r) => ({
    quantity_delivered: r.quantity_delivered ?? null,
    quantity_receive: r.quantity_receive ?? null,
  }))
  const merged = mergeShipmentQtyOverridesOnContractRows(baseline, deliveredKg, receiveKg)

  return merged.map((m, i) => ({
    quantity_delivered:
      deliveredKg != null ? (m.quantity_delivered ?? baseline[i]?.quantity_delivered ?? null) : null,
    quantity_receive:
      receiveKg != null ? (m.quantity_receive ?? baseline[i]?.quantity_receive ?? null) : null,
  }))
}

/**
 * Shipments list table — kg for display.
 * Open + KLIP qty present → quantity_delivered_klip
 * Open without KLIP → SAP fallback
 * Close → SAP
 * Legacy quantity_delivered is only a last-resort fallback when KLIP/SAP are both absent.
 */
export function resolveShipmentListDeliveredKg(shipment: {
  quantity_delivered_klip?: number | string | null
  quantity_delivered?: number | string | null
  total_quantity_delivered?: number | string | null
  quantity_delivered_sap?: number | string | null
  is_contract_sap_closed?: boolean | null
}): number | null {
  const closed = Boolean(shipment.is_contract_sap_closed)
  const klip = shipmentStoredQtyKg(shipment.quantity_delivered_klip)
  const sap = shipmentStoredQtyKg(shipment.quantity_delivered_sap)
  const legacy =
    shipmentStoredQtyKg(shipment.quantity_delivered)
    ?? shipmentStoredQtyKg(shipment.total_quantity_delivered)

  if (closed) {
    return sap ?? null
  }
  if (isMeaningfulManualShipmentQtyKg(klip)) {
    return klip
  }
  if (sap !== null) return sap
  return legacy
}

/**
 * Shipments list Receive Qty — kg for display.
 * Same Open/Close rules as Delivery (not "vessel only if higher than SAP"):
 * Close → SAP Quantity Receive
 * Open + meaningful actual_vessel_qty_receive (KLIP) → vessel receive
 * Open without KLIP → SAP; last resort vessel/manual
 */
export function resolveShipmentListReceiveKg(shipment: {
  actual_vessel_qty_receive?: number | string | null
  quantity_receive?: number | string | null
  is_contract_sap_closed?: boolean | null
}): number | null {
  const closed = Boolean(shipment.is_contract_sap_closed)
  const klip = shipmentStoredQtyKg(shipment.actual_vessel_qty_receive)
  const sap = shipmentStoredQtyKg(shipment.quantity_receive)

  if (closed) {
    return sap ?? null
  }
  if (isMeaningfulManualShipmentQtyKg(klip)) {
    return klip
  }
  if (sap !== null) return sap
  return klip
}

export function resolveShipmentListStoKg(shipment: {
  sto_quantity?: number | string | null
  total_quantity_shipped?: number | string | null
  quantity_shipped?: number | string | null
}): number | null {
  return (
    shipmentStoredQtyKg(shipment.sto_quantity)
    ?? shipmentStoredQtyKg(shipment.total_quantity_shipped)
    ?? shipmentStoredQtyKg(shipment.quantity_shipped)
  )
}
