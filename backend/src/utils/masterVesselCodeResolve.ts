import type { PoolClient } from 'pg';
import { query } from '../database/connection';
import { normalizeVesselName, uppercaseText } from './vesselNameNormalize';

export type MasterVesselCodeStatus = 'OFFICIAL' | 'PROVISIONAL';

export type MasterVesselCodeSource =
  | 'jovin'
  | 'klip_sheet'
  | 'sap_import'
  | 'db_existing'
  | 'provisional';

export interface ResolvedVesselCode {
  vessel_code: string;
  code_status: MasterVesselCodeStatus;
  source: MasterVesselCodeSource;
}

const PROVISIONAL_PREFIX = 'TMP-';
const MAX_CODE_LEN = 50;

export function isProvisionalVesselCode(code: unknown): boolean {
  return String(code ?? '')
    .trim()
    .toUpperCase()
    .startsWith(PROVISIONAL_PREFIX);
}

export function displayVesselCode(row: {
  vessel_code?: string | null;
  code_status?: string | null;
}): string | null {
  const code = String(row.vessel_code ?? '').trim();
  if (!code) return null;
  if (row.code_status === 'PROVISIONAL' || isProvisionalVesselCode(code)) return null;
  return code.toUpperCase();
}

export function buildProvisionalVesselCode(normalizedName: string): string {
  const slug = normalizedName
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, MAX_CODE_LEN - PROVISIONAL_PREFIX.length);
  const base = slug || 'VESSEL';
  const code = `${PROVISIONAL_PREFIX}${base}`;
  return code.slice(0, MAX_CODE_LEN);
}

export function resolveVesselCodeFromMaps(
  vesselName: string,
  jovinCode: unknown,
  klipMap: Map<string, string>,
  sapMap: Map<string, string>,
  dbByNormName: Map<string, { vessel_code: string; code_status?: string | null }>,
): ResolvedVesselCode {
  const norm = normalizeVesselName(vesselName);
  if (!norm) {
    return {
      vessel_code: buildProvisionalVesselCode('UNKNOWN'),
      code_status: 'PROVISIONAL',
      source: 'provisional',
    };
  }

  if (!isMissingVesselCode(jovinCode)) {
    const code = uppercaseText(jovinCode)!;
    return {
      vessel_code: code,
      code_status: isProvisionalVesselCode(code) ? 'PROVISIONAL' : 'OFFICIAL',
      source: 'jovin',
    };
  }

  const klipCode = klipMap.get(norm);
  if (klipCode) {
    return { vessel_code: klipCode.toUpperCase(), code_status: 'OFFICIAL', source: 'klip_sheet' };
  }

  const sapCode = sapMap.get(norm);
  if (sapCode) {
    return { vessel_code: sapCode.toUpperCase(), code_status: 'OFFICIAL', source: 'sap_import' };
  }

  const dbRow = dbByNormName.get(norm);
  if (dbRow?.vessel_code) {
    const code = dbRow.vessel_code.toUpperCase();
    const provisional =
      dbRow.code_status === 'PROVISIONAL' || isProvisionalVesselCode(code);
    return {
      vessel_code: code,
      code_status: provisional ? 'PROVISIONAL' : 'OFFICIAL',
      source: 'db_existing',
    };
  }

  return {
    vessel_code: buildProvisionalVesselCode(norm),
    code_status: 'PROVISIONAL',
    source: 'provisional',
  };
}

function isMissingVesselCode(code: unknown): boolean {
  const s = String(code ?? '').trim();
  if (!s) return true;
  const upper = s.toUpperCase();
  return upper === '#N/A' || upper === 'N/A';
}

export const SQL_SAP_VESSEL_CODE_MAP = `
  SELECT DISTINCT ON (norm_name)
    norm_name,
    upper(trim(vcode)) AS vessel_code
  FROM (
    SELECT
      upper(regexp_replace(regexp_replace(trim(COALESCE(
        NULLIF(trim(data->'shipment'->>'vessel_name'), ''),
        NULLIF(trim(data->'raw'->>'Vessel Name'), '')
      )), '^BG\\.\\s*', '', 'i'), '^MT\\.\\s*', '', 'i')) AS norm_name,
      COALESCE(
        NULLIF(trim(data->'shipment'->>'vessel_code'), ''),
        NULLIF(trim(data->'raw'->>'Vessel Code'), '')
      ) AS vcode
    FROM sap_processed_data
  ) s
  WHERE norm_name IS NOT NULL
    AND norm_name <> ''
    AND NULLIF(trim(vcode), '') IS NOT NULL
  ORDER BY norm_name, vcode
`;

