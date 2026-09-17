export type ShipmentTcR4ShortageRow = {
  quantity_delivered_klip: number | null
  quantity_delivered_sap: number | null
  quantity_receive_klip: number | null
  quantity_receive_sap: number | null
}

function resolveDeliveredKg(row: ShipmentTcR4ShortageRow): number | null {
  if (row.quantity_delivered_klip != null) return row.quantity_delivered_klip
  return row.quantity_delivered_sap
}

function resolveReceiveKg(row: ShipmentTcR4ShortageRow): number | null {
  if (row.quantity_receive_klip != null) return row.quantity_receive_klip
  return row.quantity_receive_sap
}

/**
 * R4 oil loss (MT) for TC vessel performance: (Qty Receive − Qty Delivery) ÷ 1,000.
 * Aggregates across all PO lines; KLIP qty preferred over SAP.
 */
export function computeShipmentR4ShortageMt(detailRows: ShipmentTcR4ShortageRow[]): number | null {
  let totalDelivery = 0
  let totalReceive = 0
  let hasReceive = false

  for (const row of detailRows) {
    const delivery = resolveDeliveredKg(row)
    const receive = resolveReceiveKg(row)
    if (delivery != null) totalDelivery += delivery
    if (receive != null) {
      totalReceive += receive
      hasReceive = true
    }
  }

  if (totalDelivery <= 0 || !hasReceive) return null
  return (totalReceive - totalDelivery) / 1000
}

export type ShippingListShortageQtyRow = {
  shortage?: number | null
  delivered_qty?: number | null
  received_qty?: number | null
  quantity_delivered?: number | null
  quantity_delivered_klip?: number | null
  actual_vessel_qty_receive?: number | null
  quantity_receive_klip?: number | null
}

/** R4 MT for list/table rows; falls back to persisted shortage when qty preconditions fail. */
export function resolveShippingTcShortageMtForListRow(row: ShippingListShortageQtyRow): number | null {
  const computed = computeShipmentR4ShortageMt([
    {
      quantity_delivered_klip: row.quantity_delivered_klip ?? null,
      quantity_delivered_sap: row.quantity_delivered ?? row.delivered_qty ?? null,
      quantity_receive_klip: row.quantity_receive_klip ?? row.actual_vessel_qty_receive ?? null,
      quantity_receive_sap: row.received_qty ?? null,
    },
  ])
  if (computed !== null) return computed
  if (row.shortage === null || row.shortage === undefined) return null
  const n = Number(row.shortage)
  return Number.isFinite(n) ? n : null
}
