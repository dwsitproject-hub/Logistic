import { query } from '../database/connection';
import { dhmRecordCode } from './mapper';
import type { DhmRecord } from './types';

export type DhmReplicaTable =
  | 'products'
  | 'master_loading_ports'
  | 'master_plants'
  | 'master_sites'
  | 'master_companies'
  | 'master_reference_items';

const REPLICA_TABLES = new Set<DhmReplicaTable>([
  'products',
  'master_loading_ports',
  'master_plants',
  'master_sites',
  'master_companies',
  'master_reference_items',
]);

export function asDhmUuid(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

export function replicaCode(record: DhmRecord, envelopeCode?: string | null): string | null {
  return dhmRecordCode(record) || String(envelopeCode || '').trim() || null;
}

export async function persistMasterReplica(
  table: DhmReplicaTable,
  localId: string,
  record: DhmRecord,
  envelopeCode?: string | null,
): Promise<void> {
  if (!REPLICA_TABLES.has(table)) return;
  const code = replicaCode(record, envelopeCode);
  const payload = { ...(record.data ?? {}) };
  if (code && payload.code == null) payload.code = code;
  await query(
    `UPDATE ${table}
     SET dhm_id = COALESCE($2::uuid, dhm_id),
         code_dhm = COALESCE($3, code_dhm),
         dhm_version = COALESCE($4, dhm_version),
         dhm_updated_at = COALESCE($5::timestamptz, dhm_updated_at),
         dhm_is_deleted = $6,
         dhm_payload = $7::jsonb,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1::uuid`,
    [
      localId,
      asDhmUuid(record.id),
      code,
      record.version || null,
      record.updatedAt || null,
      record.isDeleted,
      JSON.stringify(payload),
    ],
  );
}

export async function rememberDhmOrganization(
  record: DhmRecord,
  envelopeCode: string | null,
  name: string,
): Promise<string | null> {
  const code = replicaCode(record, envelopeCode);
  const label = String(name || '').trim();
  if (!code || !label) return code;
  const dhmId = asDhmUuid(record.id);
  const existing = await query(
    `SELECT id FROM dhm_organizations
     WHERE ($1::uuid IS NOT NULL AND dhm_id = $1::uuid)
        OR dhm_code = $2
     LIMIT 1`,
    [dhmId, code],
  );
  const params = [
    dhmId,
    code,
    label,
    record.version || null,
    record.updatedAt || null,
    record.isDeleted,
    JSON.stringify(record.data ?? {}),
  ];
  if (existing.rows[0]?.id) {
    await query(
      `UPDATE dhm_organizations
       SET dhm_id = COALESCE($2::uuid, dhm_id),
           dhm_code = COALESCE($3, dhm_code),
           name = $4,
           dhm_version = COALESCE($5, dhm_version),
           dhm_updated_at = COALESCE($6::timestamptz, dhm_updated_at),
           dhm_is_deleted = $7,
           dhm_payload = $8::jsonb,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [existing.rows[0].id, ...params],
    );
  } else {
    await query(
      `INSERT INTO dhm_organizations (
         dhm_id, dhm_code, name, dhm_version, dhm_updated_at, dhm_is_deleted, dhm_payload
       ) VALUES ($1::uuid, $2, $3, $4, $5::timestamptz, $6, $7::jsonb)`,
      params,
    );
  }
  await query(
    `UPDATE master_plants
     SET dhm_org_code = $1, updated_at = CURRENT_TIMESTAMP
     WHERE upper(trim(company_name)) = upper(trim($2))
       AND COALESCE(dhm_org_code, '') <> $1`,
    [code, label],
  );
  return code;
}

export async function findSiblingOrgCode(companyName: string, exceptId?: string): Promise<string | null> {
  const result = await query(
    `SELECT dhm_org_code
     FROM master_plants
     WHERE upper(trim(company_name)) = upper(trim($1))
       AND dhm_org_code IS NOT NULL
       AND ($2::uuid IS NULL OR id <> $2::uuid)
     LIMIT 1`,
    [companyName, exceptId || null],
  );
  const code = result.rows[0]?.dhm_org_code;
  return code != null ? String(code).trim() || null : null;
}
