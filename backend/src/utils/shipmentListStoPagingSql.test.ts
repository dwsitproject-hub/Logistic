import { describe, expect, it } from 'vitest';
import { buildShipmentListPageQuery } from '../services/shipmentList.service';
import {
  buildRankedStoCtes,
  buildShipmentShellEnrichWithStoLinkAgg,
  injectShipmentStoKeyPaging,
  SHIPMENT_BASE_CORE_GROUP_BY_MARKER,
} from './shipmentListStoPaging';
import { buildShipmentPageSeaIncotermScopeSql } from './shipmentIncotermScope';
import { shipmentListStoKeyExpr } from './shipmentStoTypeSql';

function buildStoPagingListSql(): string {
  const listStoKeySql = shipmentListStoKeyExpr('c', 'l', 's');
  const seaIncoterm = buildShipmentPageSeaIncotermScopeSql('c');
  const coreWhereSql = `${seaIncoterm} AND c.contract_date >= $1 AND c.contract_date <= $2`;

  const prelude = `WITH latest_spd_contract AS (SELECT NULL::text AS contract_number WHERE false),
      shipment_base_core AS (
        SELECT ${listStoKeySql} AS sto_key
        FROM shipments s
        LEFT JOIN contracts c ON s.contract_id = c.id
        LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
        WHERE 1=1 AND (${coreWhereSql})
        ${SHIPMENT_BASE_CORE_GROUP_BY_MARKER} GROUP BY ${listStoKeySql}
      )`;

  const ranked = buildRankedStoCtes(listStoKeySql, coreWhereSql)
    .replace('__STO_PAGE_LIMIT__', '20')
    .replace('__STO_PAGE_OFFSET__', '0');
  const injected = injectShipmentStoKeyPaging(
    `${prelude}${buildShipmentShellEnrichWithStoLinkAgg()}`,
    listStoKeySql,
    ranked,
  );
  if (!injected) throw new Error('inject failed');

  return buildShipmentListPageQuery(
    {
      shipmentBaseCteSql: injected,
      outerSql: '',
      innerParams: ['2026-01-01', '2026-07-09'],
      outerParams: [],
      skipSapJoin: true,
      cacheKey: 'test',
      filterCacheKey: 'test-filter',
      usesStoKeyPaging: true,
    },
    20,
    0,
  ).text;
}

describe('shipmentListStoPaging SQL shape', () => {
  it('does not corrupt numeric-shipment regex when injecting paged filter', () => {
    const sql = buildStoPagingListSql();
    expect(sql).toContain("'^[0-9]+$'");
    expect(sql).not.toContain("'^[0-9]+ GROUP BY");
  });

  it('injected SQL uses sto_link_agg enrich and ranked_sto total', () => {
    const sql = buildStoPagingListSql();
    expect(sql).toContain('sto_link_agg AS');
    expect(sql).toContain('LEFT JOIN sto_link_agg sla');
    expect(sql).toContain('FROM ranked_sto) AS __filter_total');
    expect(sql).toContain("IN ('CIF', 'FOB', 'CFR')");
    expect(sql).not.toMatch(/NOT\s*\([^)]*= 'T'\)/);
    expect(sql).not.toMatch(/\bqty_move\b/);
    expect(sql).not.toMatch(/LEFT JOIN sto_metrics\b/);
  });
});
