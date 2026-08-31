import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AuthRequest } from '../middleware/auth';
import {
  buildTruckingAllHybridContext,
  buildTruckingHybridExecutionCountQuery,
  buildTruckingUnplannedHybridContext,
  isTruckingAllHybridListRequest,
  isTruckingUnplannedHybridListRequest,
  shouldResolveAllHybridTruckingList,
  truckingHybridExecutionStageFilter,
} from './truckingUnplannedHybridList.service';

describe('truckingUnplannedHybridList.service', () => {
  describe('isTruckingAllHybridListRequest', () => {
    it('returns true for ALL and empty status', () => {
      expect(isTruckingAllHybridListRequest('ALL')).toBe(true);
      expect(isTruckingAllHybridListRequest('')).toBe(true);
      expect(isTruckingAllHybridListRequest(undefined)).toBe(true);
    });

    it('returns false for pipeline stage filters', () => {
      expect(isTruckingAllHybridListRequest('UNPLANNED')).toBe(false);
      expect(isTruckingAllHybridListRequest('PLANNED')).toBe(false);
      expect(isTruckingAllHybridListRequest('COMPLETED')).toBe(false);
    });
  });

  describe('shouldResolveAllHybridTruckingList', () => {
    it('stays on ALL hybrid for 10-digit PO search so Unplanned backlog remains visible', () => {
      expect(shouldResolveAllHybridTruckingList('ALL')).toBe(true);
      expect(shouldResolveAllHybridTruckingList('')).toBe(true);
      expect(shouldResolveAllHybridTruckingList('UNPLANNED')).toBe(false);
      expect(shouldResolveAllHybridTruckingList('PLANNED')).toBe(false);
    });
  });

  describe('isTruckingUnplannedHybridListRequest', () => {
    it('returns true only for UNPLANNED', () => {
      expect(isTruckingUnplannedHybridListRequest('UNPLANNED')).toBe(true);
      expect(isTruckingUnplannedHybridListRequest('ALL')).toBe(false);
    });
  });

  describe('truckingHybridExecutionStageFilter', () => {
    it('filters UNPLANNED ops on Unplanned tab only', () => {
      expect(truckingHybridExecutionStageFilter('unplanned')).toBe('UNPLANNED');
      expect(truckingHybridExecutionStageFilter('all')).toBeUndefined();
    });
  });

  describe('buildTruckingAllHybridContext', () => {
    const shellReq = {
      query: { skipSapJoin: 'true', search: '9181000090' },
    } as unknown as AuthRequest;
    const hydrateReq = {
      query: { skipSapJoin: 'false', search: '9181000090' },
    } as unknown as AuthRequest;

    it('marks mode all and keeps 10-digit PO search on the backlog stream', () => {
      const ctx = buildTruckingAllHybridContext(shellReq, 'supplier', 'ASC');
      expect(ctx.mode).toBe('all');
      expect(ctx.globalSearch).toBe('9181000090');
      expect(ctx.executionBuilt.cacheKey).toContain(':all-hybrid');
      expect(ctx.executionBuilt.cacheKey).toContain(':sap=0');
    });

    it('does not share cache between skipSapJoin shell and hydrate', () => {
      const shell = buildTruckingAllHybridContext(shellReq, 'supplier', 'ASC');
      const hydrate = buildTruckingAllHybridContext(hydrateReq, 'supplier', 'ASC');
      expect(shell.executionBuilt.cacheKey).toContain(':sap=0');
      expect(hydrate.executionBuilt.cacheKey).toContain(':sap=1');
      expect(shell.executionBuilt.cacheKey).not.toBe(hydrate.executionBuilt.cacheKey);
    });

    it('does not share cache across sort keys', () => {
      const supplier = buildTruckingAllHybridContext(shellReq, 'supplier', 'ASC');
      const created = buildTruckingAllHybridContext(shellReq, 'created_at', 'DESC');
      expect(supplier.executionBuilt.cacheKey).not.toBe(created.executionBuilt.cacheKey);
    });

    it('All execution count is not restricted to UNPLANNED status', () => {
      const ctx = buildTruckingAllHybridContext(shellReq, 'supplier', 'ASC');
      const q = buildTruckingHybridExecutionCountQuery(ctx);
      expect(q.text).toContain('expansion_keys');
      expect(q.text).not.toMatch(/WHERE tf\.status =/);
      expect(q.params).not.toContain('UNPLANNED');
    });
  });

  describe('buildTruckingUnplannedHybridContext', () => {
    it('still counts only UNPLANNED execution rows', () => {
      const req = { query: { skipSapJoin: 'true', status: 'UNPLANNED' } } as unknown as AuthRequest;
      const ctx = buildTruckingUnplannedHybridContext(req, 'supplier', 'ASC');
      expect(ctx.mode).toBe('unplanned');
      const q = buildTruckingHybridExecutionCountQuery(ctx);
      expect(q.text).toMatch(/WHERE tf\.status =/);
      expect(q.params).toContain('UNPLANNED');
    });
  });

  describe('truckingList All hybrid wiring', () => {
    it('routes ALL through hybrid and does not drop hybrid for PO search', () => {
      const src = readFileSync(join(__dirname, 'truckingList.service.ts'), 'utf8');
      expect(src).toContain('buildTruckingAllHybridContext');
      expect(src).toContain('isAllHybrid');
      expect(src).not.toMatch(/isAllHybrid\s*&&\s*!.*[Ss]earch/);
    });

    it('ALL list uses origin plant like Unplanned / status cards', () => {
      const src = readFileSync(join(__dirname, 'truckingList.service.ts'), 'utf8');
      expect(src).not.toMatch(
        /statusScopedList \|\| isUnplannedHybrid \? \{ originGroupPlant: true \}/,
      );
      const builtIdx = src.indexOf('const built = buildTruckingListQuery');
      expect(builtIdx).toBeGreaterThan(0);
      expect(src.slice(builtIdx, builtIdx + 400)).toContain('originGroupPlant: true');
    });
  });
});
