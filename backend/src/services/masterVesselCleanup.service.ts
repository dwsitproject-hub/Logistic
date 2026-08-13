import type { PoolClient } from 'pg';
import { query } from '../database/connection';
import { isProvisionalVesselCode } from '../utils/masterVesselCodeResolve';
import {
  extractVesselHullKey,
  isMissingVesselCode,
  normalizeVesselName,
  pickPreferredVesselDisplayName,
  shouldAutoMergeVesselNames,
  shouldReviewVesselNamePair,
  uppercaseText,
  vesselNameSimilarity,
} from '../utils/vesselNameNormalize';

export interface MasterVesselCleanupMergedGroup {
  normalizedName: string;
  survivorCode: string;
  survivorName: string;
  absorbedCodes: string[];
}

export interface MasterVesselCleanupReviewItem {
  nameA: string;
  nameB: string;
  codeA: string;
  codeB: string;
  similarity: number;
  reason: string;
}

export interface MasterVesselCleanupStats {
  mergedGroups: number;
  aliasesAdded: number;
  deletedRows: number;
  sapAliasesLinked: number;
  namesUpdated: number;
  normsBackfilled: number;
  shipmentsRelinked: number;
  merged: MasterVesselCleanupMergedGroup[];
  reviewQueue: MasterVesselCleanupReviewItem[];
  dryRun: boolean;
}

interface MasterRow {
  id: string;
  vessel_code: string;
  vessel_name: string;
  normalized_vessel_name: string;
  code_status: string;
  updated_at: string;
}

type QueryFn = (
  text: string,
  params?: unknown[],
) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;

function survivorScore(row: MasterRow): number {
  let score = 0;
  if (row.code_status === 'OFFICIAL' && !isProvisionalVesselCode(row.vessel_code)) score += 100;
  if (/^(BG|MT)\./i.test(row.vessel_name.trim())) score += 20;
  if (row.vessel_name.length > 10) score += 10;
  return score;
}

export function pickSurvivor(rows: MasterRow[]): MasterRow {
  return rows.slice().sort((a, b) => {
    const diff = survivorScore(b) - survivorScore(a);
    if (diff !== 0) return diff;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  })[0];
}

function lookupGoldenName(rows: MasterRow[], goldenNames: Map<string, string>): string | undefined {
  for (const row of rows) {
    const norm = normalizeVesselName(row.vessel_name);
    if (norm && goldenNames.has(norm)) return goldenNames.get(norm);
  }
  for (const row of rows) {
    const norm = normalizeVesselName(row.vessel_name);
    if (!norm) continue;
    for (const [gNorm, gName] of goldenNames) {
      if (shouldAutoMergeVesselNames(norm, gNorm)) return gName;
    }
  }
  return undefined;
}

function pickDisplayName(rows: MasterRow[], goldenNames: Map<string, string>): string {
  const golden = lookupGoldenName(rows, goldenNames);
  if (golden) return uppercaseText(golden) ?? golden;
  return rows
    .reduce((best, r) => {
      const preferred = pickPreferredVesselDisplayName(best, r.vessel_name);
      return preferred.length >= best.length ? preferred : best;
    }, rows[0].vessel_name)
    .toUpperCase();
}

export function groupMasterRowsByNormalizedName(rows: MasterRow[]): Map<string, MasterRow[]> {
  const groups = new Map<string, MasterRow[]>();
  for (const row of rows) {
    const norm = normalizeVesselName(row.vessel_name) || row.normalized_vessel_name;
    if (!norm) continue;
    const list = groups.get(norm) ?? [];
    list.push(row);
    groups.set(norm, list);
  }
  return groups;
}

