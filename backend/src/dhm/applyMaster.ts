import { query } from '../database/connection';
import { dhmDataName, dhmRefCode } from './mapper';
import { asDhmUuid, persistMasterReplica, rememberDhmOrganization, replicaCode } from './masterReplica';
import type { DhmRecord } from './types';

export const DHM_MASTER_SLUGS = [
  'company',
  'organization',
  'site',
  'port_master',
  'commodity',
  'incoterm',
  'shipper',
  'external_party',
] as const;
export type DhmMasterSlug = (typeof DHM_MASTER_SLUGS)[number];

function isMasterSlug(slug: string): slug is DhmMasterSlug {
  return (DHM_MASTER_SLUGS as readonly string[]).includes(slug);
}

async function findId(sql: string, params: unknown[]): Promise<string | null> {
  const result = await query(sql, params);
  return result.rows[0]?.id ? String(result.rows[0].id) : null;
}

async function applyCommodity(record: DhmRecord): Promise<void> {
  const name = dhmDataName(record.data);
  const code = replicaCode(record, null);
  const dhmId = asDhmUuid(record.id);
  const existing =
    (dhmId && (await findId(`SELECT id FROM products WHERE dhm_id = $1::uuid LIMIT 1`, [dhmId]))) ||
    (code && (await findId(`SELECT id FROM products WHERE code_dhm = $1 LIMIT 1`, [code]))) ||
    (name && (await findId(`SELECT id FROM products WHERE upper(trim(product_name)) = upper(trim($1)) LIMIT 1`, [name])));
  if (existing) {
    if (name) {
      await query(`UPDATE products SET product_name = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND upper(trim(product_name)) <> upper(trim($2))`, [
        existing,
        name,
      ]);
    }
    await persistMasterReplica('products', existing, record, code);
    return;
  }
  if (!name) return;
  const inserted = await query(
    `INSERT INTO products (product_name, code_dhm, dhm_id, dhm_version, dhm_updated_at, dhm_is_deleted, dhm_payload)
     VALUES ($1, $2, $3::uuid, $4, $5::timestamptz, $6, $7::jsonb)
     ON CONFLICT (product_name) DO UPDATE SET
       code_dhm = COALESCE(EXCLUDED.code_dhm, products.code_dhm),
       dhm_id = COALESCE(EXCLUDED.dhm_id, products.dhm_id),
       dhm_version = EXCLUDED.dhm_version,
       dhm_updated_at = EXCLUDED.dhm_updated_at,
       dhm_is_deleted = EXCLUDED.dhm_is_deleted,
       dhm_payload = EXCLUDED.dhm_payload,
       updated_at = CURRENT_TIMESTAMP
     RETURNING id`,
    [name, code, dhmId, record.version || null, record.updatedAt || null, record.isDeleted, JSON.stringify(record.data ?? {})],
  );
  if (inserted.rows[0]?.id) await persistMasterReplica('products', String(inserted.rows[0].id), record, code);
}

