import { normalizeShipmentStatusKey } from '@/lib/shipmentStatusDisplay'

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
