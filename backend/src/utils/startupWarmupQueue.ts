/**
 * Sequential runner for startup cache warmers.
 *
 * WHY THIS EXISTS
 *
 * The warmers used to be scheduled with fixed setTimeout offsets (0s / 20s / 40s), and the
 * snapshot refreshes ran independently on top. On a 2-vCPU host that shares the database with
 * a dozen other containers, that put up to six heavy sap_processed_data scans in flight inside
 * 40 seconds: measured on staging 2026-08-06, load average 16.77 with five queries between 87s
 * and 130s, two of them stuck on LWLock fighting each other. A cold Trucking page took 80s.
 *
 * Fixed offsets guess at how long each job takes. This queue does not guess: it starts the next
 * job only once the previous one has finished, so the total CPU in flight stays at one heavy
 * query regardless of how slow any single job turns out to be. Total warm-up takes longer in
 * wall-clock terms, which is the right trade - nobody is waiting on it, whereas the requests
 * competing with it do have someone waiting.
 *
 * Nothing about what the warmers compute or return changes. This only controls *when* they run.
 *
 * Note on best-effort sequencing: a warmer that is fire-and-forget internally (it kicks off work
 * and returns void) cannot be awaited. For those the queue falls back to the inter-job gap, which
 * is no worse than the previous behaviour. Warmers that return their promise are sequenced
 * exactly.
 */

import logger from './logger';

export interface WarmupJob {
  name: string;
  /** Return the promise to be sequenced exactly; return void for best-effort spacing. */
  run: () => void | Promise<unknown>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RunWarmupOptions {
  /** Delay before the first job, letting the app finish binding and serving. */
  initialDelayMs?: number;
  /** Gap between jobs so the database gets breathing room between heavy scans. */
  gapMs?: number;
  /** Upper bound per job, so one wedged warmer cannot stall the rest forever. */
  jobTimeoutMs?: number;
}

/**
 * Runs `jobs` one at a time. Never rejects: a failing warmer is logged and skipped, because a
 * cache that failed to warm must degrade to a slow page, never to a failed startup.
 */
export async function runWarmupJobsSequentially(
  jobs: WarmupJob[],
  options: RunWarmupOptions = {},
): Promise<void> {
  const initialDelayMs = options.initialDelayMs ?? 0;
  const gapMs = options.gapMs ?? 5_000;
  const jobTimeoutMs = options.jobTimeoutMs ?? 5 * 60_000;

  if (initialDelayMs > 0) await sleep(initialDelayMs);

  for (const job of jobs) {
    const startedAt = Date.now();
    try {
      const result = job.run();
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        // Race against a timeout so a wedged query cannot block every later warmer. The job
        // itself keeps running; we simply stop waiting on it.
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<'timeout'>((resolve) => {
          timer = setTimeout(() => resolve('timeout'), jobTimeoutMs);
          timer.unref?.();
        });
        const outcome = await Promise.race([
          (result as Promise<unknown>).then(() => 'done' as const),
          timeout,
        ]);
        if (timer) clearTimeout(timer);
        if (outcome === 'timeout') {
          logger.warn(
            `🔥 warm-up '${job.name}' still running after ${Math.round(jobTimeoutMs / 1000)}s - continuing without waiting`,
          );
        } else {
          logger.info(`🔥 warm-up '${job.name}' done in ${Date.now() - startedAt}ms`);
        }
      } else {
        logger.info(`🔥 warm-up '${job.name}' started (fire-and-forget)`);
      }
    } catch (error) {
      logger.warn(`🔥 warm-up '${job.name}' failed`, { error });
    }

    if (gapMs > 0) await sleep(gapMs);
  }
}