async function applyIncoterm(record: DhmRecord): Promise<void> {
  const name = dhmDataName(record.data);
  const code = replicaCode(record, null);
  const dhmId = asDhmUuid(record.id);
  const existing =
    (dhmId &&
      (await findId(`SELECT id FROM master_reference_items WHERE kind = 'incoterm' AND dhm_id = $1::uuid LIMIT 1`, [dhmId]))) ||
    (code &&
      (await findId(`SELECT id FROM master_reference_items WHERE kind = 'incoterm' AND code_dhm = $1 LIMIT 1`, [code]))) ||
    (name &&
      (await findId(
        `SELECT id FROM master_reference_items WHERE kind = 'incoterm' AND upper(trim(value_1)) = upper(trim($1)) LIMIT 1`,
        [name],
      )));
  if (existing) {
    if (name) {
      await query(`UPDATE master_reference_items SET value_1 = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [existing, name]);
    }
    await persistMasterReplica('master_reference_items', existing, record, code);
    return;
  }
  if (!name) return;
  const inserted = await query(
    `INSERT INTO master_reference_items (kind, code_klip, code_dhm, value_1, dhm_id, dhm_version, dhm_updated_at, dhm_is_deleted, dhm_payload)
     VALUES ('incoterm', 'KINC-' || lpad(nextval('master_incoterm_klip_code_seq')::text, 4, '0'), $1, $2, $3::uuid, $4, $5::timestamptz, $6, $7::jsonb)
     RETURNING id`,
    [code, name, dhmId, record.version || null, record.updatedAt || null, record.isDeleted, JSON.stringify(record.data ?? {})],
  );
  if (inserted.rows[0]?.id) {
    await persistMasterReplica('master_reference_items', String(inserted.rows[0].id), record, code);
  }
}

async function applyShipper(record: DhmRecord): Promise<void> {
  const name = dhmDataName(record.data);
  const code = replicaCode(record, null);
  const dhmId = asDhmUuid(record.id);
  const existing =
    (dhmId &&
      (await findId(`SELECT id FROM master_reference_items WHERE kind = 'ext_company' AND dhm_id = $1::uuid LIMIT 1`, [dhmId]))) ||
    (code &&
      (await findId(`SELECT id FROM master_reference_items WHERE kind = 'ext_company' AND code_dhm = $1 LIMIT 1`, [code]))) ||
    (name &&
      (await findId(
        `SELECT id FROM master_reference_items
         WHERE kind = 'ext_company' AND upper(trim(value_3)) = upper(trim($1))
         ORDER BY code_dhm NULLS FIRST, updated_at DESC
         LIMIT 1`,
        [name],
      )));
  if (existing) {
    if (name) {
      await query(`UPDATE master_reference_items SET value_3 = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [existing, name]);
    }
    await persistMasterReplica('master_reference_items', existing, record, code);
    return;
  }
  if (!name) return;
  const inserted = await query(
    `INSERT INTO master_reference_items (kind, code_klip, code_dhm, value_1, value_3, dhm_id, dhm_version, dhm_updated_at, dhm_is_deleted, dhm_payload)
     VALUES ('ext_company', 'KEXT-' || lpad(nextval('master_ext_company_klip_code_seq')::text, 4, '0'), $1, '', $2, $3::uuid, $4, $5::timestamptz, $6, $7::jsonb)
     RETURNING id`,
    [code, name, dhmId, record.version || null, record.updatedAt || null, record.isDeleted, JSON.stringify(record.data ?? {})],
  );
  if (inserted.rows[0]?.id) {
    await persistMasterReplica('master_reference_items', String(inserted.rows[0].id), record, code);
  }
}

async function orgNameForRef(ref: string | null): Promise<{ code: string | null; name: string | null }> {
  if (!ref) return { code: null, name: null };
  const id = asDhmUuid(ref);
  const result = await query(
    `SELECT dhm_code, name FROM dhm_organizations
     WHERE ($1::uuid IS NOT NULL AND dhm_id = $1::uuid) OR dhm_code = $2
     LIMIT 1`,
    [id, ref],
  );
  const row = result.rows[0];
  return {
    code: row?.dhm_code ? String(row.dhm_code) : id ? null : ref,
    name: row?.name ? String(row.name) : null,
  };
}

