import { diffCalendarDays } from './calendarDays';

/** Row fields used to derive Shipping Performance cycle deltas (mirrors SQL in shippingPerformance.service). */
export interface ShippingPerfDeltaSourceRow {
  cargo_readiness_date?: unknown;
  loading_eta_arrival?: unknown;
  loading_eta_berthed?: unknown;
  loading_eta_completed?: unknown;
  discharge_eta_arrival?: unknown;
  discharge_eta_berthed?: unknown;
  discharge_eta_completed?: unknown;
  loading_ata_arrival?: unknown;
  loading_ata_berthed?: unknown;
  loading_ata_completed?: unknown;
  discharge_ata_arrival?: unknown;
  discharge_ata_berthed?: unknown;
  discharge_ata_completed?: unknown;
}

export interface ShippingPerfDeltaFields {
  loading_delta_eta_etr_days: number | null;
  loading_delta_eta_etb_days: number | null;
  loading_delta_etb_etc_days: number | null;
  discharge_delta_eta_etb_days: number | null;
  discharge_delta_etb_etc_days: number | null;
  total_delta_days: number | null;
  ata_loading_delta_eta_etr_days: number | null;
  ata_loading_delta_eta_etb_days: number | null;
  ata_loading_delta_etb_etc_days: number | null;
  ata_discharge_delta_eta_etb_days: number | null;
  ata_discharge_delta_etb_etc_days: number | null;
  ata_total_delta_days: number | null;
}

function sumSegmentsOrNull(segments: Array<number | null>): number | null {
  if (segments.every((value) => value == null)) return null;
  return segments.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

/** Recompute signed cycle deltas from resolved milestone dates (ETA + ATA variants). */
export function computeShippingPerfDeltaFields(
  row: ShippingPerfDeltaSourceRow,
): ShippingPerfDeltaFields {
  const loading_delta_eta_etr_days = diffCalendarDays(
    row.cargo_readiness_date,
    row.loading_eta_arrival,
  );
  const loading_delta_eta_etb_days = diffCalendarDays(
    row.loading_eta_berthed,
    row.loading_eta_arrival,
  );
  const loading_delta_etb_etc_days = diffCalendarDays(
    row.loading_eta_completed,
    row.loading_eta_berthed,
  );
  const discharge_delta_eta_etb_days = diffCalendarDays(
    row.discharge_eta_berthed,
    row.discharge_eta_arrival,
  );
  const discharge_delta_etb_etc_days = diffCalendarDays(
    row.discharge_eta_completed,
    row.discharge_eta_berthed,
  );

  const ata_loading_delta_eta_etr_days = diffCalendarDays(
    row.cargo_readiness_date,
    row.loading_ata_arrival,
  );
  const ata_loading_delta_eta_etb_days = diffCalendarDays(
    row.loading_ata_berthed,
    row.loading_ata_arrival,
  );
  const ata_loading_delta_etb_etc_days = diffCalendarDays(
    row.loading_ata_completed,
    row.loading_ata_berthed,
  );
  const ata_discharge_delta_eta_etb_days = diffCalendarDays(
    row.discharge_ata_berthed,
    row.discharge_ata_arrival,
  );
  const ata_discharge_delta_etb_etc_days = diffCalendarDays(
    row.discharge_ata_completed,
    row.discharge_ata_berthed,
  );

  const etaSegments = [
    loading_delta_eta_etr_days,
    loading_delta_eta_etb_days,
    loading_delta_etb_etc_days,
    discharge_delta_eta_etb_days,
    discharge_delta_etb_etc_days,
  ];
  const ataSegments = [
    ata_loading_delta_eta_etr_days,
    ata_loading_delta_eta_etb_days,
    ata_loading_delta_etb_etc_days,
    ata_discharge_delta_eta_etb_days,
    ata_discharge_delta_etb_etc_days,
  ];

  return {
    loading_delta_eta_etr_days,
    loading_delta_eta_etb_days,
    loading_delta_etb_etc_days,
    discharge_delta_eta_etb_days,
    discharge_delta_etb_etc_days,
    total_delta_days: sumSegmentsOrNull(etaSegments),
    ata_loading_delta_eta_etr_days,
    ata_loading_delta_eta_etb_days,
    ata_loading_delta_etb_etc_days,
    ata_discharge_delta_eta_etb_days,
    ata_discharge_delta_etb_etc_days,
    ata_total_delta_days: sumSegmentsOrNull(ataSegments),
  };
}
