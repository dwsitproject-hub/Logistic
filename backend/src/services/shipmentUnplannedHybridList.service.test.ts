import { describe, expect, it } from 'vitest';
import {
  buildShipmentAllHybridListContext,
  buildShipmentUnplannedHybridListContext,
  isAllHybridListRequest,
  isUnplannedHybridListRequest,
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
    it('adds unplanned execution predicate to toolbar outer SQL', () => {
      const ctx = buildShipmentUnplannedHybridListContext(baseInput);
      expect(ctx.shipmentCtx.outerSql).toContain('is_contract_sap_closed');
      expect(ctx.shipmentCtx.outerSql).toContain('eta_arrival');
      expect(ctx.shipmentCtx.cacheKey).toContain(':unplanned-hybrid');
      expect(ctx.shipmentCtx.outerSql).not.toBe(baseInput.toolbarOuterSql);
    });
  });
});
