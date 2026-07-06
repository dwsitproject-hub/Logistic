/**
 * Quantity units in KLIP:
 * - shipments.quantity_delivered / actual_vessel_qty_receive: kg (DB)
 * - GET /shipments/contracts/details quantity_delivered|quantity_receive: MT (SAP raw)
 * - UI edit grid (MtQtyInput): kg internally, MT display
 */

export function sapDeliveredOrReceiveMtToKg(mt: number | null | undefined): number | null {
  if (mt === null || mt === undefined) return null
  const n = Number(mt)
  if (!Number.isFinite(n)) return null
  return n * 1000
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
    shipmentDeliveredKg !== null
    && Math.abs(sumDelivered - shipmentDeliveredKg) > 0.5
  const receiveDiffers =
    shipmentReceiveKg !== null
    && Math.abs(sumReceive - shipmentReceiveKg) > 0.5

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

  // Multi-contract: keep SAP split; adjust the largest delivered row so the total matches shipment (kg).
  if (deliveredDiffers && shipmentDeliveredKg !== null) {
    const copy = rows.map((r) => ({ ...r }))
    let idx = 0
    for (let i = 1; i < copy.length; i += 1) {
      if ((copy[i].quantity_delivered ?? 0) > (copy[idx].quantity_delivered ?? 0)) idx = i
    }
    const otherSum = copy.reduce(
      (s, r, i) => (i === idx ? s : s + (r.quantity_delivered ?? 0)),
      0,
    )
    copy[idx] = {
      ...copy[idx],
      quantity_delivered: Math.max(0, shipmentDeliveredKg - otherSum),
    }
    return copy
  }

  return rows
}

/** Shipments list table — kg for display. Prefer KLIP manual row when it differs from SAP. */
export function resolveShipmentListDeliveredKg(shipment: {
  quantity_delivered?: number | string | null
  total_quantity_delivered?: number | string | null
  quantity_delivered_sap?: number | string | null
}): number | null {
  const manual =
    shipmentStoredQtyKg(shipment.quantity_delivered)
    ?? shipmentStoredQtyKg(shipment.total_quantity_delivered)
  const sap = shipmentStoredQtyKg(shipment.quantity_delivered_sap)
  if (manual !== null && sap !== null && Math.abs(manual - sap) > 0.5) return manual
  if (sap !== null) return sap
  return manual
}

export function resolveShipmentListReceiveKg(shipment: {
  actual_vessel_qty_receive?: number | string | null
  quantity_receive?: number | string | null
}): number | null {
  const manual = shipmentStoredQtyKg(shipment.actual_vessel_qty_receive)
  const sap = shipmentStoredQtyKg(shipment.quantity_receive)
  if (manual !== null && sap !== null && Math.abs(manual - sap) > 0.5) return manual
  if (sap !== null) return sap
  return manual
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
