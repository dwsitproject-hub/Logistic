import {
  sqlSapTruckingLastReceiveDate,
  sqlSapTruckingStartReceiveDate,
} from './truckingSapDates';

/** LEFT JOIN for trucking list / detail queries. */
export const TRUCKING_REALIZATIONS_JOIN = `
  LEFT JOIN trucking_realizations tr ON tr.trucking_operation_id = t.id`;

/**
 * Start Receive Date for list / pipeline / detail:
 * SAP Trucking Start Receive (AV) first; if null → WB/extension realization; if null → op start (legacy WB).
 */
export function sqlRealizationStartDate(contractAlias = 'c'): string {
  return `COALESCE(
    ${sqlSapTruckingStartReceiveDate(contractAlias)},
    tr.realization_start_date,
    t.trucking_start_date
  )`;
}

/**
 * Realization end (ATA): extension row, then SAP AW — never planning columns on trucking_operations.
 */
export function sqlRealizationEndDate(contractAlias = 'c'): string {
  return `COALESCE(
    tr.realization_end_date,
    ${sqlSapTruckingLastReceiveDate(contractAlias)}
  )`;
}

/**
 * Fast shell list — DB / extension only (no sap_processed_data).
 * Prefer WB realization, then legacy op date; SAP filled on hydrate via {@link sqlRealizationStartDate}.
 */
export function sqlShellRealizationStartDate(): string {
  return `COALESCE(tr.realization_start_date, t.trucking_start_date)`;
}

/** Fast shell list — DB / extension only (no sap_processed_data). */
export function sqlShellRealizationEndDate(): string {
  return `COALESCE(tr.realization_end_date, t.trucking_completion_date)`;
}
