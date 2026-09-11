import {
  sqlSapTruckingLastReceiveDate,
  sqlSapTruckingLastReceiveDateFromLateral,
  sqlSapTruckingStartReceiveDate,
  sqlSapTruckingStartReceiveDateFromLateral,
} from './truckingSapDates';

/** LEFT JOIN for trucking list / detail queries. */
export const TRUCKING_REALIZATIONS_JOIN = `
  LEFT JOIN trucking_realizations tr ON tr.trucking_operation_id = t.id`;

/**
 * Start Receive Date for list / pipeline / detail:
 * SAP Trucking Start Receive (AV) first; if null → WB/extension realization; if null → op start (legacy WB).
 */
export function sqlRealizationStartDate(contractAlias = 'c', sapAlias?: string): string {
  return `COALESCE(
    ${
      sapAlias
        ? sqlSapTruckingStartReceiveDateFromLateral(sapAlias)
        : sqlSapTruckingStartReceiveDate(contractAlias)
    },
    tr.realization_start_date,
    t.trucking_start_date
  )`;
}

/**
 * Realization end (ATA): extension row, then SAP AW — never planning columns on trucking_operations.
 */
export function sqlRealizationEndDate(contractAlias = 'c', sapAlias?: string): string {
  return `COALESCE(
    tr.realization_end_date,
    ${
      sapAlias
        ? sqlSapTruckingLastReceiveDateFromLateral(sapAlias)
        : sqlSapTruckingLastReceiveDate(contractAlias)
    }
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

/**
 * ATA for the Late Indicator: actual receipt only, never a planning date.
 *
 * `sqlShellRealizationEndDate` above falls back to `t.trucking_completion_date`, which is the
 * *daily planning* end date (the expansion aliases that same column `planning_end_date`). That
 * fallback is fine for the displayed Trucking Completion Date, but it conflates plan with actual:
 * it holds 14,458 values where the raw actual holds 1,310, so a row that has only been planned
 * looks like it has been received.
 *
 * The Late Indicator needs the two kept apart - ATA first, then the planning date as the ETA
 * fallback - so it reads this instead. The full-SAP path already has it right in
 * `sqlRealizationEndDate`, whose own note says "never planning columns"; the shell simply has no
 * SAP to consult, so WB/extension is all there is.
 */
export function sqlShellTruckingAtaEndDate(): string {
  return `tr.realization_end_date`;
}
