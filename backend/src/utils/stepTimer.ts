/**
 * Times the steps of one request, for a Server-Timing header (the browser's Network > Timing tab shows it) and one log line.
 * Built for the Commercial Documents upload, where "it is slow" has to be split into: receiving the file, the virus scan, the database lookups,
 * the disk work on the share, and the inserts. Cheap: one hrtime per step.
 */
export type StepTimer = {
  /** Ends the step that began at the previous mark (or at the start) and names it. */
  mark: (name: string) => void;
  /** The steps so far in ms, plus the total since the start. */
  summary: () => Record<string, number>;
  /** "recv;dur=12.3, scan;dur=0.0, ..." */
  header: () => string;
};

export function createStepTimer(startNs: bigint = process.hrtime.bigint()): StepTimer {
  let last = startNs;
  const steps: Array<[string, number]> = [];
  const ms = (from: bigint, to: bigint) => Math.round(Number(to - from) / 1e5) / 10; // 0.1 ms
  return {
    mark(name) {
      const now = process.hrtime.bigint();
      steps.push([name, ms(last, now)]);
      last = now;
    },
    summary() {
      const out: Record<string, number> = {};
      for (const [name, d] of steps) out[name] = d;
      out.total = ms(startNs, last);
      return out;
    },
    header() {
      const total = ms(startNs, last);
      return [...steps, ['total', total] as [string, number]].map(([n, d]) => `${n.replace(/[^a-z0-9_-]/gi, '')};dur=${d}`).join(', ');
    },
  };
}

/** Express middleware: stamps the moment a request reached the route, so the controller can time the body upload (multer) as its first step. */
export function stampRequestStart(_req: unknown, res: { locals: Record<string, unknown> }, next: () => void): void {
  res.locals.requestStartNs = process.hrtime.bigint();
  next();
}
