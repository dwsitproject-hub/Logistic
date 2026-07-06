export type ShipmentPoOption = {
  /** Unique selection key — contracts.id (PO line) in contract-scoped mode, contract_id in global mode */
  key: string
  contractId: string
  poNumber?: string | null
  plantCode?: string | null
  label: string
  contractData?: Record<string, unknown>
}

export type EtaDetailApiPayload = {
  port_of_loading: string | null
  eta_arrival: string | null
  eta_berthed: string | null
  eta_loading_start: string | null
  eta_loading_complete: string | null
  eta_sailed: string | null
  eta_discharge_arrival: string | null
  eta_discharge_berthed: string | null
  eta_discharge_start: string | null
  eta_discharge_complete: string | null
}

export type CreateShipmentFormPayload = {
  kind: 'create'
  operationId: string
  stoNumber: string
  contractNumbers: string[]
  contractQtyAssigned: Record<string, string | number>
  poQtyAssigned?: Record<string, string | number>
  vesselName: string
  vesselCode: string
  vesselOwner: string
  vesselDraft: string
  vesselCapacity: string
  vesselHullType: string
  charterType: string
  portOfLoading: string
  portOfDischarge: string
  etaByContract: Record<string, EtaDetailApiPayload>
}

export type UpdateShipmentFormPayload = {
  kind: 'update'
  shipmentId: string
  vessel_name?: string | null
  quantity_delivered?: number | null
  actual_vessel_qty_receive?: number | null
  sfal_qty?: number | null
  sfbd_qty?: number | null
  eta_arrival: string | null
  eta_berthed: string | null
  eta_loading_start: string | null
  eta_loading_complete: string | null
  eta_sailed: string | null
  eta_discharge_arrival: string | null
  eta_discharge_berthed: string | null
  eta_discharge_start: string | null
  eta_discharge_complete: string | null
}

export type AddNewShipmentSubmitPayload = CreateShipmentFormPayload | UpdateShipmentFormPayload

export function mapPurchaseOrderToPoOption(row: Record<string, unknown>): ShipmentPoOption {
  const contractId = String(row.contract_id ?? '').trim()
  const poNumber = row.po_number != null ? String(row.po_number).trim() : ''
  const key = String(row.contract_row_id ?? row.id ?? `${contractId}::${poNumber}`).trim()
  const plantCode =
    row.plant_code != null
      ? String(row.plant_code).trim()
      : row.plant_site != null
        ? String(row.plant_site).trim()
        : ''
  const label = poNumber
    ? plantCode
      ? `${poNumber} - ${plantCode}`
      : poNumber
    : contractId
  return {
    key,
    contractId,
    poNumber: poNumber || null,
    plantCode: plantCode || null,
    label,
    contractData: {
      contract_id: contractId,
      po_number: poNumber || null,
      quantity_ordered: row.quantity_ordered,
      outstanding_quantity: row.outstanding_quantity_planning ?? row.outstanding_quantity,
      outstanding_quantity_planning: row.outstanding_quantity_planning ?? row.outstanding_quantity,
      delivery_start_date: row.delivery_start_date,
      delivery_end_date: row.delivery_end_date,
      supplier: row.supplier,
      buyer: row.buyer,
      product: row.product,
      incoterm: row.incoterm,
      transport_mode: row.transport_mode,
      plant_code: plantCode || null,
      plant_site: row.plant_site != null ? String(row.plant_site).trim() || null : null,
      contract_ext_no: row.contract_ext_no != null ? String(row.contract_ext_no).trim() || null : null,
      port_of_loading: row.port_of_loading != null ? String(row.port_of_loading).trim() || null : null,
      port_of_discharge: row.port_of_discharge != null ? String(row.port_of_discharge).trim() || null : null,
    },
  }
}

export function mapStoContractDetailToPoOption(detail: Record<string, unknown>): ShipmentPoOption {
  const contractId = String(detail.contract_number ?? detail.contract_id ?? '').trim()
  const poNumber = detail.po_number != null ? String(detail.po_number).trim() : ''
  const key = `${contractId}::${poNumber || contractId}`
  const label = poNumber || contractId
  return {
    key,
    contractId,
    poNumber: poNumber || null,
    plantCode: null,
    label,
    contractData: {
      contract_id: contractId,
      po_number: poNumber || null,
      quantity_ordered: detail.contract_qty,
      outstanding_quantity: detail.outstanding_qty,
      delivery_start_date: detail.delivery_start_date,
      delivery_end_date: detail.delivery_end_date,
      contract_ext_no: detail.contract_ext_no,
      sto_qty_assigned: detail.sto_qty_assigned,
      locked_from_sap: detail.locked_from_sap,
    },
  }
}

function mergePoOptionMetadata(base: ShipmentPoOption, enriched: ShipmentPoOption): ShipmentPoOption {
  return {
    ...enriched,
    key: base.key,
    contractId: base.contractId,
    poNumber: base.poNumber ?? enriched.poNumber,
    label: enriched.label || base.label,
    plantCode: enriched.plantCode ?? base.plantCode,
    contractData: {
      ...enriched.contractData,
      ...base.contractData,
    },
  }
}

