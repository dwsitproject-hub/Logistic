export type ROilLossKey = 'r1' | 'r2' | 'r3' | 'r4';

export type ROilLossSummary = {
  avgMt: number | null;
  avgPct: number | null;
  totalMt: number | null;
  totalPct: number | null;
  sampleCount: number;
};

export type OilLossSummaryRow = {
  id?: string | null;
  /** SEA rows merge onto their shared STO/voyage Operation ID; LAND stays per-contract. */
  transport_mode?: string | null;
  operation_id?: string | null;
  contract_number?: string | null;
  contract_ext_no?: string | null;
  contract_date?: string | null;
  operation_date?: string | null;
  quantity_sent?: number | string | null;
  quantity_delivery?: number | string | null;
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

function contractGroupKey(row: OilLossSummaryRow): string {
  const cn = String(row.contract_number ?? '').trim();
  if (cn) return `cn:${cn}`;
  const ext = String(row.contract_ext_no ?? '').trim();
  if (ext) return `ext:${ext}`;
  return `row:${row.id ?? resolveContractDate(row)}`;
}

function isSeaTransportMode(transportMode: string | null | undefined): boolean {
  return String(transportMode ?? '').trim().toUpperCase() === 'SEA';
}

/**
 * Outer grouping key for a per-contract subtotal.
 * SEA: multiple POs sharing one STO/voyage Operation ID merge into one group (summed).
 * LAND: stays per-contract — a LAND Operation ID is already 1:1 with its PO, so this key
 * collapses to the same contract group as today (no behavior change).
 */
function oilLossOuterGroupKey(agg: Pick<ContractQuantityAgg, 'contract_key' | 'transport_mode' | 'operation_id'>): string {
  if (isSeaTransportMode(agg.transport_mode)) {
    const opId = String(agg.operation_id ?? '').trim();
    if (opId) return `op:${opId}`;
  }
  return agg.contract_key;
}

type OilLossQuantityAgg = {
  quantity_sent: number;
  quantity_received: number;
  quantity_sfal: number;
  quantity_sfbd: number;
  has_sent: boolean;
  has_received: boolean;
  has_sfal: boolean;
  has_sfbd: boolean;
};

type ContractQuantityAgg = OilLossQuantityAgg & {
  contract_key: string;
  transport_mode: string | null;
  operation_id: string | null;
};

function emptyQuantityAgg(): OilLossQuantityAgg {
  return {
    quantity_sent: 0,
    quantity_received: 0,
    quantity_sfal: 0,
    quantity_sfbd: 0,
    has_sent: false,
    has_received: false,
    has_sfal: false,
    has_sfbd: false,
  };
}

function aggregateOilLossQuantitiesByContract(rows: OilLossSummaryRow[]): Map<string, ContractQuantityAgg> {
  const map = new Map<string, ContractQuantityAgg>();

  for (const row of rows) {
    const key = contractGroupKey(row);
    let agg = map.get(key);
    if (!agg) {
      agg = {
        ...emptyQuantityAgg(),
        contract_key: key,
        transport_mode: row.transport_mode ?? null,
        operation_id: row.operation_id ?? null,
      };
      map.set(key, agg);
    }
    const delivery = parseQty(row.quantity_sent ?? row.quantity_delivery);
    const receive = parseQty(row.quantity_received);
    const sfal = parseQty(row.quantity_sfal);
    const sfbd = parseQty(row.quantity_sfbd);
    // Contracts-level delivery/receive — take once per contract (do not sum SPD rows).
    if (delivery != null && !agg.has_sent) {
      agg.quantity_sent = delivery;
      agg.has_sent = true;
    }
    if (receive != null && !agg.has_received) {
      agg.quantity_received = receive;
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

/**
 * Level 2 — combine per-contract subtotals onto their outer group (SEA voyage or LAND contract).
 * Summing (rather than "take first") is correct here because each input is already one
 * deduped subtotal per distinct contract, so merging distinct contracts never double-counts.
 */
function aggregateContractsByOuterGroup(
  byContract: Map<string, ContractQuantityAgg>,
): Map<string, OilLossQuantityAgg> {
  const outer = new Map<string, OilLossQuantityAgg>();

  for (const agg of byContract.values()) {
    const key = oilLossOuterGroupKey(agg);
    let out = outer.get(key);
    if (!out) {
      out = emptyQuantityAgg();
      outer.set(key, out);
    }
    if (agg.has_sent) {
      out.quantity_sent += agg.quantity_sent;
      out.has_sent = true;
    }
    if (agg.has_received) {
      out.quantity_received += agg.quantity_received;
      out.has_received = true;
    }
    if (agg.has_sfal) {
      out.quantity_sfal += agg.quantity_sfal;
      out.has_sfal = true;
    }
    if (agg.has_sfbd) {
      out.quantity_sfbd += agg.quantity_sfbd;
      out.has_sfbd = true;
    }
  }

  return outer;
}

function sampleFromContractAgg(
  agg: OilLossQuantityAgg,
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
  // Note: for SEA, sampleCount below now counts voyages (Operation ID groups) instead of
  // contracts/POs — an intended, visible change when a voyage spans multiple contracts.
  const byGroup = aggregateContractsByOuterGroup(byContract);
  const samples: { lossKg: number; baseKg: number; pct: number; deliveryKg: number }[] = [];

  for (const agg of byGroup.values()) {
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
