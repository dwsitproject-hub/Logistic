import type { OilLossSourceRow } from '@/lib/oilLossAllContractColumns'
import {
  BLANK_DISCHARGE_PORT,
  dischargePortLabel,
  dischargePortOptionsFrom,
  matchesDischargePortSelection,
  realDischargePicks,
  type DischargePortResolver,
} from '@/lib/dischargePortFilter'
import { displayPortLabel } from '@/lib/portDisplay'

/** What a row with no discharge port is listed as in the other Oil Loss groupings. It is not a pick of the filter. */
export const OIL_LOSS_BLANK_DISCHARGE_PORT = BLANK_DISCHARGE_PORT

type DischargePortRow = Pick<OilLossSourceRow, 'unloading_location'> & Partial<Pick<OilLossSourceRow, 'transport_mode'>>

/**
 * A trucking row's unloading_location is a plant or a location, not a port (Trucking is out of the Master Port mapping); only a row that is not a truck row is read as a
 * port. A row with no mode is read as a vessel row, as every row before this rule was.
 */
export function isOilLossTruckRow(row: { transport_mode?: string | null }): boolean {
  return String(row.transport_mode ?? '').trim().toUpperCase() === 'LAND'
}

/**
 * The unloading location of an Oil Loss row as the table DRAWS it: a vessel row's discharge port as its Master Port when it has one, else as SAP wrote it; a trucking
 * row's location as it is. Nothing (an empty text) stays null so the cell keeps its "-". The LOADING location is not mapped: loading texts are mills and depots as much as
 * ports, and stay as SAP wrote them.
 */
export function oilLossDrawnUnloadingLocation(row: { transport_mode?: string | null; unloading_location?: string | null }): string | null {
  const text = String(row.unloading_location ?? '').trim()
  if (!text) return null
  return isOilLossTruckRow(row) ? text : displayPortLabel(text)
}

/**
 * The discharge port of an Oil Loss row, as one label (what "the same port" means, and the Master Port mapping, are in lib/dischargePortFilter.ts).
 *
 * `unloading_location` of a vessel row is the shipment's `port_of_discharge` (oilLossVesselCompletedSql.ts): free text, one value per STO. A trucking row's is a
 * plant or a location, not a port, and is drawn as it is.
 */
export function oilLossDischargePortLabel(row: DischargePortRow, resolver?: DischargePortResolver | null): string {
  return dischargePortLabel(row.unloading_location, isOilLossTruckRow(row) ? null : resolver)
}

/**
 * True for any row when nothing is picked; otherwise when the row's port is one of the picked Master Ports. A row whose text has no Master Port, and every truck
 * row (a location, not a port), is never one of them.
 */
export function matchesOilLossDischargePortFilter(
  row: DischargePortRow,
  selectedDischargePorts: readonly string[],
  resolver?: DischargePortResolver | null,
): boolean {
  if (realDischargePicks(selectedDischargePorts).length > 0 && isOilLossTruckRow(row)) return false
  return matchesDischargePortSelection(row.unloading_location, selectedDischargePorts, resolver)
}

/** The Discharge Port dropdown of Oil Loss: the Master Ports the vessel rows are at, plus whatever is picked. */
export function oilLossDischargePortOptions(
  rows: readonly DischargePortRow[],
  selected: readonly string[],
  resolver?: DischargePortResolver | null,
): string[] {
  return dischargePortOptionsFrom(
    rows.filter((row) => !isOilLossTruckRow(row)).map((row) => row.unloading_location),
    selected,
    resolver,
  )
}
