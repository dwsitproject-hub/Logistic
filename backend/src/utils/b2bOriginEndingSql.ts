/**
 * B2B origin (parent) rows should display the *ending* plant and unload location
 * from the latest child PO (Contract Reff PO Ini → origin PO).
 *
 * Children are excluded from Contracts/Trucking lists, so without this overlay
 * the origin shows the starting mill (e.g. TS10 / TSB TRADING PLANT 1) instead of
 * the destination (e.g. EU23 / EUP EDIBLE OIL TJ.PURA).
 */

export const SQL_SPD_CONTRACT_REFF_PO = (dataExpr: string): string => `NULLIF(TRIM(COALESCE(
  ${dataExpr}->'contract'->>'contract_reference_po',
  ${dataExpr}->>'CONTRACT REFF PO',
  ${dataExpr}->>'Contract Reff PO Ini',
  ${dataExpr}->'raw'->>'Contract Reff PO Ini',
  ${dataExpr}->'raw'->>'CONTRACT REFF PO'
)), '')`;

export const SQL_SPD_TRUCK_DISCHARGE_LOCATION = (dataExpr: string): string => `NULLIF(TRIM(COALESCE(
  ${dataExpr}->'raw'->>'Truck Discharge Location',
  ${dataExpr}->'raw'->>'Truck Unload Location',
  ${dataExpr}->'shipment'->>'truck_discharge_location',
  ${dataExpr}->>'Truck Discharge Location'
)), '')`;

/** Latest B2B child whose Contract Reff PO points at this origin PO. */
export function sqlB2bOriginEndingChildLateralJoin(opts: {
  originPoExpr: string;
  alias?: string;
}): string {
  const alias = opts.alias ?? 'b2b_end';
  return `
    LEFT JOIN LATERAL (
      SELECT
        ch.plant_code,
        ch.company_name,
        COALESCE(
          ${SQL_SPD_TRUCK_DISCHARGE_LOCATION('ch_spd.data')},
          NULLIF(TRIM(ch.buyer), ''),
          NULLIF(TRIM(ch_spd.data->'raw'->>'Buyer'), ''),
          NULLIF(TRIM(ch_spd.data->>'Buyer'), '')
        ) AS unload_location
      FROM contracts ch
      LEFT JOIN LATERAL (
        SELECT spd.data
        FROM sap_processed_data spd
        WHERE spd.contract_number = ch.contract_id
        ORDER BY spd.created_at DESC NULLS LAST
        LIMIT 1
      ) ch_spd ON true
      WHERE NULLIF(TRIM(${opts.originPoExpr}), '') IS NOT NULL
        AND ${SQL_SPD_CONTRACT_REFF_PO('ch_spd.data')} = TRIM(${opts.originPoExpr})
      ORDER BY ch.contract_date DESC NULLS LAST, ch.created_at DESC NULLS LAST
      LIMIT 1
    ) ${alias} ON true`;
}

export function sqlB2bEndingPlantCodeExpr(originPlantExpr: string, alias = 'b2b_end'): string {
  return `COALESCE(NULLIF(TRIM(${alias}.plant_code), ''), ${originPlantExpr})`;
}

export function sqlB2bEndingCompanyExpr(originCompanyExpr: string, alias = 'b2b_end'): string {
  return `COALESCE(NULLIF(TRIM(${alias}.company_name), ''), ${originCompanyExpr})`;
}

export function sqlB2bEndingUnloadExpr(fallbackExpr: string, alias = 'b2b_end'): string {
  return `COALESCE(NULLIF(TRIM(${alias}.unload_location), ''), ${fallbackExpr})`;
}

/** Scalar subquery — latest child Truck Discharge Location / Buyer for an origin PO. */
export function sqlB2bOriginEndingUnloadSubquery(originPoExpr: string): string {
  return `(
    SELECT COALESCE(
      ${SQL_SPD_TRUCK_DISCHARGE_LOCATION('ch_spd.data')},
      NULLIF(TRIM(ch.buyer), ''),
      NULLIF(TRIM(ch_spd.data->'raw'->>'Buyer'), '')
    )
    FROM contracts ch
    LEFT JOIN LATERAL (
      SELECT spd.data
      FROM sap_processed_data spd
      WHERE spd.contract_number = ch.contract_id
      ORDER BY spd.created_at DESC NULLS LAST
      LIMIT 1
    ) ch_spd ON true
    WHERE NULLIF(TRIM(${originPoExpr}), '') IS NOT NULL
      AND ${SQL_SPD_CONTRACT_REFF_PO('ch_spd.data')} = TRIM(${originPoExpr})
    ORDER BY ch.contract_date DESC NULLS LAST, ch.created_at DESC NULLS LAST
    LIMIT 1
  )`;
}

/** Aggregated plant_code for GROUP BY contract_id queries that join b2b_end. */
export function sqlB2bEndingPlantCodeAgg(originPlantExpr = 'c.plant_code', alias = 'b2b_end'): string {
  return `MAX(${sqlB2bEndingPlantCodeExpr(originPlantExpr, alias)})`;
}
