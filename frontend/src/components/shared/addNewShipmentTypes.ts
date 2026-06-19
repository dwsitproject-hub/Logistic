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
      outstanding_quantity: row.outstanding_quantity,
      delivery_start_date: row.delivery_start_date,
      delivery_end_date: row.delivery_end_date,
      supplier: row.supplier,
      product: row.product,
      transport_mode: row.transport_mode,
      plant_code: plantCode || null,
    },
  }
}

export async function fetchContractPurchaseOrderOptions(contractId: string): Promise<ShipmentPoOption[]> {
  const api = (await import('@/lib/api')).default
  const res = await api.get(`/shipments/contracts/${encodeURIComponent(contractId)}/purchase-orders`)
  const rows: Record<string, unknown>[] = res.data?.data ?? []
  return rows.map(mapPurchaseOrderToPoOption)
}
