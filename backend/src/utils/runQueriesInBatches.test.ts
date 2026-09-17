import { describe, expect, it, vi } from 'vitest';
import { runQueriesInBatches } from './runQueriesInBatches';

describe('runQueriesInBatches', () => {
  it('runs all tasks and preserves order', async () => {
    const order: number[] = [];
    const tasks = [1, 2, 3, 4, 5].map(
      (n) => () =>
        new Promise<number>((resolve) => {
          order.push(n);
          resolve(n);
        }),
    );
    const results = await runQueriesInBatches(tasks, 2);
    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(order).toEqual([1, 2, 3, 4, 5]);
  });

  it('limits concurrent in-flight tasks to batch size', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const tasks = Array.from({ length: 6 }, (_, i) => () =>
      new Promise<number>((resolve) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        setTimeout(() => {
          inFlight -= 1;
          resolve(i);
        }, 5);
      }),
    );
    await runQueriesInBatches(tasks, 3);
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it('handles empty task list', async () => {
    await expect(runQueriesInBatches([])).resolves.toEqual([]);
  });
});
