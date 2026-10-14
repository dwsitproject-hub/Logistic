import type { OilLossSourceRow } from '@/lib/oilLossAllContractColumns'
import {
  BLANK_DISCHARGE_PORT,
  dischargePortLabel,
  dischargePortOptionsFrom,
  matchesDischargePortSelection,
} from '@/lib/dischargePortFilter'

/** What a row with no discharge port is listed and filtered as, the same word the other Oil Loss groupings use. */
export const OIL_LOSS_BLANK_DISCHARGE_PORT = BLANK_DISCHARGE_PORT

/**
 * The discharge port of an Oil Loss row, as one label (what "the same port" means is in lib/dischargePortFilter.ts).
 *
 * `unloading_location` of a vessel row is the shipment's `port_of_discharge` (oilLossVesselCompletedSql.ts): free text, one value per STO.
 */
export function oilLossDischargePortLabel(row: Pick<OilLossSourceRow, 'unloading_location'>): string {
  return dischargePortLabel(row.unloading_location)
}

/** True for any row when nothing is picked; otherwise when the row's port is one of the picked ports. */
export function matchesOilLossDischargePortFilter(
  row: Pick<OilLossSourceRow, 'unloading_location'>,
  selectedDischargePorts: readonly string[],
): boolean {
  return matchesDischargePortSelection(row.unloading_location, selectedDischargePorts)
}

/** The Discharge Port dropdown of Oil Loss: the ports the rows have, plus whatever is picked. */
export function oilLossDischargePortOptions(
  rows: readonly Pick<OilLossSourceRow, 'unloading_location'>[],
  selected: readonly string[],
): string[] {
  return dischargePortOptionsFrom(
    rows.map((row) => row.unloading_location),
    selected,
  )
}
