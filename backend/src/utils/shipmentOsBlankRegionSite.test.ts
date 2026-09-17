import { describe, expect, it } from 'vitest';
import { sqlContractHasResolvedRegionSiteExpr } from './regionSiteSql';
import {
  buildShipmentOutstandingQtyBacklogAggregateQuery,
  sqlShipmentExecutionOsPerContractCtes,
} from './shipmentOutstandingQtySummarySql';

describe('blank Region/Site is excluded from the Shipments OS total', () => {
  /*
   * Contract Performance counts only contracts that resolve to a real Region/Site, and it is the
   * agreed shared reference. Shipments counted two contracts it drops - 1004028041 (117 MT) and
   * 1004032347 (1,000 MT) - so the OS cards could not agree with it.
   *
   * The rows themselves stay on the page and in the Unplanned / Preplanned counts, which is why
   * this lives in the OS aggregates rather than in backlog_contract_ids.
   */
  it('reads Region/Site from the SAP discharge destination, not the plant code', () => {
    /*
     * The first attempt used groupPlantExpr, which also falls back to the literal 'Blank' and so
     * looks interchangeable. Measured, it removed 14,700 MT of real work while leaving both target
     * contracts counted. Region/Site is the discharge destination.
     */
    const expr = sqlContractHasResolvedRegionSiteExpr('c.contract_id', 'c.po_number');
    expect(expr).toContain("NOT IN ('', 'BLANK')");
    expect(expr).not.toContain('master_plants');
  });

  it('filters the backlog arm', async () => {
    const sql = await buildShipmentOutstandingQtyBacklogAggregateQuery('', '');
    expect(sql).toContain(sqlContractHasResolvedRegionSiteExpr('c.contract_id', 'c.po_number'));
  });

  it('filters the execution arm only when the OS asks for it', () => {
    // The ETC-without-ATC view shares these CTEs to find rows needing attention; a blank site is
    // no reason to hide one of those.
    expect(sqlShipmentExecutionOsPerContractCtes('enriched', { requireResolvedRegionSite: true }))
      .toContain('c_rs.contract_id');
    expect(sqlShipmentExecutionOsPerContractCtes('enriched')).not.toContain('c_rs.contract_id');
  });
});
