/**
 * The derived columns of the latest SAP row per contract, as one definition.
 *
 * These were written inline in `buildUnplannedContractBacklogLatestSpdCte` and again in the
 * Shipments controller. They now also have to be *stored* on
 * `contract_latest_spd_snapshot` - reading six typed columns instead of pulling 26 jsonb keys per
 * row measured 326,763 buffers down to 214,555 on the completed-backlog count (-34%), and the
 * table 52 MB down to 2,480 kB.
 *
 * A stored column and a live expression that disagree would be a silent data bug, so the refresh
 * that writes the columns and the fallback that computes them read from here.
 *
 * `discharge_destination` and `source_type_raw` already had shared helpers
 * (`sapDischargeDestinationFromJson`, `sqlSapSourceTypeFromJsonb`) and are re-exported through
 * `LATEST_SPD_DERIVED_COLUMNS` so every caller gets the whole set from one place.
 */

import { sapDischargeDestinationFromJson } from './sapTruckingLoadingLocationSql';
import { sqlSapSourceTypeFromJsonb } from './sapSourceTypeSql';

/**
 * Effective STO.
 *
 * `stoNumberExpr` is the stored `sto_number` column, which comes first. It adds nothing over the
 * JSON arms in practice - the two forms agreed for all 18,711 contracts - but it stays first so
 * the expression is unchanged from the one it replaces. Snapshot rows pass `NULL::text`.
 */
export function sqlLatestSpdEffectiveSto(dataExpr: string, stoNumberExpr: string): string {
  return `NULLIF(TRIM(COALESCE(
            ${stoNumberExpr}::text,
            ${dataExpr}->'raw'->>'STO No.',
            ${dataExpr}->'raw'->>'STO Number',
            ${dataExpr}->'shipment'->>'sto_no',
            ${dataExpr}->'contract'->>'sto_no'
          )), '')`;
}

export function sqlLatestSpdB2bFlagRaw(dataExpr: string): string {
  return `COALESCE(
            ${dataExpr}->'contract'->>'contract_type',
            ${dataExpr}->>'B2B Flag',
            ${dataExpr}->'raw'->>'B2B Flag',
            ${dataExpr}->>'Contract Type'
          )`;
}

export function sqlLatestSpdContractReferencePoRaw(dataExpr: string): string {
  return `COALESCE(
            ${dataExpr}->'contract'->>'contract_reference_po',
            ${dataExpr}->>'CONTRACT REFF PO',
            ${dataExpr}->>'Contract Reff PO Ini',
            ${dataExpr}->'raw'->>'Contract Reff PO Ini',
            ${dataExpr}->'raw'->>'CONTRACT REFF PO'
          )`;
}

export function sqlLatestSpdContractExtNoRaw(dataExpr: string): string {
  return `COALESCE(
            ${dataExpr}->'raw'->>'Contract Ext No',
            ${dataExpr}->>'Contract Ext No'
          )`;
}

/** Column name -> expression, in the order the snapshot stores them. */
export const LATEST_SPD_DERIVED_COLUMNS = [
  'effective_sto',
  'b2b_flag_raw',
  'contract_reference_po_raw',
  'contract_ext_no_raw',
  'discharge_destination',
  'source_type_raw',
] as const;

export type LatestSpdDerivedColumn = (typeof LATEST_SPD_DERIVED_COLUMNS)[number];

/**
 * The six expressions against a given `data` and `sto_number`, keyed by the column they populate.
 * Used by the snapshot refresh to write them and by the live fallback to compute them.
 */
export function latestSpdDerivedExprs(
  dataExpr: string,
  stoNumberExpr: string,
): Record<LatestSpdDerivedColumn, string> {
  return {
    effective_sto: sqlLatestSpdEffectiveSto(dataExpr, stoNumberExpr),
    b2b_flag_raw: sqlLatestSpdB2bFlagRaw(dataExpr),
    contract_reference_po_raw: sqlLatestSpdContractReferencePoRaw(dataExpr),
    contract_ext_no_raw: sqlLatestSpdContractExtNoRaw(dataExpr),
    discharge_destination: sapDischargeDestinationFromJson(dataExpr),
    source_type_raw: sqlSapSourceTypeFromJsonb(dataExpr),
  };
}

/** `<expr> AS <column>` for each derived column, ready to drop into a SELECT list. */
export function latestSpdDerivedSelectList(dataExpr: string, stoNumberExpr: string): string {
  const exprs = latestSpdDerivedExprs(dataExpr, stoNumberExpr);
  return LATEST_SPD_DERIVED_COLUMNS.map((col) => `${exprs[col]} AS ${col}`).join(',\n          ');
}
