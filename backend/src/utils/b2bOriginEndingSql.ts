/**
 * B2B origin (parent) rows should display the *ending* plant, buyer, and unload
 * location from the latest child PO (Contract Reff PO Ini → origin PO).
 *
 * Children are excluded from Contracts/Trucking lists, so without this overlay
 * the origin shows the starting mill (e.g. TS10 / TSB TRADING PLANT 1) instead of
 * the destination (e.g. EU23 / EUP EDIBLE OIL TJ.PURA).
 *
 * Buyer is the child's SAP Buyer / contracts.buyer — not Truck Discharge Location.
 *
 * List overlay is a PK lookup on b2b_ending_child_snapshot (refreshed on SAP
 * import / startup). Building the origin_po map inline per list query still
 * scanned sap_processed_data JSON and kept those pages slower than before.
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

export const SQL_SPD_BUYER = (dataExpr: string): string => `NULLIF(TRIM(COALESCE(
  ${dataExpr}->'raw'->>'Buyer',
  ${dataExpr}->>'Buyer'
)), '')`;

const SQL_CHILD_BUYER = `COALESCE(
  NULLIF(TRIM(ch.buyer), ''),
  ${SQL_SPD_BUYER('ch_spd.data')}
)`;

/** One sap_processed_data pass: latest row per child that has Contract Reff PO. */
const SQL_B2B_CHILD_LATEST_SPD = `
        INNER JOIN (
          SELECT DISTINCT ON (spd.contract_number)
            spd.contract_number,
            spd.data
          FROM sap_processed_data spd
          WHERE spd.contract_number IS NOT NULL
            AND TRIM(spd.contract_number) != ''
            AND ${SQL_SPD_CONTRACT_REFF_PO('spd.data')} IS NOT NULL
          ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
        ) ch_spd ON ch_spd.contract_number = ch.contract_id`;

/** origin_po → latest child plant / company / buyer / unload (computed once, then hashed). */
export function sqlB2bEndingChildMapSelect(): string {
  return `
      SELECT DISTINCT ON (origin_po)
        origin_po,
        plant_code,
        company_name,
        buyer,
        unload_location
      FROM (
        SELECT
          ${SQL_SPD_CONTRACT_REFF_PO('ch_spd.data')} AS origin_po,
          ch.plant_code,
          COALESCE(
            NULLIF(TRIM(ch.company_name), ''),
            ${SQL_CHILD_BUYER}
          ) AS company_name,
          ${SQL_CHILD_BUYER} AS buyer,
          COALESCE(
            ${SQL_SPD_TRUCK_DISCHARGE_LOCATION('ch_spd.data')},
            ${SQL_CHILD_BUYER}
          ) AS unload_location,
          ch.contract_date,
          ch.created_at
        FROM contracts ch
        ${SQL_B2B_CHILD_LATEST_SPD}
        WHERE ${SQL_SPD_CONTRACT_REFF_PO('ch_spd.data')} IS NOT NULL
      ) b2b_child_src
      ORDER BY origin_po, contract_date DESC NULLS LAST, created_at DESC NULLS LAST`;
}

/**
 * Hash-join overlay for an origin PO. Reads pre-computed snapshot (PK lookup).
 * Snapshot is refreshed on SAP import / backend startup — not rebuilt per list query.
 */
export const B2B_ENDING_CHILD_SNAPSHOT_TABLE = 'b2b_ending_child_snapshot';

export function sqlB2bOriginEndingChildLateralJoin(opts: {
  originPoExpr: string;
  alias?: string;
}): string {
  const alias = opts.alias ?? 'b2b_end';
  return `
    LEFT JOIN ${B2B_ENDING_CHILD_SNAPSHOT_TABLE} ${alias}
      ON ${alias}.origin_po = NULLIF(TRIM(${opts.originPoExpr}), '')`;
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

export function sqlB2bEndingBuyerExpr(originBuyerExpr: string, alias = 'b2b_end'): string {
  return `COALESCE(NULLIF(TRIM(${alias}.buyer), ''), ${originBuyerExpr})`;
}

/** Scalar lookup against the snapshot PK (not a sap_processed_data scan). */
export function sqlB2bOriginEndingUnloadSubquery(originPoExpr: string): string {
  return `(
    SELECT m.unload_location
    FROM ${B2B_ENDING_CHILD_SNAPSHOT_TABLE} m
    WHERE m.origin_po = NULLIF(TRIM(${originPoExpr}), '')
    LIMIT 1
  )`;
}

export function buildB2bEndingChildSnapshotRefreshSql(): string {
  return `
    INSERT INTO ${B2B_ENDING_CHILD_SNAPSHOT_TABLE} (
      origin_po,
      plant_code,
      company_name,
      buyer,
      unload_location,
      refreshed_at
    )
    SELECT
      origin_po,
      plant_code,
      company_name,
      buyer,
      unload_location,
      NOW()
    FROM (
      ${sqlB2bEndingChildMapSelect()}
    ) src
    WHERE origin_po IS NOT NULL AND TRIM(origin_po) != ''`;
}

/** Aggregated plant_code for GROUP BY contract_id queries that join b2b_end. */
export function sqlB2bEndingPlantCodeAgg(originPlantExpr = 'c.plant_code', alias = 'b2b_end'): string {
  return `MAX(${sqlB2bEndingPlantCodeExpr(originPlantExpr, alias)})`;
}

export function sqlB2bEndingBuyerAgg(originBuyerExpr = 'c.buyer', alias = 'b2b_end'): string {
  return `MAX(${sqlB2bEndingBuyerExpr(originBuyerExpr, alias)})`;
}

export function sqlB2bEndingCompanyAgg(originCompanyExpr = 'c.company_name', alias = 'b2b_end'): string {
  return `MAX(${sqlB2bEndingCompanyExpr(originCompanyExpr, alias)})`;
}
