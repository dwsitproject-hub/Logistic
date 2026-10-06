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

/** Estimation columns about the LOADING call. They differ by loading port; the discharge ones belong to the whole voyage. */
export const SHIPMENT_GROUPING_LOADING_ETA_KEYS: readonly GroupingEtaKey[] = [
  'eta_arrival',
  'eta_berthed',
  'eta_loading_start',
  'eta_loading_complete',
  'eta_sailed',
];

const LOADING_ETA_KEY_SET = new Set<GroupingEtaKey>(SHIPMENT_GROUPING_LOADING_ETA_KEYS);

export type GroupingRowWithPort = {
  vessel?: string;
  etas?: Record<GroupingEtaKey, string>;
  /** Normalised SAP loading port of the row's PO ('' when it has none). */
  portKey: string;
};

export type MergedClusterByPort = {
  /** Group-wide, first non-empty - what merging the whole Group used to give. Used to decide Planned vs Preplanned. */
  fields: GroupingVoyageFields;
  /** The complete ETA set to apply to every PO loading at that port (its own loading ETAs + the voyage's discharge ETAs). */
  etasByPort: Map<string, Record<GroupingEtaKey, string>>;
  reason?: string;
};

/**
 * One Group is one voyage, and a voyage can load at more than one port. The template has a single set of ETA columns per
 * row, so POs loading at different ports carry different loading ETAs (Arr. @ LP ... Sail LP) while sharing one vessel and
 * one set of discharge ETAs. The old rule - every row of a Group must carry the same ETA - rejected exactly that.
 *
 *   - vessel and the discharge ETAs: one value for the whole Group, as before.
 *   - loading ETAs: one value per LOADING PORT. Two POs at the same port that disagree are still refused (that is a typo, not
 *     a second call); two POs at different ports may differ.
 *   - a loading ETA a port leaves blank takes the Group's first non-empty value, as a blank always did, so a Group that fills
 *     the ETAs on one row only behaves exactly as before.
 */
export function mergeClusterVoyageFieldsByPort(rows: GroupingRowWithPort[]): MergedClusterByPort {
  const fields: GroupingVoyageFields = { vessel: '', etas: emptyGroupingEtas() };
  const perPort = new Map<string, Record<GroupingEtaKey, string>>();

  for (const row of rows) {
    const vessel = String(row.vessel ?? '').trim();
    if (vessel) {
      if (!fields.vessel) fields.vessel = vessel;
      else if (normText(fields.vessel) !== normText(vessel)) {
        return {
          fields,
          etasByPort: new Map(),
          reason: `Vessel values differ in the same Group (${fields.vessel} vs ${vessel})`,
        };
      }
    }
    const etas = row.etas ?? emptyGroupingEtas();
    const port = perPort.get(row.portKey) ?? emptyGroupingEtas();
    perPort.set(row.portKey, port);
    for (const key of SHIPMENT_GROUPING_ETA_KEYS) {
      const next = String(etas[key] ?? '').trim();
      if (!next) continue;
      if (!fields.etas[key]) fields.etas[key] = next;
      if (LOADING_ETA_KEY_SET.has(key)) {
        if (!port[key]) port[key] = next;
        else if (port[key] !== next) {
          return {
            fields,
            etasByPort: new Map(),
            reason: row.portKey
              ? `ETA values differ for the same loading port in the Group (${key}, ${row.portKey})`
              : `ETA values differ in the same Group (${key})`,
          };
        }
      } else if (fields.etas[key] !== next) {
        return { fields, etasByPort: new Map(), reason: `ETA values differ in the same Group (${key})` };
      }
    }
  }

  const etasByPort = new Map<string, Record<GroupingEtaKey, string>>();
  for (const [portKey, own] of perPort) {
    const full = emptyGroupingEtas();
    for (const key of SHIPMENT_GROUPING_ETA_KEYS) {
      full[key] = LOADING_ETA_KEY_SET.has(key) ? own[key] || fields.etas[key] : fields.etas[key];
    }
    etasByPort.set(portKey, full);
  }
  return { fields, etasByPort };
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
