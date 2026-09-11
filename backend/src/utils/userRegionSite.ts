import {
  DISCHARGE_DESTINATION_ALIASES,
  normalizeDischargeDestination,
} from './dischargeDestinationAlias';

/**
 * User Region/Plant assignment uses the same operational dimension as Contract /
 * Shipping Performance: SAP Discharge Destination after the alias map (KIJING → TANJUNG PURA).
 * Persistence still goes through master_plants.group_plant, so reads/writes must collapse
 * those two label sets (case + alias) onto one canonical string.
 */
export function canonicalizeUserRegionSites(values: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const canonical = normalizeDischargeDestination(value);
    if (!canonical || canonical.toLowerCase() === 'blank') continue;
    const key = canonical.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(canonical);
  }
  return out;
}

/** Names to match against master_plants.group_plant (incoming dest + alias reverse + original). */
export function expandRegionSiteMatchNames(names: unknown[]): string[] {
  const out = new Set<string>();
  for (const raw of names) {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed || trimmed.toLowerCase() === 'blank') continue;
    const canonical = normalizeDischargeDestination(trimmed);
    out.add(trimmed);
    if (canonical) out.add(canonical);
    const canonKey = canonical.toUpperCase();
    for (const [from, to] of Object.entries(DISCHARGE_DESTINATION_ALIASES)) {
      if (from === canonKey || to.toUpperCase() === canonKey) {
        out.add(from);
        out.add(to);
      }
    }
  }
  return [...out];
}
