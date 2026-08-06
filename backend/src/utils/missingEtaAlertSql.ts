import { query } from '../database/connection';
import { SQL_CONTRACT_IMPORT_STATUS, sqlContractImportStatusIsOpenExpr } from './contractDeliveryStatus';
import { groupPlantExpr } from './groupPlantSql';
import { shippingPerfOperationalStoKeyExpr } from './shippingPerformanceStoSql';

/** One badge/popover row — may be contract-level or per shipment STO / trucking operation. */
export interface MissingEtaAlertUnitRow {
  unit_key: string;
  contract_id: string;
  contract_ext_no: string | null;
  po_number: string | null;
  sto_number: string | null;
  operation_id: string | null;
  supplier: string | null;
  product: string | null;
  incoterm: string | null;
  transport_mode: string | null;
  missing_leg: 'Shipment' | 'Trucking';
  cargo_readiness_date: string;
  days_to_cargo_readiness: number;
  group_plant: string;
}

const SHIPMENT_LOADING_ETA_MISSING = `(s.eta_arrival IS NULL
  AND s.eta_berthed IS NULL
  AND s.eta_loading_start IS NULL
  AND s.eta_loading_complete IS NULL
  AND s.eta_sailed IS NULL)`;

const TRUCKING_ETA_MISSING = `(t.eta_delivery_start_date IS NULL
  AND t.eta_delivery_end_date IS NULL
  AND t.eta_trucking_start_date IS NULL
  AND t.eta_trucking_completion_date IS NULL)`;

const GROUP_PLANT = groupPlantExpr('c.plant_code', 'c.company_name');
const STO_KEY = shippingPerfOperationalStoKeyExpr('c', 's');

/** Cargo readiness window (days ahead) for Missing Planning bell + daily email reminder. */
export const MISSING_ETA_ALERT_CARGO_READINESS_WINDOW_DAYS = 14;

/**
 * Build SQL returning alert units for open contracts with cargo readiness within
 * {@link MISSING_ETA_ALERT_CARGO_READINESS_WINDOW_DAYS} days and missing SEA loading ETA
 * (per shipment/STO when shipments exist) and/or missing LAND trucking planning ETA
 * (per operation when ops exist).
 *
 * `scopeSql` is appended to the candidates WHERE (e.g. staff plant/product/transport filters).
 */
