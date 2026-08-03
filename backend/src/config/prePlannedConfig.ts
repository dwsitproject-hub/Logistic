export interface PrePlannedConfig {
  enabled: boolean;
  windowTolDays: number;
  capTol: number;
  parcelFallbackMt: number;
  parcelMinSamples: number;
  tier2GapDays: number;
  minOsMt: number;
  excludedPlants: string[];
}

function parseNum(envVal: string | undefined, fallback: number): number {
  const n = Number(envVal);
  return Number.isFinite(n) ? n : fallback;
}

function parsePlantList(raw: string | undefined): string[] {
  if (!raw?.trim()) return ['Blank', 'Trading'];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export function getPrePlannedConfig(): PrePlannedConfig {
  return {
    enabled: String(process.env.PRE_PLANNED_GROUPING_ENABLED ?? 'true').toLowerCase() !== 'false',
    windowTolDays: parseNum(process.env.PRE_PLANNED_WINDOW_TOL_DAYS, 3),
    capTol: parseNum(process.env.PRE_PLANNED_CAP_TOL, 1.05),
    parcelFallbackMt: parseNum(process.env.PRE_PLANNED_PARCEL_FALLBACK_MT, 3000),
    parcelMinSamples: parseNum(process.env.PRE_PLANNED_PARCEL_MIN_SAMPLES, 3),
    tier2GapDays: parseNum(process.env.PRE_PLANNED_TIER2_GAP_DAYS, 7),
    minOsMt: parseNum(process.env.PRE_PLANNED_MIN_OS_MT, 100),
    excludedPlants: parsePlantList(process.env.PRE_PLANNED_EXCLUDED_PLANTS),
  };
}

export function isPrePlannedGroupingEnabled(): boolean {
  return getPrePlannedConfig().enabled;
}
