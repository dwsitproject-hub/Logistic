/**
 * Contract Detail → Table List STO: ETA / ETC / ATA / ATC display dates.
 * Trucking ATA/ATC follow KLIP operation status (Completed = SAP, otherwise WB).
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
  return {
    eta: nullDate(input.daily_plan_start_date),
    etc: nullDate(input.daily_plan_end_date),
    ata: completed
      ? nullDate(input.sap_trucking_start_receive_date)
      : nullDate(input.wb_start_date),
    atc: completed
      ? nullDate(input.sap_trucking_last_receive_date)
      : nullDate(input.wb_end_date),
  };
}
