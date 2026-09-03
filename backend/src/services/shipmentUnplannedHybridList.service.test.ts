import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildShipmentAllHybridListContext,
  buildShipmentUnplannedHybridListContext,
  isAllHybridListRequest,
  isUnplannedHybridListRequest,
  shouldResolveAllHybridShipmentsList,
  shouldResolveCancelledHybridShipmentsList,
  shouldResolveCompletedHybridShipmentsList,
  shouldSerializeHybridListQuery,
} from './shipmentUnplannedHybridList.service';
import { buildShipmentListEnrichedPageQuery } from './shipmentList.service';

describe('shipmentUnplannedHybridList.service', () => {
  const baseInput = {
    shipmentBaseCteSql: 'WITH shipment_base_core AS (SELECT 1)',
    toolbarOuterSql: " AND sb.vessel_name ILIKE '%test%'",
    innerParams: [] as unknown[],
    toolbarOuterParams: ['%test%'],
    skipSapJoin: true,
    filterCacheKey: 'shipments:test',
    contractScope: { plants: [] as string[] },
    globalSearch: '',
    colFilters: {},
  };

  describe('isAllHybridListRequest', () => {
    it('returns true for ALL and empty status', () => {
      expect(isAllHybridListRequest('ALL')).toBe(true);
      expect(isAllHybridListRequest('')).toBe(true);
      expect(isAllHybridListRequest(undefined)).toBe(true);
    });

    it('returns false for pipeline stage filters', () => {
      expect(isAllHybridListRequest('UNPLANNED')).toBe(false);
      expect(isAllHybridListRequest('PLANNED')).toBe(false);
      expect(isAllHybridListRequest('PREPLANNED')).toBe(false);
    });
  });

  describe('shouldResolveAllHybridShipmentsList', () => {
    it('stays on ALL hybrid for 10-digit PO/STO search so Unplanned backlog remains visible', () => {
      expect(shouldResolveAllHybridShipmentsList('ALL')).toBe(true);
      expect(shouldResolveAllHybridShipmentsList('')).toBe(true);
      expect(shouldResolveAllHybridShipmentsList('UNPLANNED')).toBe(false);
      expect(shouldResolveAllHybridShipmentsList('PLANNED')).toBe(false);
    });

    it('uses execution list path when Pending ATC filter is active', () => {
      expect(shouldResolveAllHybridShipmentsList('ALL', true)).toBe(false);
      expect(shouldResolveAllHybridShipmentsList('ALL', 'true')).toBe(false);
      expect(shouldResolveAllHybridShipmentsList('', 'true')).toBe(false);
    });
  });

  describe('shouldResolveCancelledHybridShipmentsList', () => {
    it('keeps Cancelled hybrid for Cancelled card status', () => {
      expect(shouldResolveCancelledHybridShipmentsList('CANCELLED')).toBe(true);
      expect(shouldResolveCancelledHybridShipmentsList('ALL')).toBe(false);
      expect(shouldResolveCancelledHybridShipmentsList('COMPLETED')).toBe(false);
    });
  });

  describe('shouldResolveCompletedHybridShipmentsList', () => {
    it('keeps Completed hybrid for 10-digit PO/STO search', () => {
      expect(shouldResolveCompletedHybridShipmentsList('COMPLETED')).toBe(true);
      expect(shouldResolveCompletedHybridShipmentsList('ALL')).toBe(false);
    });
  });

  describe('isUnplannedHybridListRequest', () => {
    it('returns true only for UNPLANNED', () => {
      expect(isUnplannedHybridListRequest('UNPLANNED')).toBe(true);
      expect(isUnplannedHybridListRequest('ALL')).toBe(false);
    });
  });

  describe('buildShipmentAllHybridListContext', () => {
    it('uses toolbar-only execution outer SQL without unplanned predicate', () => {
      const ctx = buildShipmentAllHybridListContext(baseInput);
      expect(ctx.shipmentCtx.outerSql).toBe(baseInput.toolbarOuterSql);
      expect(ctx.shipmentCtx.outerSql).not.toContain('is_contract_sap_closed');
      expect(ctx.shipmentCtx.outerSql).not.toContain('eta_arrival');
      expect(ctx.shipmentCtx.cacheKey).toContain(':all-hybrid');
      expect(ctx.shipmentCtx.cacheKey).toContain(':sap=0');
    });

    it('does not share cache between skipSapJoin shell and hydrate so OS/receive/delivery can fill', () => {
      const shell = buildShipmentAllHybridListContext(baseInput);
      const hydrate = buildShipmentAllHybridListContext({ ...baseInput, skipSapJoin: false });
      expect(shell.shipmentCtx.cacheKey).toContain(':sap=0');
      expect(hydrate.shipmentCtx.cacheKey).toContain(':sap=1');
      expect(shell.shipmentCtx.cacheKey).not.toBe(hydrate.shipmentCtx.cacheKey);
    });

    it('serializes hydrate hybrid but not the compact skipSapJoin shell', () => {
      expect(shouldSerializeHybridListQuery(true)).toBe(false);
      expect(shouldSerializeHybridListQuery(false)).toBe(true);
    });

    it('does not share cache across sort keys', () => {
      const created = buildShipmentAllHybridListContext({
        ...baseInput,
        sortKey: 'created_at',
        sortDir: 'DESC',
      });
      const vessel = buildShipmentAllHybridListContext({
        ...baseInput,
        sortKey: 'vessel_name',
        sortDir: 'ASC',
      });
      expect(created.shipmentCtx.cacheKey).not.toBe(vessel.shipmentCtx.cacheKey);
    });

    it('hydrate execution SQL still computes OS, receive, and delivery qty', () => {
      const ctx = buildShipmentAllHybridListContext({ ...baseInput, skipSapJoin: false });
      const q = buildShipmentListEnrichedPageQuery(ctx.shipmentCtx, 20, 0);
      expect(q.text).toMatch(/\bqty_move\b/);
      expect(q.text).toContain('AS outstanding_quantity');
      expect(q.text).toContain('AS quantity_receive');
      expect(q.text).toContain('AS quantity_delivered_sap');
      expect(q.text).toContain('sm.po_sto_count');
    });

    it('shell execution SQL omits qty_move so first paint cannot poison hydrate cache', () => {
      const ctx = buildShipmentAllHybridListContext(baseInput);
      const q = buildShipmentListEnrichedPageQuery(ctx.shipmentCtx, 20, 0);
      expect(q.text).not.toMatch(/\bqty_move\b/);
      expect(q.text).not.toContain('AS outstanding_quantity');
    });

    it('includes unplanned and preplanned contract backlog for ALL hybrid', () => {
      const ctx = buildShipmentAllHybridListContext(baseInput);
      expect(ctx.contractBacklogMode).toBe('all');
    });
  });

  describe('buildShipmentUnplannedHybridListContext', () => {
    it('is PO backlog only (no unplanned execution predicate)', () => {
      const ctx = buildShipmentUnplannedHybridListContext(baseInput);
      expect(ctx.contractBacklogMode).toBe('unplanned');
      expect(ctx.shipmentCtx.outerSql).toBe(baseInput.toolbarOuterSql);
      expect(ctx.shipmentCtx.outerSql).not.toContain('eta_arrival');
      expect(ctx.shipmentCtx.cacheKey).toContain(':unplanned-po-only');
    });

    it('defaults server sort to created_at DESC on shipment context', () => {
      const ctx = buildShipmentUnplannedHybridListContext(baseInput);
      expect(ctx.shipmentCtx.sortKey).toBe('created_at');
      expect(ctx.shipmentCtx.sortDir).toBe('DESC');
    });

    it('passes custom sort to shipment context', () => {
      const ctx = buildShipmentUnplannedHybridListContext({
        ...baseInput,
        sortKey: 'vessel_name',
        sortDir: 'ASC',
        tableStatusFilter: 'UNPLANNED',
      });
      expect(ctx.shipmentCtx.sortKey).toBe('vessel_name');
      expect(ctx.shipmentCtx.sortDir).toBe('ASC');
      expect(ctx.shipmentCtx.tableStatusFilter).toBe('UNPLANNED');
    });
  });

  describe('getShipments ALL/Completed/Cancelled hybrid gates', () => {
    it('does not skip hybrid when 10-digit PO/STO search sets exactStoKey', () => {
      const src = readFileSync(
        join(__dirname, '../controllers/shipment.controller.ts'),
        'utf8',
      );
      expect(src).toContain('if (shouldResolveAllHybridShipmentsList(status, etcNoAtcDueWithin7dParam))');
      expect(src).toContain('if (shouldResolveCompletedHybridShipmentsList(status))');
      expect(src).toContain('if (shouldResolveCancelledHybridShipmentsList(status))');
      expect(src).not.toMatch(/shouldResolveAllHybridShipmentsList\(status\)\s*&&\s*!exactStoKey/);
      expect(src).not.toMatch(/shouldResolveCompletedHybridShipmentsList\(status\)\s*&&\s*!exactStoKey/);
      expect(src).not.toMatch(/shouldResolveCancelledHybridShipmentsList\(status\)\s*&&\s*!exactStoKey/);
      expect(src).not.toMatch(/isAllHybridListRequest\(status\)\s*&&\s*!exactStoKey/);
    });
  });
});
