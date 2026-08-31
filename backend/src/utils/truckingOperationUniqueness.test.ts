import { describe, expect, it } from 'vitest';
import {
  SQL_TRUCKING_KEEPER_PRIORITY_ORDER,
  compareTruckingWbCompleteKeepers,
  pickTruckingWbCompleteKeeper,
  sqlContractDetailsTruckingOpVisible,
  truckingOperationIdIsAssigned,
  truckingStatusKeeperRank,
} from './truckingOperationUniqueness';

describe('SQL_TRUCKING_KEEPER_PRIORITY_ORDER', () => {
  it('prefers rows that already have loading or unloading location', () => {
    expect(SQL_TRUCKING_KEEPER_PRIORITY_ORDER).toContain('t.loading_location');
    expect(SQL_TRUCKING_KEEPER_PRIORITY_ORDER).toContain('t.unloading_location');
    const statusIdx = SQL_TRUCKING_KEEPER_PRIORITY_ORDER.indexOf('WHEN \'COMPLETED\'');
    const locIdx = SQL_TRUCKING_KEEPER_PRIORITY_ORDER.indexOf('t.loading_location');
    const ddIdx = SQL_TRUCKING_KEEPER_PRIORITY_ORDER.indexOf('daily_deliverables');
    expect(statusIdx).toBeGreaterThanOrEqual(0);
    expect(locIdx).toBeGreaterThan(statusIdx);
    expect(ddIdx).toBeGreaterThan(locIdx);
  });
});

describe('sqlContractDetailsTruckingOpVisible', () => {
  it('matches GET /trucking/:id visibility (not deduped, FRC/LCO)', () => {
    const sql = sqlContractDetailsTruckingOpVisible('t', 'c');
    expect(sql).toContain('t.deduped_at IS NULL');
    expect(sql).toContain("IN ('FRC', 'LCO')");
    expect(sql).toContain('c.incoterm');
  });
});

describe('truckingOperationIdIsAssigned', () => {
  it('returns false for null, empty, or whitespace operation_id', () => {
    expect(truckingOperationIdIsAssigned(null)).toBe(false);
    expect(truckingOperationIdIsAssigned('')).toBe(false);
    expect(truckingOperationIdIsAssigned('   ')).toBe(false);
  });

  it('returns true when operation_id is set', () => {
    expect(truckingOperationIdIsAssigned('OP-LAND-01012026001')).toBe(true);
  });
});

describe('WB-complete keeper selection', () => {
  it('prefers more distinct WB progress dates', () => {
    const keeper = pickTruckingWbCompleteKeeper([
      {
        id: 'thin',
        wbDistinctDates: 2,
        wbQtySumKg: 9999,
        statusRank: truckingStatusKeeperRank('COMPLETED'),
        dailyDeliverablesLen: 10,
        updatedAtMs: 2,
      },
      {
        id: 'rich',
        wbDistinctDates: 8,
        wbQtySumKg: 100,
        statusRank: truckingStatusKeeperRank('PLANNED'),
        dailyDeliverablesLen: 0,
        updatedAtMs: 1,
      },
    ]);
    expect(keeper.id).toBe('rich');
  });

  it('ties on dates then prefers higher WB qty sum', () => {
    const cmp = compareTruckingWbCompleteKeepers(
      {
        id: 'a',
        wbDistinctDates: 3,
        wbQtySumKg: 50,
        statusRank: 6,
        dailyDeliverablesLen: 0,
        updatedAtMs: 1,
      },
      {
        id: 'b',
        wbDistinctDates: 3,
        wbQtySumKg: 200,
        statusRank: 6,
        dailyDeliverablesLen: 0,
        updatedAtMs: 1,
      },
    );
    expect(cmp).toBeGreaterThan(0);
  });
});
