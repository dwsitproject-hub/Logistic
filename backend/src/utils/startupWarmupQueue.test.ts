/**
 * The queue's job is to keep exactly one heavy warm-up query in flight, and to never take the
 * app down. Both properties are load-bearing: overlapping warmers are what produced load
 * average 16.77 on staging's 2 vCPUs, and a throwing warmer must degrade to a slow page rather
 * than a failed startup.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { runWarmupJobsSequentially, type WarmupJob } from './startupWarmupQueue';

describe('runWarmupJobsSequentially', () => {
  beforeEach(() => vi.clearAllMocks());

  it('never runs two promise-returning jobs at the same time', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const makeJob = (name: string): WarmupJob => ({
      name,
      run: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 15));
        inFlight -= 1;
      },
    });

    await runWarmupJobsSequentially([makeJob('a'), makeJob('b'), makeJob('c')], { gapMs: 0 });

    // This is the whole point of the queue: the previous fixed-offset scheduling allowed
    // overlap whenever a job outran its offset.
    expect(maxInFlight).toBe(1);
  });

  it('runs jobs in the given order', async () => {
    const order: string[] = [];
    const job = (name: string): WarmupJob => ({
      name,
      run: async () => {
        await new Promise((r) => setTimeout(r, 5));
        order.push(name);
      },
    });

    await runWarmupJobsSequentially([job('first'), job('second'), job('third')], { gapMs: 0 });

    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('continues past a throwing job and still runs the rest', async () => {
    const ran: string[] = [];
    const jobs: WarmupJob[] = [
      { name: 'ok-1', run: async () => void ran.push('ok-1') },
      {
        name: 'boom',
        run: () => {
          throw new Error('synchronous failure');
        },
      },
      { name: 'rejects', run: async () => Promise.reject(new Error('async failure')) },
      { name: 'ok-2', run: async () => void ran.push('ok-2') },
    ];

    await expect(
      runWarmupJobsSequentially(jobs, { gapMs: 0 }),
    ).resolves.toBeUndefined();

    // A failed warm-up must cost a slow page, never a dead startup.
    expect(ran).toEqual(['ok-1', 'ok-2']);
  });

  it('tolerates fire-and-forget jobs that return void', async () => {
    const ran: string[] = [];
    const jobs: WarmupJob[] = [
      { name: 'void-job', run: () => { ran.push('void-job'); } },
      { name: 'after', run: async () => void ran.push('after') },
    ];

    await runWarmupJobsSequentially(jobs, { gapMs: 0 });

    expect(ran).toEqual(['void-job', 'after']);
  });

  it('stops waiting on a wedged job so later warmers still run', async () => {
    const ran: string[] = [];
    const jobs: WarmupJob[] = [
      // Simulates a query that never returns - previously this would block everything behind it.
      { name: 'wedged', run: () => new Promise(() => {}) },
      { name: 'after-wedged', run: async () => void ran.push('after-wedged') },
    ];

    await runWarmupJobsSequentially(jobs, { gapMs: 0, jobTimeoutMs: 30 });

    expect(ran).toEqual(['after-wedged']);
  });

  it('does nothing and does not throw when given no jobs', async () => {
    await expect(runWarmupJobsSequentially([], { gapMs: 0 })).resolves.toBeUndefined();
  });
});
