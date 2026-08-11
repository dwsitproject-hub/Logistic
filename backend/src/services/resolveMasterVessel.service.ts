import type { PoolClient } from 'pg';
import { query } from '../database/connection';
import {
  buildProvisionalVesselCode,
  isProvisionalVesselCode,
} from '../utils/masterVesselCodeResolve';
import { isMissingVesselCode, normalizeVesselName, pickPreferredVesselDisplayName, uppercaseText } from '../utils/vesselNameNormalize';

export type VesselAliasSource =
  | 'sap_import'
  | 'jovin'
  | 'klip_sheet'
  | 'manual'
  | 'db_existing'
  | 'merge_script';

export interface ResolveMasterVesselInput {
  vessel_code?: string | null;
  vessel_name?: string | null;
  vessel_owner?: string | null;
  source?: VesselAliasSource;
  /** When true, update master attributes from input */
  updateAttributes?: boolean;
  vessel_capacity_mt?: number | null;
  vessel_type?: string | null;
  sap_vendor_code?: string | null;
  heating?: boolean | null;
  lambung_type?: string | null;
  terms?: string | null;
  code_status?: 'OFFICIAL' | 'PROVISIONAL';
}

export interface ResolvedMasterVessel {
  master_vessel_id: string;
  vessel_code: string;
  vessel_name: string;
  normalized_vessel_name: string;
  created: boolean;
  alias_added: boolean;
}

