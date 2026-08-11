import { resolveCanonicalVesselDisplayName } from './vesselNameNormalize';

/** pg text[] (or pre-parsed array) → sorted distinct display list with canonical vessel names. */
export function normalizePipelineVesselNameList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of raw) {
    const canonical = resolveCanonicalVesselDisplayName(String(item ?? '').trim());
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    names.push(canonical);
  }
  return names.sort((a, b) => a.localeCompare(b));
}
