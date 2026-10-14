/**
 * The products the Shipments page's Product filter may offer.
 *
 * The filter used /dashboard/filter-options/products: DISTINCT product over EVERY contract, so it listed the trucking-only products (HYDRO, GULA, PKFAD, PA85% ...) that no
 * Shipments row can ever carry - a user could pick one and get an empty table (33 products offered, 16 in the page's scope, measured on a production copy).
 *
 * The scope is the page's own contract scope, not a reading of the data: the Shipments incoterms (CIF / FOB / CFR, by the contract's EFFECTIVE incoterm, which falls back to the
 * SAP row), a contract SAP still carries, and not a B2B child contract - the same three conditions the page puts on a contract (shipmentPagePipelineSql.ts, the Unplanned card).
 * It does NOT depend on the other filters (period, region, status): the page holds one page of rows from the server, so the other filters cannot be applied here without running the
 * list query. A product that is in scope but has nothing in the chosen period is still offered.
 */
import { buildShipmentPageSeaIncotermScopeSql } from './shipmentIncotermScope';
import { shipmentPageExcludeB2bChildCond } from './shipmentPagePipelineSql';

/** The page's own contract scope as conditions on `c` (contracts) and `l` (contract_latest_spd_snapshot): shared by every Shipments filter-options query. */
export function shipmentPageOptionsScopeSql(): string {
  return `COALESCE(c.sap_presence, 'PRESENT') = 'PRESENT'
      AND ${buildShipmentPageSeaIncotermScopeSql('c')}
      AND ${shipmentPageExcludeB2bChildCond('l')}`;
}

export function buildShipmentProductOptionsSql(): string {
  return `
    SELECT DISTINCT TRIM(c.product) AS product
    FROM contracts c
    LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
    WHERE NULLIF(TRIM(c.product), '') IS NOT NULL
      AND ${shipmentPageOptionsScopeSql()}
    ORDER BY product`;
}

/** Every product of every contract: what the filter offered before, kept for a caller that asks for no scope. */
export const ALL_CONTRACT_PRODUCT_OPTIONS_SQL = `
    SELECT DISTINCT TRIM(c.product) AS product
    FROM contracts c
    WHERE NULLIF(TRIM(c.product), '') IS NOT NULL
    ORDER BY product`;