type QueryFn = (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

async function findMasterByAliasCode(
  run: QueryFn,
  code: string,
): Promise<{ id: string; vessel_code: string; vessel_name: string; normalized_vessel_name: string } | null> {
  const result = await run(
    `SELECT mv.id, mv.vessel_code, mv.vessel_name, mv.normalized_vessel_name
     FROM master_vessel_code_aliases a
     INNER JOIN master_vessels mv ON mv.id = a.master_vessel_id
     WHERE upper(trim(a.vessel_code)) = upper(trim($1))
     LIMIT 1`,
    [code],
  );
  return (result.rows[0] as typeof result.rows[0] & {
    id: string;
    vessel_code: string;
    vessel_name: string;
    normalized_vessel_name: string;
  }) ?? null;
}

async function findMasterByPrimaryCode(
  run: QueryFn,
  code: string,
): Promise<{ id: string; vessel_code: string; vessel_name: string; normalized_vessel_name: string } | null> {
  const result = await run(
    `SELECT id, vessel_code, vessel_name, normalized_vessel_name
     FROM master_vessels
     WHERE upper(trim(vessel_code)) = upper(trim($1))
     LIMIT 1`,
    [code],
  );
  return (result.rows[0] as {
    id: string;
    vessel_code: string;
    vessel_name: string;
    normalized_vessel_name: string;
  }) ?? null;
}

async function findMasterByNormName(
  run: QueryFn,
  norm: string,
): Promise<{ id: string; vessel_code: string; vessel_name: string; normalized_vessel_name: string; code_status: string } | null> {
  const result = await run(
    `SELECT id, vessel_code, vessel_name, normalized_vessel_name, code_status
     FROM master_vessels
     WHERE normalized_vessel_name = $1
     ORDER BY CASE WHEN code_status = 'OFFICIAL' THEN 0 ELSE 1 END, updated_at DESC
     LIMIT 1`,
    [norm],
  );
  return (result.rows[0] as {
    id: string;
    vessel_code: string;
    vessel_name: string;
    normalized_vessel_name: string;
    code_status: string;
  }) ?? null;
}

async function ensureAlias(
  run: QueryFn,
  masterVesselId: string,
  code: string,
  source: VesselAliasSource,
  isPrimary: boolean,
): Promise<boolean> {
  const result = await run(
    `INSERT INTO master_vessel_code_aliases (master_vessel_id, vessel_code, source, is_primary)
     VALUES ($1, upper(trim($2)), $3, $4)
     ON CONFLICT (vessel_code) DO UPDATE SET
       master_vessel_id = EXCLUDED.master_vessel_id,
       source = CASE WHEN master_vessel_code_aliases.is_primary THEN master_vessel_code_aliases.source ELSE EXCLUDED.source END,
       updated_at = CURRENT_TIMESTAMP
     RETURNING xmax = 0 AS inserted`,
    [masterVesselId, code, source, isPrimary],
  );
  return Boolean(result.rows[0]?.inserted);
}

async function updateMasterAttributes(
  run: QueryFn,
  id: string,
  input: ResolveMasterVesselInput,
  vesselName: string,
): Promise<void> {
  if (!input.updateAttributes) return;
  await run(
    `UPDATE master_vessels SET
       vessel_name = COALESCE(NULLIF(trim($2), ''), vessel_name),
       normalized_vessel_name = COALESCE(NULLIF(trim($3), ''), normalized_vessel_name),
       vessel_owner = COALESCE(NULLIF(trim($4), ''), vessel_owner),
       vessel_capacity_mt = COALESCE($5, vessel_capacity_mt),
       vessel_type = COALESCE(NULLIF(trim($6), ''), vessel_type),
       sap_vendor_code = COALESCE(NULLIF(trim($7), ''), sap_vendor_code),
       heating = COALESCE($8, heating),
       lambung_type = COALESCE(NULLIF(trim($9), ''), lambung_type),
       terms = COALESCE(NULLIF(trim($10), ''), terms),
       code_status = CASE
         WHEN $11 = 'OFFICIAL' THEN 'OFFICIAL'
         WHEN code_status = 'PROVISIONAL' THEN 'PROVISIONAL'
         ELSE code_status
       END,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [
      id,
      vesselName,
      normalizeVesselName(vesselName),
      uppercaseText(input.vessel_owner),
      input.vessel_capacity_mt ?? null,
      uppercaseText(input.vessel_type),
      uppercaseText(input.sap_vendor_code),
      input.heating ?? null,
      uppercaseText(input.lambung_type),
      uppercaseText(input.terms),
      input.code_status ?? 'OFFICIAL',
    ],
  );
}

/**
 * Resolve or create canonical master vessel. Multiple SAP codes for the same
 * normalized name map to one master row via master_vessel_code_aliases.
 */
export async function resolveMasterVessel(
  input: ResolveMasterVesselInput,
  client?: PoolClient,
): Promise<ResolvedMasterVessel | null> {
  const run: QueryFn = client ? client.query.bind(client) : query;
  const source = input.source ?? 'manual';

  const vesselName = uppercaseText(input.vessel_name);
  if (!vesselName) return null;

  const norm = normalizeVesselName(vesselName);
  const rawCode = uppercaseText(input.vessel_code);
  const officialCode =
    rawCode && !isMissingVesselCode(rawCode) && !isProvisionalVesselCode(rawCode)
      ? rawCode
      : null;

  const codeStatus =
    input.code_status ??
    (officialCode ? 'OFFICIAL' : 'PROVISIONAL');
  const primaryCode =
    officialCode ??
    (codeStatus === 'PROVISIONAL' ? buildProvisionalVesselCode(norm) : null);

  if (!primaryCode) return null;

  let aliasAdded = false;

  // 1. Lookup by alias code
  if (officialCode) {
    const byAlias = await findMasterByAliasCode(run, officialCode);
    if (byAlias) {
      const displayName = pickPreferredVesselDisplayName(byAlias.vessel_name, vesselName);
      await updateMasterAttributes(run, byAlias.id, input, displayName);
      return {
        master_vessel_id: byAlias.id,
        vessel_code: byAlias.vessel_code,
        vessel_name: displayName,
        normalized_vessel_name: byAlias.normalized_vessel_name,
        created: false,
        alias_added: false,
      };
    }
  }

  // 2. Lookup by primary code on master_vessels
  if (officialCode) {
    const byCode = await findMasterByPrimaryCode(run, officialCode);
    if (byCode) {
      await ensureAlias(run, byCode.id, officialCode, source, true);
      const displayName = pickPreferredVesselDisplayName(byCode.vessel_name, vesselName);
      await updateMasterAttributes(run, byCode.id, input, displayName);
      return {
        master_vessel_id: byCode.id,
        vessel_code: byCode.vessel_code,
        vessel_name: displayName,
        normalized_vessel_name: byCode.normalized_vessel_name,
        created: false,
        alias_added: false,
      };
    }
  }

  // 3. Lookup by normalized name
  const byNorm = await findMasterByNormName(run, norm);
  if (byNorm) {
    if (officialCode && officialCode !== byNorm.vessel_code.toUpperCase()) {
      aliasAdded = await ensureAlias(run, byNorm.id, officialCode, source, false);
    }
    const displayName = pickPreferredVesselDisplayName(byNorm.vessel_name, vesselName);
    await updateMasterAttributes(run, byNorm.id, input, displayName);

    // Promote provisional to official when we get an official code
    if (
      officialCode &&
      (byNorm.code_status === 'PROVISIONAL' || isProvisionalVesselCode(byNorm.vessel_code))
    ) {
      await run(
        `UPDATE master_vessels SET
           vessel_code = $1,
           vessel_name = $2,
           normalized_vessel_name = $3,
           code_status = 'OFFICIAL',
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [officialCode, displayName, norm, byNorm.id],
      );
      await ensureAlias(run, byNorm.id, officialCode, source, true);
      if (byNorm.vessel_code.toUpperCase() !== officialCode) {
        await ensureAlias(run, byNorm.id, byNorm.vessel_code, 'db_existing', false);
      }
      return {
        master_vessel_id: byNorm.id,
        vessel_code: officialCode,
        vessel_name: displayName,
        normalized_vessel_name: norm,
        created: false,
        alias_added: aliasAdded,
      };
    }

    return {
      master_vessel_id: byNorm.id,
      vessel_code: byNorm.vessel_code,
      vessel_name: displayName,
      normalized_vessel_name: byNorm.normalized_vessel_name,
      created: false,
      alias_added: aliasAdded,
    };
  }

  // 4. Create new master + primary alias
  const insertResult = await run(
    `INSERT INTO master_vessels (
       vessel_code, vessel_name, normalized_vessel_name, vessel_owner,
       vessel_capacity_mt, vessel_type, sap_vendor_code, heating, lambung_type, terms, code_status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (vessel_code) DO UPDATE SET
       vessel_name = COALESCE(NULLIF(trim(EXCLUDED.vessel_name), ''), master_vessels.vessel_name),
       normalized_vessel_name = COALESCE(NULLIF(trim(EXCLUDED.normalized_vessel_name), ''), master_vessels.normalized_vessel_name),
       vessel_owner = COALESCE(NULLIF(trim(EXCLUDED.vessel_owner), ''), master_vessels.vessel_owner),
       updated_at = CURRENT_TIMESTAMP
     RETURNING id, vessel_code, vessel_name, normalized_vessel_name, xmax = 0 AS inserted`,
    [
      primaryCode,
      vesselName,
      norm,
      uppercaseText(input.vessel_owner),
      input.vessel_capacity_mt ?? null,
      uppercaseText(input.vessel_type),
      uppercaseText(input.sap_vendor_code),
      input.heating ?? null,
      uppercaseText(input.lambung_type),
      uppercaseText(input.terms),
      codeStatus,
    ],
  );

  const row = insertResult.rows[0] as {
    id: string;
    vessel_code: string;
    vessel_name: string;
    normalized_vessel_name: string;
    inserted: boolean;
  };

  await ensureAlias(run, row.id, row.vessel_code, source, true);

  return {
    master_vessel_id: row.id,
    vessel_code: row.vessel_code,
    vessel_name: row.vessel_name,
    normalized_vessel_name: row.normalized_vessel_name,
    created: Boolean(row.inserted),
    alias_added: false,
  };
}

/** Set shipments.master_vessel_id for rows matching code or normalized name. */
export async function linkShipmentToMasterVessel(
  shipmentId: string,
  input: { vessel_code?: string | null; vessel_name?: string | null },
  client?: PoolClient,
): Promise<string | null> {
  const resolved = await resolveMasterVessel(
    {
      vessel_code: input.vessel_code,
      vessel_name: input.vessel_name,
      source: 'sap_import',
      updateAttributes: false,
    },
    client,
  );
  if (!resolved) return null;

  const run = client ? client.query.bind(client) : query;
  await run(
    `UPDATE shipments SET master_vessel_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [resolved.master_vessel_id, shipmentId],
  );
  return resolved.master_vessel_id;
}
