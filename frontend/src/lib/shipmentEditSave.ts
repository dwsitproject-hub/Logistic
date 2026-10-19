/**
 * Edit Shipment: two small rules the modal shares with its tests.
 */

/**
 * Can this PO row take a Delivered / Received / Shipment Plan Qty? The API says so per row (`klip_qty_editable`): false for a PO that has no live
 * shipment in the STO / operation group (its shipment was cancelled, or it only rides the STO in SAP), which the save would refuse with a 400.
 * A payload without the field - an older backend, or a failed check - means editable, as before.
 */
export function klipQtyEditableFromApi(value: unknown): boolean {
  return value !== false
}

/**
 * The reason the server gave, not axios's "Request failed with status code 400": the modal printed error.message, which hid it - "No sibling
 * shipment found for contract ..." read as a bare 400 and nobody could say what to fix.
 */
export function shipmentSaveErrorMessage(error: unknown, fallback = 'Failed to save shipment'): string {
  const fromServer = (error as { response?: { data?: { error?: { message?: unknown } } } })?.response?.data?.error?.message
  if (typeof fromServer === 'string' && fromServer.trim()) return fromServer.trim()
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}
