/**
 * In-memory shipment list metrics (Section 1 / 2 / 3 parity with shipments page SSOT).
 * Used by shipmentList.service ROW_CACHE path.
 */

export type ShipmentEffectiveStatus =
  | 'UNPLANNED'
  | 'PLANNED'
  | 'IN_PROGRESS'
  | 'LOADING'
  | 'IN_TRANSIT'
  | 'ARRIVED'
  | 'UNLOADING'
  | 'COMPLETED'
  | 'CANCELLED';

export type EtaBucketFilterKey = 'MORE_THAN_7D' | 'D_MINUS_2' | 'D' | 'DELAY' | 'NO_ETA';

type EtaBucketKey = EtaBucketFilterKey | 'GAP';

export type ShipmentListDerivedRow = {
  id?: string;
  shipment_id?: string | null;
  operation_id?: string | null;
  sto_number?: string | null;
  sto_key?: string | null;
  status?: string | null;
  created_at?: unknown;
  eta_arrival?: unknown;
  eta_berthed?: unknown;
  eta_loading_start?: unknown;
  eta_loading_complete?: unknown;
  eta_sailed?: unknown;
  eta_discharge_arrival?: unknown;
  eta_discharge_berthed?: unknown;
  eta_discharge_start?: unknown;
  eta_discharge_complete?: unknown;
  eta_vessel_complete_discharge?: unknown;
};

const LOADING_ETA_PHASE_STATUSES: ReadonlySet<ShipmentEffectiveStatus> = new Set([
  'UNPLANNED',
  'PLANNED',
  'IN_PROGRESS',
  'LOADING',
]);

const DISCHARGE_ETA_PHASE_STATUSES: ReadonlySet<ShipmentEffectiveStatus> = new Set([
  'IN_TRANSIT',
  'ARRIVED',
  'UNLOADING',
]);

const VALID_STATUSES: ReadonlySet<string> = new Set([
  'UNPLANNED',
  'PLANNED',
  'IN_PROGRESS',
  'LOADING',
  'IN_TRANSIT',
  'ARRIVED',
  'UNLOADING',
  'COMPLETED',
  'CANCELLED',
]);

export function resolveShipmentGroupKey(row: ShipmentListDerivedRow): string {
  const sto = row.sto_number && String(row.sto_number).trim();
  const opId = row.operation_id && String(row.operation_id).trim();
  return sto || opId || String(row.shipment_id || row.sto_key || row.id || '');
}

export function normalizeEffectiveStatus(raw: string | null | undefined): ShipmentEffectiveStatus {
  const s = String(raw ?? '')
    .trim()
    .toUpperCase();
  return VALID_STATUSES.has(s) ? (s as ShipmentEffectiveStatus) : 'UNPLANNED';
}

export function matchesStatusFilter(
  status: ShipmentEffectiveStatus,
  statusFilter: string,
): boolean {
  const filter = String(statusFilter ?? 'ALL')
    .trim()
    .toUpperCase();
  if (!filter || filter === 'ALL') return true;
  return status === filter;
}

type EtaBucketCounts = {
  moreThan7D: number;
  dMinus2: number;
  d: number;
  delay: number;
  noEta: number;
};

type EtaBucketMaps = {
  counts: EtaBucketCounts;
  bucketByGroupKey: Map<string, EtaBucketKey>;
};

function toDayDiff(value: unknown, todayMidnight: Date, msPerDay: number): number | null {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  const dMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.floor((dMidnight.getTime() - todayMidnight.getTime()) / msPerDay);
}

function loadingEtaValues(row: ShipmentListDerivedRow): unknown[] {
  return [
    row.eta_arrival,
    row.eta_berthed,
    row.eta_loading_start,
    row.eta_loading_complete,
    row.eta_sailed,
  ];
}

function dischargeEtaValues(row: ShipmentListDerivedRow): unknown[] {
  return [
    row.eta_discharge_arrival,
    row.eta_discharge_berthed,
    row.eta_discharge_start,
    row.eta_discharge_complete ?? row.eta_vessel_complete_discharge,
  ];
}

