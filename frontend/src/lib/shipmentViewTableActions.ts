import { normalizeShipmentStatusKey } from '@/lib/shipmentStatusDisplay'
import { resolveShipmentDisplayStoNumber } from '@/lib/shipmentStoDisplay'

export type ShipmentTablePrimaryAction = 'add' | 'edit' | 'view'

/** Primary action for Shipments view-table row (Unplanned/Preplanned → Add, Planned–Completed → Edit, Cancelled → View). */
export function resolveShipmentTablePrimaryAction(
  status: string | null | undefined,
): ShipmentTablePrimaryAction {
  const key = normalizeShipmentStatusKey(status)
  if (key === 'CANCELLED') return 'view'
  if (key === 'UNPLANNED' || key === 'PREPLANNED') return 'add'
  return 'edit'
}

/** True when list row already has ETA/planning registered (not Unplanned/Preplanned). */
export function shipmentRowHasRegisteredPlanning(status: string | null | undefined): boolean {
  const key = normalizeShipmentStatusKey(status)
  return key !== '' && key !== 'UNPLANNED' && key !== 'PREPLANNED'
}

/** KLIP-only shipment groups (no official SAP STO) may be cancelled from the view table. */
export function canCancelKlipShipment(shipment: {
  status?: string | null
  row_kind?: string | null
  sto_number?: string | null
  sto_key?: string | null
  operation_id?: string | null
}): boolean {
  return cancelKlipShipmentDisabledReason(shipment) == null
}

/** Human-readable reason when Cancel is not allowed; `null` when eligible. */
export function cancelKlipShipmentDisabledReason(shipment: {
  status?: string | null
  row_kind?: string | null
  sto_number?: string | null
  sto_key?: string | null
  operation_id?: string | null
}): string | null {
  const status = normalizeShipmentStatusKey(shipment.status)
  if (status === 'CANCELLED') return 'Shipment is already cancelled'

  if (String(shipment.row_kind ?? '').trim() === 'contract_backlog') {
    return 'Unplanned backlog rows cannot be cancelled'
  }

  const displaySto = resolveShipmentDisplayStoNumber(shipment.sto_number)
  if (displaySto !== '-') {
    return 'Only KLIP shipments without an SAP STO can be cancelled'
  }

  const stoKey = String(shipment.sto_key ?? '').trim()
  if (/^\d+$/.test(stoKey)) {
    return 'Only KLIP shipments without an SAP STO can be cancelled'
  }

  const operationId = String(shipment.operation_id ?? '').trim()
  if (/^\d+$/.test(operationId)) {
    return 'Only KLIP shipments without an SAP STO can be cancelled'
  }

  return null
}
