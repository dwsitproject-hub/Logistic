import type { OilLossSourceRow } from '@/lib/oilLossAllContractColumns'
import { cleanDischargePortLabel, masterPortLabel, realDischargePicks, type DischargePortResolver } from '@/lib/dischargePortFilter'
import { displayPortLabel, masterPortOf, normalizeListPortIdentity } from '@/lib/portDisplay'

/** What a row with no loading port is listed as in the drilldown, the same word the other Oil Loss groupings use. It is not a pick of the filter. */
export const OIL_LOSS_BLANK_LOADING_PORT = 'Blank'

type LoadingPortRow = Pick<OilLossSourceRow, 'loading_location'> & Partial<Pick<OilLossSourceRow, 'transport_mode'>>

/**
 * A trucking row's loading_location is a mill or a depot, not a port (Trucking is out of the Master Port mapping); only a row that is not a truck row is read as a port.
 * A row with no mode is read as a vessel row, as every row before this rule was.
 */
export function isOilLossTruckRow(row: { transport_mode?: string | null }): boolean {
  return String(row.transport_mode ?? '').trim().toUpperCase() === 'LAND'
}

/**
 * The loading port of an Oil Loss row, as one comparable label, for the drilldown.
 *
 * `loading_location` of a vessel row is the shipment's `port_of_loading` - the primary (first) loading port. A voyage that loads at several
 * ports is counted once, under that primary port: its Loss % is one figure for the whole voyage, and there is no received quantity per port to
 * split it by. The label is the Master Port of that text when it has one (the page hands its map to lib/portDisplay.ts), else the text as it is, trimmed,
 * single-spaced and upper-cased; otherwise "Pom Kendawangan" and "POM KENDAWANGAN" would be two ports.
 */
export function oilLossLoadingPortLabel(row: LoadingPortRow): string {
  const text = cleanDischargePortLabel(row.loading_location)
  if (!text) return OIL_LOSS_BLANK_LOADING_PORT
  return (isOilLossTruckRow(row) ? null : masterPortOf(text)) ?? text
}

/**
 * True for any row when nothing is picked; otherwise when the row's loading port is one of the picked Master Ports. A row whose text has no Master Port, and every truck
 * row, is never one of them. Without the map the spelling decides, so the filter still works before it has loaded.
 */
export function matchesOilLossLoadingPortFilter(
  row: LoadingPortRow,
  selectedLoadingPorts: readonly string[],
  resolver?: DischargePortResolver | null,
): boolean {
  const selected = realDischargePicks(selectedLoadingPorts)
  if (selected.length === 0) return true
  if (isOilLossTruckRow(row)) return false
  const text = cleanDischargePortLabel(row.loading_location)
  if (!text) return false
  if (!resolver) {
    const identity = normalizeListPortIdentity(text) || text
    return selected.some((port) => (normalizeListPortIdentity(port) || cleanDischargePortLabel(port)) === identity)
  }
  const label = masterPortLabel(text, resolver)
  if (!label) return false
  const identity = normalizeListPortIdentity(label) || label
  return selected.some((port) => {
    const wanted = masterPortLabel(port, resolver) ?? cleanDischargePortLabel(port)
    return (normalizeListPortIdentity(wanted) || wanted) === identity
  })
}

/**
 * The Loading Port dropdown: the Master Ports the vessel rows load at (once each, however many texts they use for it), plus whatever is picked so a pick stays
 * listed and ticked when the other filters leave it no row. A text with no Master Port is not offered, and there is no Blank.
 */
export function oilLossLoadingPortOptions(
  rows: readonly LoadingPortRow[],
  selected: readonly string[],
  resolver?: DischargePortResolver | null,
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (label: string) => {
    if (!label) return
    const key = normalizeListPortIdentity(label) || label
    if (seen.has(key)) return
    seen.add(key)
    out.push(label)
  }
  realDischargePicks(selected).forEach((port) => add(masterPortLabel(port, resolver) ?? cleanDischargePortLabel(port)))
  for (const row of rows) {
    if (isOilLossTruckRow(row)) continue
    const text = cleanDischargePortLabel(row.loading_location)
    add(resolver ? masterPortLabel(text, resolver) ?? '' : text)
  }
  return out.sort((a, b) => a.localeCompare(b))
}

/**
 * A location of an Oil Loss row as the table DRAWS it: a vessel row's port as its Master Port when it has one, else as SAP wrote it; a trucking row's
 * location (a mill, a depot, a plant) as it is. Nothing (an empty text) stays null so the cell keeps its "-".
 */
export function oilLossDrawnLocation(
  row: { transport_mode?: string | null; loading_location?: string | null; unloading_location?: string | null },
  field: 'loading_location' | 'unloading_location',
): string | null {
  const text = String(row[field] ?? '').trim()
  if (!text) return null
  return isOilLossTruckRow(row) ? text : displayPortLabel(text)
}
