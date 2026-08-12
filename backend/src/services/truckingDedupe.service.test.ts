import { describe, expect, it } from 'vitest';
import {
  sqlTruckingOpExcludeDedupedSql,
  sqlTruckingOpIsActiveForMatchingSql,
  truckingListExcludeDedupedWhereSql,
} from '../utils/truckingOperationUniqueness';

describe('truckingOperationUniqueness dedupe visibility', () => {
  it('sqlTruckingOpExcludeDedupedSql checks deduped_at', () => {
    expect(sqlTruckingOpExcludeDedupedSql('t')).toBe('t.deduped_at IS NULL');
  });

  it('sqlTruckingOpIsActiveForMatchingSql excludes cancelled and deduped', () => {
    const sql = sqlTruckingOpIsActiveForMatchingSql('t');
    expect(sql).toContain("<> 'CANCELLED'");
    expect(sql).toContain('deduped_at IS NULL');
  });

  it('truckingListExcludeDedupedWhereSql is an AND clause', () => {
    expect(truckingListExcludeDedupedWhereSql).toMatch(/^AND t\.deduped_at IS NULL$/);
  });
});

describe('TruckingDedupeOptions', () => {
  it('documents soft_dedupe vs cancel modes', async () => {
    const { dedupeActiveTruckingOpsForContract } = await import('../services/truckingDedupe.service');
    expect(typeof dedupeActiveTruckingOpsForContract).toBe('function');
  });
});
