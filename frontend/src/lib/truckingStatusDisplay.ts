/**
 * Display labels and badge colours for a trucking operation's status.
 *
 * Kept here rather than inside the Trucking page because it is not only the Trucking page that
 * shows one. Contract Details lists shipments and trucking operations in the same "Table List STO"
 * table, and it used to render both through the SHIPMENT label map. The two vocabularies overlap on
 * exactly one value and disagree about it: a trucking operation in IN_PROGRESS came out labelled
 * "Arrived LP" - a vessel milestone, on a truck. An LCO contract with a single land leg therefore
 * read as though it had arrived at a loading port.
 *
 * IN_PROGRESS reads as "Planned" because the PLANNED stage never actually occurs for trucking:
 * an operation goes from UNPLANNED straight to IN_PROGRESS once a realization date exists. The two
 * are the same thing to a reader, so they carry one label.
 */
export const TRUCKING_STATUS_LABELS: Record<string, string> = {
  OPEN: 'Open',
  CLOSE: 'Close',
  UNPLANNED: 'Unplanned',
  PLANNED: 'Planned',
  IN_PROGRESS: 'Planned',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

export function formatTruckingStatusLabel(status: string | undefined | null): string {
  const key = String(status ?? '').trim().toUpperCase()
  return TRUCKING_STATUS_LABELS[key] ?? (key || '-')
}

export function truckingStatusBadgeClass(status: string | undefined | null): string {
  switch (String(status ?? '').trim().toUpperCase()) {
    case 'UNPLANNED':
      return 'bg-slate-100 text-slate-800'
    case 'PLANNED':
    case 'IN_PROGRESS':
      return 'bg-blue-100 text-blue-800'
    case 'COMPLETED':
      return 'bg-green-100 text-green-800'
    case 'CANCELLED':
      return 'bg-red-100 text-red-800'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}
