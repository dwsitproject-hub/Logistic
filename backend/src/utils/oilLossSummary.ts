export type ROilLossKey = 'r1' | 'r2' | 'r3' | 'r4';

export type ROilLossSummary = {
  avgMt: number | null;
  avgPct: number | null;
  sampleCount: number;
};

export type OilLossSummaryRow = {
  contract_date?: string | null;
  operation_date?: string | null;
  quantity_sent?: number | string | null;
  quantity_received?: number | string | null;
  quantity_sfal?: number | string | null;
  quantity_sfbd?: number | string | null;
};

export type YtdOilLossSummaryPayload = {
  year: number;
  dateFrom: string;
  dateTo: string;
  r1: ROilLossSummary;
  r2: ROilLossSummary;
  r3: ROilLossSummary;
  r4: ROilLossSummary;
};

function parseQty(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function resolveContractDate(row: OilLossSummaryRow): string {
  return String(row.contract_date ?? row.operation_date ?? '').slice(0, 10);
}

export function getYtdDateRange(referenceDate = new Date()): { year: number; dateFrom: string; dateTo: string } {
  const year = referenceDate.getFullYear();
  const dateFrom = `${year}-01-01`;
  const dateTo = referenceDate.toISOString().slice(0, 10);
  return { year, dateFrom, dateTo };
}

export function filterYtdOilLossRows(
  rows: OilLossSummaryRow[],
  referenceDate = new Date(),
): OilLossSummaryRow[] {
  const { dateFrom, dateTo } = getYtdDateRange(referenceDate);
  return rows.filter((row) => {
    const d = resolveContractDate(row);
    if (!d) return false;
    return d >= dateFrom && d <= dateTo;
  });
}

export function computeROilLossSummary(rows: OilLossSummaryRow[], kind: ROilLossKey): ROilLossSummary {
  const samples: { lossKg: number; pct: number }[] = [];

  for (const row of rows) {
    const delivery = parseQty(row.quantity_sent);
    const receive = parseQty(row.quantity_received);
    const sfal = parseQty(row.quantity_sfal);
    const sfbd = parseQty(row.quantity_sfbd);

    let lossKg: number | null = null;
    let baseKg: number | null = null;

    if (kind === 'r1' && sfal != null && delivery != null) {
      lossKg = sfal - delivery;
      baseKg = delivery;
    } else if (kind === 'r2' && sfbd != null && sfal != null) {
      lossKg = sfbd - sfal;
      baseKg = sfal;
    } else if (kind === 'r3' && receive != null && sfbd != null) {
      lossKg = receive - sfbd;
      baseKg = sfbd;
    } else if (kind === 'r4' && receive != null && delivery != null) {
      lossKg = receive - delivery;
      baseKg = delivery;
    }

    if (lossKg == null || baseKg == null || baseKg <= 0) continue;
    samples.push({ lossKg, pct: (lossKg / baseKg) * 100 });
  }

  if (samples.length === 0) {
    return { avgMt: null, avgPct: null, sampleCount: 0 };
  }

  const count = samples.length;
  return {
    avgMt: samples.reduce((sum, s) => sum + s.lossKg, 0) / count / 1000,
    avgPct: samples.reduce((sum, s) => sum + s.pct, 0) / count,
    sampleCount: count,
  };
}

export function buildYtdOilLossSummary(
  rows: OilLossSummaryRow[],
  referenceDate = new Date(),
): YtdOilLossSummaryPayload {
  const { year, dateFrom, dateTo } = getYtdDateRange(referenceDate);
  const ytdRows = filterYtdOilLossRows(rows, referenceDate);

  return {
    year,
    dateFrom,
    dateTo,
    r1: computeROilLossSummary(ytdRows, 'r1'),
    r2: computeROilLossSummary(ytdRows, 'r2'),
    r3: computeROilLossSummary(ytdRows, 'r3'),
    r4: computeROilLossSummary(ytdRows, 'r4'),
  };
}
