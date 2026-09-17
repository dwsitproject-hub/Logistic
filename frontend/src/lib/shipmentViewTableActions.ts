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

export type ShipmentRowOpenTarget = 'contract_detail' | 'add_shipment' | 'edit_shipment'

/**
 * Where opening a Shipments row should actually go.
 *
 * Contract backlog rows carry the CONTRACT's uuid in `id` - the backlog SQL emits
 * `c.id::text AS id` because no shipment exists yet. Sending that to GET /shipments/:id looks it
 * up in `shipments.id` and answers 404, which is what users hit on both View and Edit.
 *
 * So a backlog row never goes to a shipment-by-id screen: View has nothing to show and opens
 * Contract Details, Edit has nothing to edit and opens Add New Shipment with the contract
 * prefilled. Status is irrelevant for backlog rows - the backlog SQL can label one COMPLETED via
 * its low-OS promotion, and it still has no shipment behind it.
 */
export function resolveShipmentRowOpenTarget(
  row: { row_kind?: string | null },
  options?: { readOnly?: boolean },
): ShipmentRowOpenTarget {
  if (String(row.row_kind ?? '').trim() === 'contract_backlog') {
    return options?.readOnly === true ? 'contract_detail' : 'add_shipment'
  }
  // A real shipment row: both View and Edit open the same modal, read-only or not.
  return 'edit_shipment'
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
    return 'Contract backlog rows cannot be cancelled'
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