async function applySite(record: DhmRecord): Promise<void> {
  const name = dhmDataName(record.data);
  const code = replicaCode(record, null);
  const dhmId = asDhmUuid(record.id);
  const org = await orgNameForRef(dhmRefCode(record.data?.company_id) || dhmRefCode(record.data?.organization_id));
  const existing =
    (dhmId && (await findId(`SELECT id FROM master_plants WHERE dhm_id = $1::uuid LIMIT 1`, [dhmId]))) ||
    (code && (await findId(`SELECT id FROM master_plants WHERE code_dhm = $1 LIMIT 1`, [code]))) ||
    (name &&
      (await findId(
        `SELECT id FROM master_plants
         WHERE code_dhm IS NULL
           AND (upper(trim(plant_name)) = upper(trim($1)) OR upper(trim(plant_code)) = upper(trim($1)))
         ORDER BY updated_at DESC
         LIMIT 1`,
        [name],
      )));
  if (existing) {
    await query(
      `UPDATE master_plants
       SET plant_name = COALESCE(NULLIF($2, ''), plant_name),
           dhm_org_code = COALESCE($3, dhm_org_code),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [existing, name, org.code],
    );
    await persistMasterReplica('master_plants', existing, record, code);
    return;
  }
  if (!name) return;
  const company = org.name || 'DHM';
  const plantCode = (code || name).slice(0, 150);
  const inserted = await query(
    `INSERT INTO master_plants (company_name, plant_code, plant_name, code_dhm, dhm_org_code, dhm_id, dhm_version, dhm_updated_at, dhm_is_deleted, dhm_payload)
     VALUES ($1, $2, $3, $4, $5, $6::uuid, $7, $8::timestamptz, $9, $10::jsonb)
     ON CONFLICT (company_name, plant_code) DO UPDATE SET
       plant_name = COALESCE(EXCLUDED.plant_name, master_plants.plant_name),
       code_dhm = COALESCE(EXCLUDED.code_dhm, master_plants.code_dhm),
       dhm_org_code = COALESCE(EXCLUDED.dhm_org_code, master_plants.dhm_org_code),
       dhm_id = COALESCE(EXCLUDED.dhm_id, master_plants.dhm_id),
       dhm_version = EXCLUDED.dhm_version,
       dhm_updated_at = EXCLUDED.dhm_updated_at,
       dhm_is_deleted = EXCLUDED.dhm_is_deleted,
       dhm_payload = EXCLUDED.dhm_payload,
       updated_at = CURRENT_TIMESTAMP
     RETURNING id`,
    [company, plantCode, name, code, org.code, dhmId, record.version || null, record.updatedAt || null, record.isDeleted, JSON.stringify(record.data ?? {})],
  );
  if (inserted.rows[0]?.id) await persistMasterReplica('master_plants', String(inserted.rows[0].id), record, code);
}

async function siteCodeForRef(ref: string | null): Promise<string | null> {
  if (!ref) return null;
  const id = asDhmUuid(ref);
  if (!id) return ref;
  const result = await query(`SELECT code_dhm FROM master_plants WHERE dhm_id = $1::uuid LIMIT 1`, [id]);
  return result.rows[0]?.code_dhm ? String(result.rows[0].code_dhm) : null;
}

async function applyPort(record: DhmRecord): Promise<void> {
  const name = dhmDataName(record.data);
  const code = replicaCode(record, null);
  const dhmId = asDhmUuid(record.id);
  const siteCode = await siteCodeForRef(dhmRefCode(record.data?.site_id));
  const existing =
    (dhmId && (await findId(`SELECT id FROM master_loading_ports WHERE dhm_id = $1::uuid LIMIT 1`, [dhmId]))) ||
    (code && (await findId(`SELECT id FROM master_loading_ports WHERE code_dhm = $1 LIMIT 1`, [code]))) ||
    (name &&
      (await findId(`SELECT id FROM master_loading_ports WHERE upper(trim(port)) = upper(trim($1)) LIMIT 1`, [name])));
  if (existing) {
    await query(
      `UPDATE master_loading_ports
       SET port = COALESCE(NULLIF($2, ''), port),
           dhm_site_code = COALESCE($3, dhm_site_code),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [existing, name, siteCode],
    );
    await persistMasterReplica('master_loading_ports', existing, record, code);
    return;
  }
  if (!name) return;
  const inserted = await query(
    `INSERT INTO master_loading_ports (port, code_dhm, dhm_site_code, dhm_id, dhm_version, dhm_updated_at, dhm_is_deleted, dhm_payload)
     VALUES ($1, $2, $3, $4::uuid, $5, $6::timestamptz, $7, $8::jsonb)
     RETURNING id`,
    [name, code, siteCode, dhmId, record.version || null, record.updatedAt || null, record.isDeleted, JSON.stringify(record.data ?? {})],
  );
  if (inserted.rows[0]?.id) {
    await persistMasterReplica('master_loading_ports', String(inserted.rows[0].id), record, code);
  }
}

export async function applyDhmMasterRecord(slug: string, record: DhmRecord): Promise<boolean> {
  if (!isMasterSlug(slug)) return false;
  if (slug === 'company' || slug === 'organization') {
    const name = dhmDataName(record.data);
    if (name) await rememberDhmOrganization(record, replicaCode(record, null), name);
    return true;
  }
  if (slug === 'site') await applySite(record);
  else if (slug === 'port_master') await applyPort(record);
  else if (slug === 'commodity') await applyCommodity(record);
  else if (slug === 'incoterm') await applyIncoterm(record);
  else if (slug === 'shipper' || slug === 'external_party') await applyShipper(record);
  return true;
}

export async function markDhmMasterDeleted(slug: string, recordId: string, version: number | null): Promise<boolean> {
  if (!isMasterSlug(slug)) return false;
  const id = asDhmUuid(recordId);
  if (!id) return true;
  if (slug === 'company' || slug === 'organization') {
    await query(
      `UPDATE dhm_organizations
       SET dhm_is_deleted = true, dhm_version = COALESCE($2, dhm_version), updated_at = CURRENT_TIMESTAMP
       WHERE dhm_id = $1::uuid`,
      [id, version],
    );
    return true;
  }
  const table =
    slug === 'site'
      ? 'master_plants'
      : slug === 'port_master'
        ? 'master_loading_ports'
        : slug === 'commodity'
          ? 'products'
          : 'master_reference_items';
  const kindSql =
    slug === 'incoterm' ? ` AND kind = 'incoterm'` : slug === 'shipper' || slug === 'external_party' ? ` AND kind = 'ext_company'` : '';
  await query(
    `UPDATE ${table}
     SET dhm_is_deleted = true, dhm_version = COALESCE($2, dhm_version), updated_at = CURRENT_TIMESTAMP
     WHERE dhm_id = $1::uuid${kindSql}`,
    [id, version],
  );
  return true;
}