export function buildMissingEtaAlertUnitsSql(
  scopeSql: string,
  scopeParams: unknown[],
  limit: number,
): { text: string; values: unknown[] } {
  const limitParam = scopeParams.length + 1;
  const text = `
    WITH candidates AS (
      SELECT
        c.id AS contract_uuid,
        c.contract_id,
        (
          SELECT COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No')
          FROM sap_processed_data spd
          WHERE spd.contract_number = c.contract_id
          ORDER BY spd.created_at DESC NULLS LAST
          LIMIT 1
        ) AS contract_ext_no,
        c.po_number,
        c.supplier,
        c.product,
        c.incoterm,
        c.transport_mode,
        TO_CHAR(c.cargo_readiness_date, 'YYYY-MM-DD') AS cargo_readiness_date,
        (c.cargo_readiness_date - CURRENT_DATE)::int AS days_to_cargo_readiness,
        ${GROUP_PLANT} AS group_plant
      FROM contracts c
      WHERE c.cargo_readiness_date IS NOT NULL
        AND c.cargo_readiness_date <= CURRENT_DATE + INTERVAL '${MISSING_ETA_ALERT_CARGO_READINESS_WINDOW_DAYS} days'
        AND ${sqlContractImportStatusIsOpenExpr(SQL_CONTRACT_IMPORT_STATUS)}
        ${scopeSql}
    ),
    sea_shipment_units AS (
      SELECT
        cand.contract_id || '::sea::' || COALESCE(${STO_KEY}, s.id::text) AS unit_key,
        cand.contract_id,
        cand.contract_ext_no,
        cand.po_number,
        ${STO_KEY} AS sto_number,
        NULL::text AS operation_id,
        cand.supplier,
        cand.product,
        cand.incoterm,
        cand.transport_mode,
        'Shipment'::text AS missing_leg,
        cand.cargo_readiness_date,
        cand.days_to_cargo_readiness,
        cand.group_plant
      FROM candidates cand
      INNER JOIN contracts c ON c.id = cand.contract_uuid
      INNER JOIN shipments s ON s.contract_id = c.id
      WHERE (
        UPPER(TRIM(cand.transport_mode)) LIKE 'SEA%'
        OR UPPER(TRIM(cand.transport_mode)) LIKE 'MIX%'
      )
        AND ${SHIPMENT_LOADING_ETA_MISSING}
    ),
    sea_contract_units AS (
      SELECT
        cand.contract_id || '::sea::contract' AS unit_key,
        cand.contract_id,
        cand.contract_ext_no,
        cand.po_number,
        NULL::text AS sto_number,
        NULL::text AS operation_id,
        cand.supplier,
        cand.product,
        cand.incoterm,
        cand.transport_mode,
        'Shipment'::text AS missing_leg,
        cand.cargo_readiness_date,
        cand.days_to_cargo_readiness,
        cand.group_plant
      FROM candidates cand
      WHERE (
        UPPER(TRIM(cand.transport_mode)) LIKE 'SEA%'
        OR UPPER(TRIM(cand.transport_mode)) LIKE 'MIX%'
      )
        AND NOT EXISTS (
          SELECT 1 FROM shipments s0 WHERE s0.contract_id = cand.contract_uuid
        )
    ),
    land_trucking_units AS (
      SELECT
        cand.contract_id || '::land::' || COALESCE(NULLIF(TRIM(t.operation_id::text), ''), t.id::text) AS unit_key,
        cand.contract_id,
        cand.contract_ext_no,
        cand.po_number,
        NULL::text AS sto_number,
        NULLIF(TRIM(t.operation_id::text), '') AS operation_id,
        cand.supplier,
        cand.product,
        cand.incoterm,
        cand.transport_mode,
        'Trucking'::text AS missing_leg,
        cand.cargo_readiness_date,
        cand.days_to_cargo_readiness,
        cand.group_plant
      FROM candidates cand
      INNER JOIN trucking_operations t ON t.contract_id = cand.contract_uuid
      WHERE (
        UPPER(TRIM(cand.transport_mode)) LIKE 'LAND%'
        OR UPPER(TRIM(cand.transport_mode)) LIKE 'MIX%'
      )
        AND COALESCE(t.status, '') <> 'CANCELLED'
        AND ${TRUCKING_ETA_MISSING}
    ),
    land_contract_units AS (
      SELECT
        cand.contract_id || '::land::contract' AS unit_key,
        cand.contract_id,
        cand.contract_ext_no,
        cand.po_number,
        NULL::text AS sto_number,
        NULL::text AS operation_id,
        cand.supplier,
        cand.product,
        cand.incoterm,
        cand.transport_mode,
        'Trucking'::text AS missing_leg,
        cand.cargo_readiness_date,
        cand.days_to_cargo_readiness,
        cand.group_plant
      FROM candidates cand
      WHERE (
        UPPER(TRIM(cand.transport_mode)) LIKE 'LAND%'
        OR UPPER(TRIM(cand.transport_mode)) LIKE 'MIX%'
      )
        AND NOT EXISTS (
          SELECT 1 FROM trucking_operations t0
          WHERE t0.contract_id = cand.contract_uuid
            AND COALESCE(t0.status, '') <> 'CANCELLED'
        )
    ),
    all_units AS (
      SELECT * FROM sea_shipment_units
      UNION ALL
      SELECT * FROM sea_contract_units
      UNION ALL
      SELECT * FROM land_trucking_units
      UNION ALL
      SELECT * FROM land_contract_units
    )
    SELECT
      unit_key,
      contract_id,
      contract_ext_no,
      po_number,
      sto_number,
      operation_id,
      supplier,
      product,
      incoterm,
      transport_mode,
      missing_leg,
      cargo_readiness_date,
      days_to_cargo_readiness,
      group_plant,
      (SELECT COUNT(*)::int FROM all_units) AS total_count
    FROM all_units
    ORDER BY days_to_cargo_readiness ASC, contract_id ASC, missing_leg ASC, unit_key ASC
    LIMIT $${limitParam}::int
  `;
  return { text, values: [...scopeParams, limit] };
}

