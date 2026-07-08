import { normalizeShipmentStatusKey } from '@/lib/shipmentStatusDisplay'
import { resolveShipmentDisplayStoNumber } from '@/lib/shipmentStoDisplay'

export type ShipmentTablePrimaryAction = 'add' | 'edit' | 'view'

/** Primary action for Shipments view-table row (Unplanned → Add, Planned–Completed → Edit, Cancelled → View). */
export function resolveShipmentTablePrimaryAction(
  status: string | null | undefined,
): ShipmentTablePrimaryAction {
  const key = normalizeShipmentStatusKey(status)
  if (key === 'CANCELLED') return 'view'
  if (key === 'UNPLANNED') return 'add'
  return 'edit'
}

/** True when list row already has ETA/planning registered (not Unplanned). */
export function shipmentRowHasRegisteredPlanning(status: string | null | undefined): boolean {
  const key = normalizeShipmentStatusKey(status)
  return key !== '' && key !== 'UNPLANNED'
}

/** KLIP-only shipment groups (no official SAP STO) may be cancelled from the view table. */
export function canCancelKlipShipment(shipment: {
  status?: string | null
  row_kind?: string | null
  sto_number?: string | null
  sto_key?: string | null
  operation_id?: string | null
}): boolean {
  const status = normalizeShipmentStatusKey(shipment.status)
  if (status === 'CANCELLED') return false
  if (String(shipment.row_kind ?? '').trim() === 'contract_backlog') return false

  const displaySto = resolveShipmentDisplayStoNumber(shipment.sto_number)
  if (displaySto !== '-') return false

  const stoKey = String(shipment.sto_key ?? '').trim()
  if (/^\d+$/.test(stoKey)) return false

  const operationId = String(shipment.operation_id ?? '').trim()
  if (/^\d+$/.test(operationId)) return false

  return true
}
