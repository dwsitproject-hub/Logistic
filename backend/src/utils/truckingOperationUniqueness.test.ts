import { describe, expect, it } from 'vitest';
import {
  compareTruckingWbCompleteKeepers,
  pickTruckingWbCompleteKeeper,
  truckingOperationIdIsAssigned,
  truckingStatusKeeperRank,
} from './truckingOperationUniqueness';

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