export async function loadSapVesselCodeMap(
  client?: PoolClient,
): Promise<Map<string, string>> {
  const run = client ? client.query.bind(client) : query;
  const result = await run(SQL_SAP_VESSEL_CODE_MAP);
  const map = new Map<string, string>();
  for (const row of result.rows as Array<{ norm_name: string; vessel_code: string }>) {
    if (row.norm_name && row.vessel_code) map.set(row.norm_name, row.vessel_code);
  }
  return map;
}

export interface PromoteProvisionalParams {
  officialCode: string;
  vesselName: string;
  vesselOwner?: string | null;
  source: string;
}

/** Promote provisional row by normalized name to official code, or upsert if none. */
export async function promoteProvisionalVesselByName(
  params: PromoteProvisionalParams,
  client?: PoolClient,
): Promise<'promoted' | 'upserted' | 'skipped'> {
  const run = client ? client.query.bind(client) : query;
  const officialCode = uppercaseText(params.officialCode);
  const vesselName = uppercaseText(params.vesselName);
  if (!officialCode || !vesselName || isProvisionalVesselCode(officialCode)) return 'skipped';

  const norm = normalizeVesselName(vesselName);
  const find = await run(
    `SELECT id, vessel_code, code_status
     FROM master_vessels
     WHERE upper(regexp_replace(regexp_replace(trim(vessel_name), '^BG\\.\\s*', '', 'i'), '^MT\\.\\s*', '', 'i')) = $1
     ORDER BY CASE WHEN code_status = 'PROVISIONAL' THEN 0 ELSE 1 END, updated_at DESC
     LIMIT 1`,
    [norm],
  );
  const existing = find.rows[0] as
    | { id: string; vessel_code: string; code_status: string }
    | undefined;

  if (
    existing &&
    (existing.code_status === 'PROVISIONAL' || isProvisionalVesselCode(existing.vessel_code))
  ) {
    const oldCode = existing.vessel_code;
    await run(
      `UPDATE master_vessels
       SET vessel_code = $1,
           vessel_name = $2,
           normalized_vessel_name = $3,
           vessel_owner = COALESCE($4, vessel_owner),
           code_status = 'OFFICIAL',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5`,
      [officialCode, vesselName, norm, params.vesselOwner ?? null, existing.id],
    );
    await run(
      `UPDATE shipments
       SET vessel_code = $1, updated_at = CURRENT_TIMESTAMP
       WHERE upper(trim(vessel_code)) = upper(trim($2))`,
      [officialCode, oldCode],
    );
    return 'promoted';
  }

  await run(
    `INSERT INTO master_vessels (vessel_code, vessel_name, normalized_vessel_name, vessel_owner, code_status)
     VALUES ($1, $2, $3, $4, 'OFFICIAL')
     ON CONFLICT (vessel_code) DO UPDATE SET
       vessel_name = COALESCE(NULLIF(TRIM(EXCLUDED.vessel_name), ''), master_vessels.vessel_name),
       normalized_vessel_name = COALESCE(NULLIF(TRIM(EXCLUDED.normalized_vessel_name), ''), master_vessels.normalized_vessel_name),
       vessel_owner = COALESCE(NULLIF(TRIM(EXCLUDED.vessel_owner), ''), master_vessels.vessel_owner),
       code_status = 'OFFICIAL',
       updated_at = CURRENT_TIMESTAMP`,
    [officialCode, vesselName, norm, params.vesselOwner ?? null],
  );
  return 'upserted';
}

export function mapMasterVesselForApi<T extends Record<string, unknown>>(row: T): T & {
  vessel_code: string | null;
  vessel_type?: string | null;
} {
  const displayCode = displayVesselCode({
    vessel_code: row.vessel_code as string | null | undefined,
    code_status: row.code_status as string | null | undefined,
  });
  const hullType = row.hull_type as string | null | undefined;
  const vesselType = (row.vessel_type ?? hullType) as string | null | undefined;
  return {
    ...row,
    vessel_code: displayCode,
    vessel_type: vesselType ?? null,
  };
}