async function enrichPoOptionsFromPurchaseOrders(options: ShipmentPoOption[]): Promise<ShipmentPoOption[]> {
  if (options.length === 0) return options
  const contractIds = [...new Set(options.map((o) => o.contractId).filter(Boolean))]
  const byContract = new Map<string, ShipmentPoOption[]>()
  await Promise.all(
    contractIds.map(async (contractId) => {
      try {
        byContract.set(contractId, await fetchContractPurchaseOrderOptions(contractId))
      } catch {
        byContract.set(contractId, [])
      }
    }),
  )
  return options.map((opt) => {
    const candidates = byContract.get(opt.contractId) ?? []
    const match =
      candidates.find((c) => c.poNumber && opt.poNumber && c.poNumber === opt.poNumber) ??
      candidates.find((c) => !opt.poNumber || !c.poNumber) ??
      candidates[0]
    return match ? mergePoOptionMetadata(opt, match) : opt
  })
}

export function dedupeShipmentPoOptions(options: ShipmentPoOption[]): ShipmentPoOption[] {
  const seen = new Set<string>()
  const out: ShipmentPoOption[] = []
  for (const opt of options) {
    const dedupeKey = `${opt.contractId}::${opt.poNumber ?? ''}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    out.push(opt)
  }
  return out
}

/** PO lines linked to a grouped STO row (multi-contract / multi-PO). */
export async function fetchStoLinkedPurchaseOrderOptions(
  stoNumber: string,
  contractNumbers: string[] = [],
): Promise<ShipmentPoOption[]> {
  const sto = String(stoNumber ?? '').trim()
  if (!sto) return []
  const api = (await import('@/lib/api')).default
  const res = await api.get('/shipments/contracts/details', {
    params: {
      sto,
      contractNumbers: contractNumbers.filter(Boolean).join(','),
    },
  })
  const rows: Record<string, unknown>[] = res.data?.data ?? []
  const base = dedupeShipmentPoOptions(rows.map(mapStoContractDetailToPoOption))
  return enrichPoOptionsFromPurchaseOrders(base)
}

export async function fetchContractPurchaseOrderOptions(contractId: string): Promise<ShipmentPoOption[]> {
  const api = (await import('@/lib/api')).default
  const res = await api.get(`/shipments/contracts/${encodeURIComponent(contractId)}/purchase-orders`)
  const rows: Record<string, unknown>[] = res.data?.data ?? []
  return rows.map(mapPurchaseOrderToPoOption)
}

/** PO lines eligible to add on Edit Shipment (global search, global OS Qty Plan > 0). */
export async function fetchShipmentAvailablePurchaseOrders(
  shipmentId: string,
  opts?: { search?: string; limit?: number },
): Promise<ShipmentPoOption[]> {
  const api = (await import('@/lib/api')).default
  const params: Record<string, string | number> = {}
  if (opts?.search?.trim()) params.q = opts.search.trim()
  if (opts?.limit != null) params.limit = opts.limit
  const res = await api.get(`/shipments/${encodeURIComponent(shipmentId)}/available-purchase-orders`, {
    params,
  })
  const rows: Record<string, unknown>[] = res.data?.data ?? []
  return rows.map(mapPurchaseOrderToPoOption)
}

export type ShipmentEditContextData = {
  lookup_key?: string
  contract_numbers?: string
  po_numbers?: string
  has_sap_sto?: boolean
  can_add_po?: boolean
  add_po_blocked_reason?: string | null
}

export async function attachPurchaseOrderToShipment(args: {
  shipmentId: string
  contractRowId: string
  stoQtyAssignedMt?: number
  stoQtyAssignedKg?: number
}): Promise<void> {
  const api = (await import('@/lib/api')).default
  const body: Record<string, unknown> = { contractRowId: args.contractRowId }
  if (args.stoQtyAssignedKg != null) body.shipment_plan_qty_kg = args.stoQtyAssignedKg
  else if (args.stoQtyAssignedMt != null) body.stoQtyAssignedMt = args.stoQtyAssignedMt
  else body.shipment_plan_qty_kg = 0
  const res = await api.post(
    `/shipments/${encodeURIComponent(args.shipmentId)}/purchase-orders`,
    body,
  )
  if (!res.data?.success) {
    throw new Error(res.data?.error?.message || 'Failed to add PO to shipment')
  }
}

export async function batchSaveShipmentPoPlanQty(args: {
  shipmentId: string
  rows: Array<{
    contractNumber: string
    poNumber?: string | null
    shipmentPlanQtyKg: number
  }>
}): Promise<void> {
  const api = (await import('@/lib/api')).default
  const res = await api.put(`/shipments/${encodeURIComponent(args.shipmentId)}/po-plan-qty`, {
    rows: args.rows.map((row) => ({
      contractNumber: row.contractNumber,
      poNumber: row.poNumber ?? null,
      shipmentPlanQtyKg: row.shipmentPlanQtyKg,
    })),
  })
  if (!res.data?.success) {
    throw new Error(res.data?.error?.message || 'Failed to save Shipment Plan Qty')
  }
}
