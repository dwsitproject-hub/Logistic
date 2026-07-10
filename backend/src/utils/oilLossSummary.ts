export type ROilLossKey = 'r1' | 'r2' | 'r3' | 'r4';

export type ROilLossSummary = {
  avgMt: number | null;
  avgPct: number | null;
  totalMt: number | null;
  totalPct: number | null;
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

function contractGroupKey(row: OilLossSummaryRow & { id?: string; contract_number?: string | null; contract_ext_no?: string | null }): string {
  const cn = String(row.contract_number ?? '').trim();
  if (cn) return `cn:${cn}`;
  const ext = String(row.contract_ext_no ?? '').trim();
  if (ext) return `ext:${ext}`;
  return `row:${row.id ?? resolveContractDate(row)}`;
}

type ContractQuantityAgg = {
  quantity_sent: number;
  quantity_received: number;
  quantity_sfal: number;
  quantity_sfbd: number;
  has_sent: boolean;
  has_received: boolean;
  has_sfal: boolean;
  has_sfbd: boolean;
};

function aggregateOilLossQuantitiesByContract(rows: OilLossSummaryRow[]): Map<string, ContractQuantityAgg> {
  const map = new Map<string, ContractQuantityAgg>();

  for (const row of rows) {
    const key = contractGroupKey(row);
    let agg = map.get(key);
    if (!agg) {
      agg = {
        quantity_sent: 0,
        quantity_received: 0,
        quantity_sfal: 0,
        quantity_sfbd: 0,
        has_sent: false,
        has_received: false,
        has_sfal: false,
        has_sfbd: false,
      };
      map.set(key, agg);
    }
    const delivery = parseQty(row.quantity_sent);
    const receive = parseQty(row.quantity_received);
    const sfal = parseQty(row.quantity_sfal);
    const sfbd = parseQty(row.quantity_sfbd);
    if (delivery != null) {
      agg.quantity_sent += delivery;
      agg.has_sent = true;
    }
    if (receive != null) {
      agg.quantity_received += receive;
      agg.has_received = true;
    }
    if (sfal != null) {
      agg.quantity_sfal += sfal;
      agg.has_sfal = true;
    }
    if (sfbd != null) {
      agg.quantity_sfbd += sfbd;
      agg.has_sfbd = true;
    }
  }

  return map;
}

function sampleFromContractAgg(
  agg: ContractQuantityAgg,
  kind: ROilLossKey,
): { lossKg: number; baseKg: number; pct: number; deliveryKg: number } | null {
  const delivery = agg.quantity_sent;
  const receive = agg.quantity_received;
  const sfal = agg.quantity_sfal;
  const sfbd = agg.quantity_sfbd;

  let lossKg: number | null = null;
  let baseKg: number | null = null;

  if (kind === 'r1' && agg.has_sfal && agg.has_sent && delivery > 0) {
    lossKg = sfal - delivery;
    baseKg = delivery;
  } else if (kind === 'r2' && agg.has_sfbd && agg.has_sfal && sfal > 0) {
    lossKg = sfbd - sfal;
    baseKg = sfal;
  } else if (kind === 'r3' && agg.has_received && agg.has_sfbd && sfbd > 0) {
    lossKg = receive - sfbd;
    baseKg = sfbd;
  } else if (kind === 'r4' && agg.has_received && agg.has_sent && delivery > 0) {
    lossKg = receive - delivery;
    baseKg = delivery;
  }

  if (lossKg == null || baseKg == null || baseKg <= 0) return null;
  return {
    lossKg,
    baseKg,
    pct: (lossKg / baseKg) * 100,
    deliveryKg: agg.has_sent ? delivery : 0,
  };
}

export function computeROilLossSummary(rows: OilLossSummaryRow[], kind: ROilLossKey): ROilLossSummary {
  const byContract = aggregateOilLossQuantitiesByContract(rows);
  const samples: { lossKg: number; baseKg: number; pct: number; deliveryKg: number }[] = [];

  for (const agg of byContract.values()) {
    const sample = sampleFromContractAgg(agg, kind);
    if (sample) samples.push(sample);
  }

  if (samples.length === 0) {
    return { avgMt: null, avgPct: null, totalMt: null, totalPct: null, sampleCount: 0 };
  }

  const count = samples.length;
  const totalLossKg = samples.reduce((sum, s) => sum + s.lossKg, 0);

  let weightedPctNumerator = 0;
  let deliveryWeightSum = 0;
  for (const s of samples) {
    if (s.deliveryKg <= 0) continue;
    weightedPctNumerator += s.deliveryKg * s.pct;
    deliveryWeightSum += s.deliveryKg;
  }

  return {
    avgMt: totalLossKg / count / 1000,
    avgPct: samples.reduce((sum, s) => sum + s.pct, 0) / count,
    totalMt: totalLossKg / 1000,
    totalPct: deliveryWeightSum > 0 ? weightedPctNumerator / deliveryWeightSum : null,
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