async function ensureAlias(
  run: QueryFn,
  masterVesselId: string,
  code: string,
  source: string,
  isPrimary: boolean,
  dryRun: boolean,
  stealExisting = true,
): Promise<boolean> {
  if (!code || isMissingVesselCode(code)) return false;
  if (dryRun) return true;
  if (!stealExisting) {
    const result = await run(
      `INSERT INTO master_vessel_code_aliases (master_vessel_id, vessel_code, source, is_primary)
       VALUES ($1, upper(trim($2)), $3, $4)
       ON CONFLICT (vessel_code) DO NOTHING
       RETURNING xmax = 0 AS inserted`,
      [masterVesselId, code, source, isPrimary],
    );
    return Boolean(result.rows[0]?.inserted);
  }
  await run(
    `INSERT INTO master_vessel_code_aliases (master_vessel_id, vessel_code, source, is_primary)
     VALUES ($1, upper(trim($2)), $3, $4)
     ON CONFLICT (vessel_code) DO UPDATE SET
       master_vessel_id = EXCLUDED.master_vessel_id,
       source = CASE WHEN master_vessel_code_aliases.is_primary THEN master_vessel_code_aliases.source ELSE EXCLUDED.source END,
       updated_at = CURRENT_TIMESTAMP`,
    [masterVesselId, code, source, isPrimary],
  );
  return true;
}

async function absorbDuplicate(
  run: QueryFn,
  survivor: MasterRow,
  dup: MasterRow,
  dryRun: boolean,
): Promise<number> {
  if (dryRun) return 1;

  await run(
    `UPDATE master_vessel_code_aliases
     SET master_vessel_id = $1, updated_at = CURRENT_TIMESTAMP
     WHERE master_vessel_id = $2`,
    [survivor.id, dup.id],
  );

  const added = (await ensureAlias(run, survivor.id, dup.vessel_code, 'excel_cleanup', false, false))
    ? 1
    : 0;

  await run(
    `UPDATE shipments
     SET master_vessel_id = $1, updated_at = CURRENT_TIMESTAMP
     WHERE master_vessel_id = $2
        OR (NULLIF(trim(vessel_code), '') IS NOT NULL AND upper(trim(vessel_code)) = upper(trim($3)))`,
    [survivor.id, dup.id, dup.vessel_code],
  );

  await run(`DELETE FROM master_vessels WHERE id = $1`, [dup.id]);
  return added;
}

/**
 * Merge duplicate master_vessels by strengthened normalized name, attach SAP codes as aliases,
 * and auto-merge safe fuzzy pairs (same hull + token containment / ≥90% similar).
 */
