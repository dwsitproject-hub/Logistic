import {
  emptyGroupingEtas,
  SHIPMENT_GROUPING_ETA_KEYS,
  type GroupingEtaKey,
} from './shipmentGroupingEtaColumns';

export type GroupingVoyageFields = {
  vessel: string;
  etas: Record<GroupingEtaKey, string>;
};

export type GroupingClusterMode = 'preplanned' | 'planned' | 'reject';

export function isCifIncoterm(value: unknown): boolean {
  return String(value ?? '').trim().toUpperCase() === 'CIF';
}

export function charterTypeFromMasterTerms(terms?: string | null): string {
  const t = String(terms ?? '').trim().toUpperCase();
  return t === 'V/C' || t === 'T/C' ? t : '';
}

function normText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

export function groupingVoyageHasAnyEta(etas: Record<GroupingEtaKey, string>): boolean {
  return SHIPMENT_GROUPING_ETA_KEYS.some((key) => Boolean(etas[key]));
}

export function groupingVoyageHasAllEtas(etas: Record<GroupingEtaKey, string>): boolean {
  return SHIPMENT_GROUPING_ETA_KEYS.every((key) => Boolean(etas[key]));
}

export function groupingVoyageHasAnyPlannedInput(fields: GroupingVoyageFields): boolean {
  return Boolean(fields.vessel) || groupingVoyageHasAnyEta(fields.etas);
}

/**
 * First non-empty vessel/ETA wins. Later non-empty values in the same Group must match.
 */
export function mergeClusterVoyageFields(
  rows: Array<{ vessel?: string; etas?: Record<GroupingEtaKey, string> }>,
): { fields: GroupingVoyageFields; reason?: string } {
  const fields: GroupingVoyageFields = { vessel: '', etas: emptyGroupingEtas() };
  for (const row of rows) {
    const vessel = String(row.vessel ?? '').trim();
    if (vessel) {
      if (!fields.vessel) {
        fields.vessel = vessel;
      } else if (normText(fields.vessel) !== normText(vessel)) {
        return { fields, reason: `Vessel values differ in the same Group (${fields.vessel} vs ${vessel})` };
      }
    }
    const etas = row.etas ?? emptyGroupingEtas();
    for (const key of SHIPMENT_GROUPING_ETA_KEYS) {
      const next = String(etas[key] ?? '').trim();
      if (!next) continue;
      if (!fields.etas[key]) {
        fields.etas[key] = next;
      } else if (fields.etas[key] !== next) {
        return { fields, reason: `ETA values differ in the same Group (${key})` };
      }
    }
  }
  return { fields };
}

export function classifyGroupingClusterMode(opts: {
  fields: GroupingVoyageFields;
  allCif: boolean;
}): { mode: GroupingClusterMode; reason?: string } {
  const { fields, allCif } = opts;
  const hasVessel = Boolean(fields.vessel);
  const anyEta = groupingVoyageHasAnyEta(fields.etas);
  const allEta = groupingVoyageHasAllEtas(fields.etas);

  if (!hasVessel && !anyEta) {
    return { mode: 'preplanned' };
  }
  if (!hasVessel && anyEta) {
    return { mode: 'reject', reason: 'ETA filled but Vessel is empty' };
  }
  if (hasVessel && (allCif || allEta)) {
    return { mode: 'planned' };
  }
  return {
    mode: 'reject',
    reason: 'Vessel filled but not all Estimation dates (required unless all POs are CIF)',
  };
}

export function normalizeDischargePortKey(value: unknown): string {
  return normText(value);
}
