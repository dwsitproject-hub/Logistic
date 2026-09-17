/**
 * Contract Detail → Table List STO: ETA / ETC / ATA / ATC display dates.
 *
 * Trucking ATA/ATC follow the contract's own rule: while the operation is still running KLIP's own
 * record (the weighbridge) is preferred, and once it is Completed SAP is. Either way the other side
 * is a fallback rather than nothing - the two systems record the same journey, so a date held by
 * only one of them is still the date.
 *
 * It used to read one side only, and a column that had an answer showed a dash. Contract
 * 1004030966's land leg (OP-LAND-110920264450) is the shape: no weighbridge upload at all, SAP
 * holding 28/02/2026 and 07/03/2026, and the table printing "-" under both ATA and ATC while Edit
 * Trucking showed the dates one click away.
 */

export interface StoListMilestoneInput {
  type: 'shipment' | 'trucking';
  status?: string | null;
  eta_vessel_arrival_loading_port?: string | null;
  eta_discharge_complete?: string | null;
  ata_arrival_loading?: string | null;
  ata_discharge_complete?: string | null;
  daily_plan_start_date?: string | null;
  daily_plan_end_date?: string | null;
  wb_start_date?: string | null;
  wb_end_date?: string | null;
  sap_trucking_start_receive_date?: string | null;
  sap_trucking_last_receive_date?: string | null;
}

export interface StoListMilestoneDates {
  eta: string | null;
  etc: string | null;
  ata: string | null;
  atc: string | null;
}

function nullDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

export function isStoListTruckingCompleted(status: unknown): boolean {
  return String(status ?? '').trim().toUpperCase() === 'COMPLETED';
}

export function resolveStoListMilestoneDates(input: StoListMilestoneInput): StoListMilestoneDates {
  if (input.type === 'shipment') {
    return {
      eta: nullDate(input.eta_vessel_arrival_loading_port),
      etc: nullDate(input.eta_discharge_complete),
      ata: nullDate(input.ata_arrival_loading),
      atc: nullDate(input.ata_discharge_complete),
    };
  }

  const completed = isStoListTruckingCompleted(input.status);
  const wbStart = nullDate(input.wb_start_date);
  const wbEnd = nullDate(input.wb_end_date);
  const sapStart = nullDate(input.sap_trucking_start_receive_date);
  const sapEnd = nullDate(input.sap_trucking_last_receive_date);
  return {
    eta: nullDate(input.daily_plan_start_date),
    etc: nullDate(input.daily_plan_end_date),
    ata: completed ? (sapStart ?? wbStart) : (wbStart ?? sapStart),
    atc: completed ? (sapEnd ?? wbEnd) : (wbEnd ?? sapEnd),
  };
}
