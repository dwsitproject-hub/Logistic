import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildShipmentAllHybridListContext,
  buildShipmentUnplannedHybridListContext,
  isAllHybridListRequest,
  isUnplannedHybridListRequest,
  shouldResolveAllHybridShipmentsList,
  shouldResolveCompletedHybridShipmentsList,
} from './shipmentUnplannedHybridList.service';

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

  describe('getShipments ALL/Completed hybrid gates', () => {
    it('does not skip hybrid when 10-digit PO/STO search sets exactStoKey', () => {
      const src = readFileSync(
        join(__dirname, '../controllers/shipment.controller.ts'),
        'utf8',
      );
      expect(src).toContain('if (shouldResolveAllHybridShipmentsList(status))');
      expect(src).toContain('if (shouldResolveCompletedHybridShipmentsList(status))');
      expect(src).not.toMatch(/shouldResolveAllHybridShipmentsList\(status\)\s*&&\s*!exactStoKey/);
      expect(src).not.toMatch(/shouldResolveCompletedHybridShipmentsList\(status\)\s*&&\s*!exactStoKey/);
      expect(src).not.toMatch(/isAllHybridListRequest\(status\)\s*&&\s*!exactStoKey/);
    });
  });
});
