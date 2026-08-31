import { query } from '../database/connection';
import { buildShipmentListPageQuery } from '../services/shipmentList.service';
import {
  buildRankedStoCtes,
  buildShipmentShellEnrichWithStoLinkAgg,
  injectShipmentStoKeyPaging,
  SHIPMENT_BASE_CORE_GROUP_BY_MARKER,
} from '../utils/shipmentListStoPaging';
import { buildShipmentPageSeaIncotermScopeSql } from '../utils/shipmentIncotermScope';
import { sqlShipmentListB2bOriginContractJoins } from '../utils/shipmentB2bOriginSql';
import { shipmentListStoKeyExpr } from '../utils/shipmentStoTypeSql';

async function main(): Promise<void> {
  const listStoKeySql = shipmentListStoKeyExpr('c', 'l', 's');
  const coreWhereSql = `c.contract_date >= $1 AND c.contract_date <= $2`;
  const seaIncoterm = buildShipmentPageSeaIncotermScopeSql('c');

  const prelude = `WITH vlp_load_first AS (SELECT NULL::uuid AS shipment_id WHERE false),
      vlp_disc_first AS (SELECT NULL::uuid AS shipment_id WHERE false),
      relevant_contract_numbers AS (
        SELECT DISTINCT c.contract_id
        FROM shipments s
        INNER JOIN contracts c ON s.contract_id = c.id
        WHERE ${seaIncoterm} AND ${coreWhereSql}
      ),
      latest_spd_contract AS (
        SELECT DISTINCT ON (spd.contract_number)
          spd.contract_number,
          NULL::text AS effective_sto,
          NULL::text AS b2b_flag_raw,
          NULL::text AS contract_reference_po_raw,
          NULL::text AS contract_ext_no_raw,
          spd.created_at
        FROM sap_processed_data spd
        INNER JOIN relevant_contract_numbers rc ON rc.contract_id = spd.contract_number
        WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
        ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
      ),
      shipment_base_core AS (
        SELECT ${listStoKeySql} AS sto_key,
          MAX(s.created_at) AS created_at,
          STRING_AGG(DISTINCT c.contract_id, ', ') AS contract_numbers_from_join,
          STRING_AGG(DISTINCT c.po_number, ', ') AS po_numbers_from_join,
          COUNT(DISTINCT c.contract_id) AS contract_count_from_join,
          NULL::text AS contract_ext_no_from_join,
          NULL::text AS suppliers
        FROM shipments s
        ${sqlShipmentListB2bOriginContractJoins()}
        WHERE 1=1 AND (${seaIncoterm}) AND (${coreWhereSql})
        ${SHIPMENT_BASE_CORE_GROUP_BY_MARKER} GROUP BY ${listStoKeySql}
      )`;

  const shellEnrich = buildShipmentShellEnrichWithStoLinkAgg();
  const pagingBase = `${prelude}${shellEnrich}`;
  const ranked = buildRankedStoCtes(listStoKeySql, `${seaIncoterm} AND ${coreWhereSql}`)
    .replace('__STO_PAGE_LIMIT__', '20')
    .replace('__STO_PAGE_OFFSET__', '0');
  const injected = injectShipmentStoKeyPaging(pagingBase, listStoKeySql, ranked);
  if (!injected) {
    console.error('inject failed');
    process.exit(1);
  }

  const ctx = {
    shipmentBaseCteSql: injected,
    outerSql: '',
    innerParams: ['2026-01-01', '2026-07-09'],
    outerParams: [] as unknown[],
    skipSapJoin: true,
    cacheKey: 'debug',
    filterCacheKey: 'debug',
    usesStoKeyPaging: true,
  };

  const page = buildShipmentListPageQuery(ctx, 20, 0);
  console.log('SQL length', page.text.length);
  const res = await query(page.text, page.params);
  console.log('rows', res.rowCount);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