function assignBucketFromDiffs(diffs: number[]): EtaBucketKey {
  if (diffs.length === 0) return 'NO_ETA';
  const hasDelay = diffs.some((d) => d < 0);
  const hasToday = diffs.some((d) => d === 0);
  const hasDMinus2 = diffs.some((d) => d > 0 && d <= 2);
  const hasMoreThan7 = diffs.some((d) => d > 7);
  if (hasDelay) return 'DELAY';
  if (hasToday) return 'D';
  if (hasDMinus2) return 'D_MINUS_2';
  if (hasMoreThan7) return 'MORE_THAN_7D';
  return 'GAP';
}

function countKeyToFilter(key: EtaBucketFilterKey): keyof EtaBucketCounts {
  switch (key) {
    case 'MORE_THAN_7D':
      return 'moreThan7D';
    case 'D_MINUS_2':
      return 'dMinus2';
    case 'D':
      return 'd';
    case 'DELAY':
      return 'delay';
    case 'NO_ETA':
      return 'noEta';
  }
}

function computeEtaBuckets(
  rows: readonly ShipmentListDerivedRow[],
  phase: 'loading' | 'discharge',
  options?: { contextualPhaseFilter?: boolean; now?: Date },
): EtaBucketMaps {
  const result: EtaBucketMaps = {
    counts: { moreThan7D: 0, dMinus2: 0, d: 0, delay: 0, noEta: 0 },
    bucketByGroupKey: new Map(),
  };
  const today = options?.now ?? new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const msPerDay = 24 * 60 * 60 * 1000;
  const contextual = options?.contextualPhaseFilter !== false;
  const phaseStatuses =
    phase === 'loading' ? LOADING_ETA_PHASE_STATUSES : DISCHARGE_ETA_PHASE_STATUSES;

  const groupDiffs = new Map<string, number[]>();

  for (const row of rows) {
    const status = normalizeEffectiveStatus(row.status);
    if (status === 'COMPLETED' || status === 'CANCELLED') continue;
    if (contextual && !phaseStatuses.has(status)) continue;

    const key = resolveShipmentGroupKey(row);
    const diffs = groupDiffs.get(key) ?? [];
    const etaValues = phase === 'loading' ? loadingEtaValues(row) : dischargeEtaValues(row);

    for (const v of etaValues) {
      const diff = toDayDiff(v, todayMidnight, msPerDay);
      if (diff !== null) diffs.push(diff);
    }

    if (diffs.length > 0) {
      groupDiffs.set(key, diffs);
    } else if (!groupDiffs.has(key)) {
      groupDiffs.set(key, []);
    }
  }

  for (const [key, diffs] of groupDiffs.entries()) {
    const bucket = assignBucketFromDiffs(diffs);
    result.bucketByGroupKey.set(key, bucket);
    if (bucket === 'GAP') continue;
    result.counts[countKeyToFilter(bucket)] += 1;
  }

  return result;
}

export function filterRowsByStatusScope<T extends ShipmentListDerivedRow>(
  rows: readonly T[],
  statusFilter: string,
): T[] {
  if (!statusFilter || statusFilter === 'ALL') return [...rows];
  return rows.filter((row) =>
    matchesStatusFilter(normalizeEffectiveStatus(row.status), statusFilter),
  );
}

function rowMatchesEtaBucket(
  row: ShipmentListDerivedRow,
  filter: EtaBucketFilterKey,
  bucketMaps: EtaBucketMaps,
): boolean {
  const key = resolveShipmentGroupKey(row);
  const bucket = bucketMaps.bucketByGroupKey.get(key);
  return bucket === filter;
}