export async function runMasterVesselCleanup(
  options: {
    dryRun?: boolean;
    client?: PoolClient;
    goldenNames?: Map<string, string>;
  } = {},
): Promise<MasterVesselCleanupStats> {
  const dryRun = options.dryRun ?? false;
  const run: QueryFn = options.client ? options.client.query.bind(options.client) : query;
  const goldenNames = options.goldenNames ?? new Map<string, string>();

  const stats: MasterVesselCleanupStats = {
    mergedGroups: 0,
    aliasesAdded: 0,
    deletedRows: 0,
    sapAliasesLinked: 0,
    namesUpdated: 0,
    normsBackfilled: 0,
    shipmentsRelinked: 0,
    merged: [],
    reviewQueue: [],
    dryRun,
  };

  const loadRows = async (): Promise<MasterRow[]> => {
    const result = await run(
      `SELECT id, vessel_code, vessel_name, normalized_vessel_name, code_status, updated_at
       FROM master_vessels`,
    );
    return result.rows as unknown as MasterRow[];
  };

  const mergeGroup = async (groupRows: MasterRow[]): Promise<MasterRow> => {
    const survivor = pickSurvivor(groupRows);
    const duplicates = groupRows.filter((r) => r.id !== survivor.id);
    const displayName = pickDisplayName(groupRows, goldenNames);
    const nextNorm = normalizeVesselName(displayName) || normalizeVesselName(survivor.vessel_name);

    if (duplicates.length > 0) {
      stats.mergedGroups += 1;
      stats.merged.push({
        normalizedName: nextNorm,
        survivorCode: survivor.vessel_code,
        survivorName: displayName,
        absorbedCodes: duplicates.map((d) => d.vessel_code),
      });
    }

    for (const dup of duplicates) {
      stats.aliasesAdded += await absorbDuplicate(run, survivor, dup, dryRun);
      stats.deletedRows += 1;
    }

    if (!dryRun && nextNorm) {
      await ensureAlias(run, survivor.id, survivor.vessel_code, 'db_existing', true, false);
      await run(
        `UPDATE master_vessels SET
           vessel_name = $1,
           normalized_vessel_name = $2,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [displayName, nextNorm, survivor.id],
      );
    }

    if (uppercaseText(survivor.vessel_name) !== displayName) stats.namesUpdated += 1;
    if (survivor.normalized_vessel_name !== nextNorm) stats.normsBackfilled += 1;

    return {
      ...survivor,
      vessel_name: displayName,
      normalized_vessel_name: nextNorm,
    };
  };

  let rows = await loadRows();
  const exactGroups = groupMasterRowsByNormalizedName(rows);
  const survivors: MasterRow[] = [];

  for (const groupRows of exactGroups.values()) {
    survivors.push(await mergeGroup(groupRows));
  }

  rows = dryRun ? survivors : await loadRows();

  const seenFuzzy = new Set<string>();
  const pendingFuzzy: Array<[MasterRow, MasterRow]> = [];

  for (let i = 0; i < rows.length; i += 1) {
    const aNorm = normalizeVesselName(rows[i].vessel_name);
    if (!aNorm) continue;
    for (let j = i + 1; j < rows.length; j += 1) {
      const bNorm = normalizeVesselName(rows[j].vessel_name);
      if (!bNorm || aNorm === bNorm) continue;
      const key = [rows[i].id, rows[j].id].sort().join(':');
      if (seenFuzzy.has(key)) continue;

      if (shouldAutoMergeVesselNames(aNorm, bNorm)) {
        seenFuzzy.add(key);
        pendingFuzzy.push([rows[i], rows[j]]);
        continue;
      }

      if (shouldReviewVesselNamePair(aNorm, bNorm)) {
        seenFuzzy.add(key);
        const hullA = extractVesselHullKey(aNorm);
        const hullB = extractVesselHullKey(bNorm);
        stats.reviewQueue.push({
          nameA: rows[i].vessel_name,
          nameB: rows[j].vessel_name,
          codeA: rows[i].vessel_code,
          codeB: rows[j].vessel_code,
          similarity: Math.round(vesselNameSimilarity(aNorm, bNorm) * 1000) / 1000,
          reason:
            hullA && hullB && hullA !== hullB
              ? `similar names but different hull (${hullA} vs ${hullB})`
              : 'similar names without a shared hull number',
        });
      }
    }
  }

  stats.reviewQueue = stats.reviewQueue
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 50);

  const absorbed = new Set<string>();
  for (const [a, b] of pendingFuzzy) {
    if (absorbed.has(a.id) || absorbed.has(b.id)) continue;
    const survivor = await mergeGroup([a, b]);
    const dup = survivor.id === a.id ? b : a;
    absorbed.add(dup.id);
  }

  const sapPairs = await run(
    `SELECT DISTINCT
       upper(trim(COALESCE(
         NULLIF(trim(data->'shipment'->>'vessel_code'), ''),
         NULLIF(trim(data->'raw'->>'Vessel Code'), '')
       ))) AS vessel_code,
       COALESCE(
         NULLIF(trim(data->'shipment'->>'vessel_name'), ''),
         NULLIF(trim(data->'raw'->>'Vessel Name'), '')
       ) AS vessel_name
     FROM sap_processed_data
     WHERE NULLIF(trim(COALESCE(
       data->'shipment'->>'vessel_code',
       data->'raw'->>'Vessel Code'
     )), '') IS NOT NULL
       AND NULLIF(trim(COALESCE(
         data->'shipment'->>'vessel_name',
         data->'raw'->>'Vessel Name'
       )), '') IS NOT NULL`,
  );

  const masters = dryRun ? survivors.filter((r) => !absorbed.has(r.id)) : await loadRows();
  const byNorm = new Map<string, MasterRow>();
  const byCode = new Map<string, MasterRow>();
  for (const row of masters) {
    const norm = normalizeVesselName(row.vessel_name);
    if (norm && !byNorm.has(norm)) byNorm.set(norm, row);
    byCode.set(row.vessel_code.toUpperCase(), row);
  }

  const aliasRows = await run(`SELECT vessel_code, master_vessel_id FROM master_vessel_code_aliases`);
  const aliasToMaster = new Map<string, string>();
  for (const a of aliasRows.rows as Array<{ vessel_code: string; master_vessel_id: string }>) {
    aliasToMaster.set(String(a.vessel_code).toUpperCase(), String(a.master_vessel_id));
  }

  for (const pair of sapPairs.rows as Array<{ vessel_code: string; vessel_name: string }>) {
    const code = uppercaseText(pair.vessel_code);
    const sapName = pair.vessel_name;
    if (!code || isMissingVesselCode(code)) continue;
    const norm = normalizeVesselName(sapName);
    if (!norm) continue;

    let master =
      byCode.get(code) ??
      masters.find((m) => m.id === aliasToMaster.get(code)) ??
      byNorm.get(norm);

    if (master) {
      const existingNorm = normalizeVesselName(master.vessel_name);
      const compatible =
        existingNorm === norm || (existingNorm ? shouldAutoMergeVesselNames(norm, existingNorm) : false);
      if (!compatible) {
        master = undefined;
      }
    }

    if (!master) {
      let best: MasterRow | undefined;
      let bestScore = -1;
      for (const candidate of masters) {
        const cNorm = normalizeVesselName(candidate.vessel_name);
        if (!cNorm || !shouldAutoMergeVesselNames(norm, cNorm)) continue;
        const score = (cNorm === norm ? 2 : 0) + vesselNameSimilarity(norm, cNorm);
        if (score > bestScore) {
          best = candidate;
          bestScore = score;
        }
      }
      master = best;
    }

    if (!master) continue;
    if (master.vessel_code.toUpperCase() === code) continue;
    if (aliasToMaster.get(code) === master.id) continue;

    const stealExisting = aliasToMaster.has(code) && aliasToMaster.get(code) !== master.id;
    if (await ensureAlias(run, master.id, code, 'sap_import', false, dryRun, stealExisting)) {
      stats.sapAliasesLinked += 1;
      aliasToMaster.set(code, master.id);
    }
  }

  if (!dryRun) {
    const byCodeRelink = await run(
      `UPDATE shipments s
       SET master_vessel_id = a.master_vessel_id, updated_at = CURRENT_TIMESTAMP
       FROM master_vessel_code_aliases a
       WHERE NULLIF(trim(s.vessel_code), '') IS NOT NULL
         AND upper(trim(s.vessel_code)) = upper(trim(a.vessel_code))
         AND s.master_vessel_id IS DISTINCT FROM a.master_vessel_id`,
    );
    const byNameRelink = await run(
      `UPDATE shipments s
       SET master_vessel_id = mv.id, updated_at = CURRENT_TIMESTAMP
       FROM master_vessels mv
       WHERE s.master_vessel_id IS NULL
         AND NULLIF(trim(s.vessel_name), '') IS NOT NULL
         AND mv.normalized_vessel_name = normalize_vessel_name(s.vessel_name)`,
    );
    stats.shipmentsRelinked = (byCodeRelink.rowCount ?? 0) + (byNameRelink.rowCount ?? 0);
  }

  return stats;
}