export async function findMissingEtaAlertUnits(
  scopeSql: string,
  scopeParams: unknown[],
  limit = 50,
): Promise<{ total: number; items: MissingEtaAlertUnitRow[] }> {
  const { text, values } = buildMissingEtaAlertUnitsSql(scopeSql, scopeParams, limit);
  const result = await query(text, values);
  const rows = result.rows as Array<MissingEtaAlertUnitRow & { total_count: number }>;
  const total = rows.length > 0 ? Number(rows[0]?.total_count ?? 0) : 0;
  const items: MissingEtaAlertUnitRow[] = rows.map(({ total_count: _tc, ...row }) => ({
    ...row,
    days_to_cargo_readiness: Number(row.days_to_cargo_readiness),
  }));
  return { total, items };
}

/** Contract-level rows for the daily email job (unchanged semantics). */
export function buildContractsMissingEtaNearCargoReadinessSql(): string {
  return `
    WITH candidates AS (
      SELECT
        c.id,
        c.contract_id,
        (
          SELECT COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No')
          FROM sap_processed_data spd
          WHERE spd.contract_number = c.contract_id
          ORDER BY spd.created_at DESC NULLS LAST
          LIMIT 1
        ) AS contract_ext_no,
        c.po_number,
        c.supplier,
        c.product,
        c.incoterm,
        c.transport_mode,
        TO_CHAR(c.cargo_readiness_date, 'YYYY-MM-DD') AS cargo_readiness_date,
        (c.cargo_readiness_date - CURRENT_DATE) AS days_to_cargo_readiness,
        NOT EXISTS (
          SELECT 1 FROM shipments s
          WHERE s.contract_id = c.id
            AND (
              s.eta_arrival IS NOT NULL
              OR s.eta_berthed IS NOT NULL
              OR s.eta_loading_start IS NOT NULL
              OR s.eta_loading_complete IS NOT NULL
              OR s.eta_sailed IS NOT NULL
            )
        ) AS sea_missing_eta,
        NOT EXISTS (
          SELECT 1 FROM trucking_operations t
          WHERE t.contract_id = c.id
            AND (
              t.eta_delivery_start_date IS NOT NULL
              OR t.eta_delivery_end_date IS NOT NULL
              OR t.eta_trucking_start_date IS NOT NULL
              OR t.eta_trucking_completion_date IS NOT NULL
            )
        ) AS land_missing_eta
      FROM contracts c
      WHERE c.cargo_readiness_date IS NOT NULL
        AND c.cargo_readiness_date <= CURRENT_DATE + INTERVAL '${MISSING_ETA_ALERT_CARGO_READINESS_WINDOW_DAYS} days'
        AND ${sqlContractImportStatusIsOpenExpr(SQL_CONTRACT_IMPORT_STATUS)}
    )
    SELECT
      contract_id,
      contract_ext_no,
      po_number,
      supplier,
      product,
      incoterm,
      transport_mode,
      cargo_readiness_date,
      days_to_cargo_readiness,
      sea_missing_eta,
      land_missing_eta
    FROM candidates
    WHERE (UPPER(TRIM(transport_mode)) LIKE 'SEA%' AND sea_missing_eta)
       OR (UPPER(TRIM(transport_mode)) LIKE 'LAND%' AND land_missing_eta)
       OR (UPPER(TRIM(transport_mode)) LIKE 'MIX%' AND (sea_missing_eta OR land_missing_eta))
    ORDER BY cargo_readiness_date ASC
  `;
}