export function filterShipmentListRows<T extends ShipmentListDerivedRow>(
  rows: readonly T[],
  filters: {
    statusFilter: string;
    etaLoadingFilter: string | null;
    etaDischargeFilter: string | null;
  },
): T[] {
  const loadingMaps = computeEtaBuckets(rows, 'loading');
  const dischargeMaps = computeEtaBuckets(rows, 'discharge');
  let out: T[] = [...rows];

  if (filters.statusFilter && filters.statusFilter !== 'ALL') {
    out = filterRowsByStatusScope(out, filters.statusFilter);
  } else if (filters.etaLoadingFilter) {
    out = out.filter((row) =>
      rowMatchesEtaBucket(row, filters.etaLoadingFilter as EtaBucketFilterKey, loadingMaps),
    );
  } else if (filters.etaDischargeFilter) {
    out = out.filter((row) =>
      rowMatchesEtaBucket(row, filters.etaDischargeFilter as EtaBucketFilterKey, dischargeMaps),
    );
  }

  return out;
}

export type ShipmentListSummaryPayload = {
  total: number;
  status: {
    unplanned: number;
    planned: number;
    inProgress: number;
    loading: number;
    inTransit: number;
    arrived: number;
    unloading: number;
    completed: number;
    cancelled: number;
  };
  etaLoading: EtaBucketCounts;
  etaDischarge: EtaBucketCounts;
};

export function buildShipmentListSummaryFromRows(
  rows: readonly ShipmentListDerivedRow[],
  options?: { scopeStatus?: string },
): ShipmentListSummaryPayload {
  const scoped =
    options?.scopeStatus && options.scopeStatus !== 'ALL'
      ? filterRowsByStatusScope(rows, options.scopeStatus)
      : rows;

  let unplanned = 0;
  let planned = 0;
  let inProgress = 0;
  let loading = 0;
  let inTransit = 0;
  let arrived = 0;
  let unloading = 0;
  let completed = 0;
  let cancelled = 0;

  for (const row of rows) {
    switch (normalizeEffectiveStatus(row.status)) {
      case 'UNPLANNED':
        unplanned += 1;
        break;
      case 'PLANNED':
        planned += 1;
        break;
      case 'IN_PROGRESS':
        inProgress += 1;
        break;
      case 'LOADING':
        loading += 1;
        break;
      case 'IN_TRANSIT':
        inTransit += 1;
        break;
      case 'ARRIVED':
        arrived += 1;
        break;
      case 'UNLOADING':
        unloading += 1;
        break;
      case 'COMPLETED':
        completed += 1;
        break;
      case 'CANCELLED':
        cancelled += 1;
        break;
      default:
        unplanned += 1;
        break;
    }
  }

  const loadingBuckets = computeEtaBuckets(scoped, 'loading');
  const dischargeBuckets = computeEtaBuckets(scoped, 'discharge');

  return {
    total: rows.length,
    status: {
      unplanned,
      planned,
      inProgress,
      loading,
      inTransit,
      arrived,
      unloading,
      completed,
      cancelled,
    },
    etaLoading: loadingBuckets.counts,
    etaDischarge: dischargeBuckets.counts,
  };
}

function normalizeSortValue(v: unknown): string | number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v instanceof Date) return v.getTime();
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const t = new Date(s).getTime();
    return Number.isFinite(t) ? t : s.toLowerCase();
  }
  const n = Number(s);
  if (!Number.isNaN(n) && /^-?\d+(\.\d+)?$/.test(s.replace(/,/g, ''))) return n;
  return s.toLowerCase();
}

function compareSortValues(a: unknown, b: unknown, dir: 'ASC' | 'DESC'): number {
  const av = normalizeSortValue(a);
  const bv = normalizeSortValue(b);
  const aNull = av === null;
  const bNull = bv === null;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  let cmp = 0;
  if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
  else cmp = String(av).localeCompare(String(bv));
  return dir === 'ASC' ? cmp : -cmp;
}

export function sortShipmentListRows(
  rows: ShipmentListDerivedRow[],
  sortKey: string,
  sortDir: 'ASC' | 'DESC',
): ShipmentListDerivedRow[] {
  const field = sortKey || 'created_at';
  return [...rows].sort((a, b) => {
    const primary = compareSortValues(
      (a as Record<string, unknown>)[field],
      (b as Record<string, unknown>)[field],
      sortDir,
    );
    if (primary !== 0) return primary;
    return compareSortValues(b.created_at, a.created_at, 'DESC');
  });
}
