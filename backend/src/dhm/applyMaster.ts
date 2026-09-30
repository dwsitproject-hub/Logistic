import { query } from '../database/connection';
import { dhmDataName, dhmRefCode } from './mapper';
import { asDhmUuid, persistMasterReplica, rememberDhmOrganization, replicaCode } from './masterReplica';
import type { DhmRecord } from './types';

export const DHM_MASTER_SLUGS = [
  'company',
  'organization',
  'site',
  'plant',
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

function commodityText(data: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = data?.[key];
  const text = value != null ? String(value).trim() : '';
  return text || null;
}

async function applyCommodity(record: DhmRecord): Promise<void> {
  const name = commodityText(record.data, 'short_name') || dhmDataName(record.data);
  const longName = commodityText(record.data, 'long_name');
  const commodityType = commodityText(record.data, 'type');
  const code = replicaCode(record, null);
  const dhmId = asDhmUuid(record.id);
  const existing =
    (dhmId && (await findId(`SELECT id FROM products WHERE dhm_id = $1::uuid LIMIT 1`, [dhmId]))) ||
    (code && (await findId(`SELECT id FROM products WHERE code_dhm = $1 LIMIT 1`, [code]))) ||
    (name && (await findId(`SELECT id FROM products WHERE upper(trim(product_name)) = upper(trim($1)) LIMIT 1`, [name])));
  if (existing) {
    await query(
      `UPDATE products
       SET product_name = COALESCE($2, product_name),
           long_name = COALESCE($3, long_name),
           commodity_type = COALESCE($4, commodity_type),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [existing, name, longName, commodityType],
    );
    await persistMasterReplica('products', existing, record, code);
    return;
  }
  if (!name) return;
  const inserted = await query(
    `INSERT INTO products (product_name, long_name, commodity_type, code_dhm, dhm_id, dhm_version, dhm_updated_at, dhm_is_deleted, dhm_payload)
     VALUES ($1, $2, $3, $4, $5::uuid, $6, $7::timestamptz, $8, $9::jsonb)
     ON CONFLICT (product_name) DO UPDATE SET
       long_name = COALESCE(EXCLUDED.long_name, products.long_name),
       commodity_type = COALESCE(EXCLUDED.commodity_type, products.commodity_type),
       code_dhm = COALESCE(EXCLUDED.code_dhm, products.code_dhm),
       dhm_id = COALESCE(EXCLUDED.dhm_id, products.dhm_id),
       dhm_version = EXCLUDED.dhm_version,
       dhm_updated_at = EXCLUDED.dhm_updated_at,
       dhm_is_deleted = EXCLUDED.dhm_is_deleted,
       dhm_payload = EXCLUDED.dhm_payload,
       updated_at = CURRENT_TIMESTAMP
     RETURNING id`,
    [name, longName, commodityType, code, dhmId, record.version || null, record.updatedAt || null, record.isDeleted, JSON.stringify(record.data ?? {})],
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

async function applyCompany(record: DhmRecord): Promise<void> {
  const name = dhmDataName(record.data);
  const code = replicaCode(record, null);
  const sap = commodityText(record.data, 'short_name');
  const dhmId = asDhmUuid(record.id);
  const existing =
    (dhmId && (await findId(`SELECT id FROM master_companies WHERE dhm_id = $1::uuid LIMIT 1`, [dhmId]))) ||
    (code && (await findId(`SELECT id FROM master_companies WHERE code_dhm = $1 LIMIT 1`, [code]))) ||
    (sap &&
      (await findId(
        `SELECT id FROM master_companies WHERE upper(trim(company_code)) = upper(trim($1)) LIMIT 1`,
        [sap],
      ))) ||
    (name &&
      (await findId(
        `SELECT id FROM master_companies WHERE upper(trim(company_name)) = upper(trim($1)) LIMIT 1`,
        [name],
      )));
  let id = existing;
  if (id) {
    if (name || sap) {
      await query(
        `UPDATE master_companies
         SET company_name = COALESCE($2, company_name),
             company_code = COALESCE($3, company_code),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [id, name, sap],
      );
    }
    await persistMasterReplica('master_companies', id, record, code);
  } else if (name) {
    const inserted = await query(
      `INSERT INTO master_companies (company_code, company_name, code_dhm, dhm_id, dhm_version, dhm_updated_at, dhm_is_deleted, dhm_payload)
       VALUES ($1, $2, $3, $4::uuid, $5, $6::timestamptz, $7, $8::jsonb)
       RETURNING id`,
      [sap || name, name, code, dhmId, record.version || null, record.updatedAt || null, record.isDeleted, JSON.stringify(record.data ?? {})],
    );
    id = inserted.rows[0]?.id ? String(inserted.rows[0].id) : null;
  }
  if (!id) return;
  const rawSites = record.data?.sites ?? record.data?.Sites;
  if (!Array.isArray(rawSites)) return;
  const codes = rawSites.map((item) => dhmRefCode(item)).filter((item): item is string => Boolean(item));
  if (!codes.length) return;
  await query(`DELETE FROM master_company_sites WHERE company_id = $1::uuid`, [id]);
  await query(
    `INSERT INTO master_company_sites (company_id, site_id)
     SELECT $1::uuid, site.id
     FROM master_sites site
     WHERE site.code_dhm = ANY($2::text[])
     ON CONFLICT DO NOTHING`,
    [id, codes],
  );
}

async function applySite(record: DhmRecord): Promise<void> {
  const name = dhmDataName(record.data);
  const code = replicaCode(record, null);
  const dhmId = asDhmUuid(record.id);
  const existing =
    (dhmId && (await findId(`SELECT id FROM master_sites WHERE dhm_id = $1::uuid LIMIT 1`, [dhmId]))) ||
    (code && (await findId(`SELECT id FROM master_sites WHERE code_dhm = $1 LIMIT 1`, [code]))) ||
    (name &&
      (await findId(`SELECT id FROM master_sites WHERE upper(trim(site_name)) = upper(trim($1)) LIMIT 1`, [name])));
  if (existing) {
    if (name) {
      await query(
        `UPDATE master_sites
         SET site_name = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND upper(trim(site_name)) <> upper(trim($2))`,
        [existing, name],
      );
    }
    await persistMasterReplica('master_sites', existing, record, code);
    return;
  }
  if (!name) return;
  const inserted = await query(
    `INSERT INTO master_sites (site_name, code_dhm, dhm_id, dhm_version, dhm_updated_at, dhm_is_deleted, dhm_payload)
     VALUES ($1, $2, $3::uuid, $4, $5::timestamptz, $6, $7::jsonb)
     ON CONFLICT ((upper(trim(site_name)))) DO UPDATE SET
       code_dhm = COALESCE(EXCLUDED.code_dhm, master_sites.code_dhm),
       dhm_id = COALESCE(EXCLUDED.dhm_id, master_sites.dhm_id),
       dhm_version = EXCLUDED.dhm_version,
       dhm_updated_at = EXCLUDED.dhm_updated_at,
       dhm_is_deleted = EXCLUDED.dhm_is_deleted,
       dhm_payload = EXCLUDED.dhm_payload,
       updated_at = CURRENT_TIMESTAMP
     RETURNING id`,
    [name, code, dhmId, record.version || null, record.updatedAt || null, record.isDeleted, JSON.stringify(record.data ?? {})],
  );
  if (inserted.rows[0]?.id) await persistMasterReplica('master_sites', String(inserted.rows[0].id), record, code);
}

async function applyPlant(record: DhmRecord): Promise<void> {
  const data = record.data ?? {};
  const textBy = (predicates: Array<(key: string) => boolean>): string | null => {
    for (const [key, value] of Object.entries(data)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!predicates.some((predicate) => predicate(normalized))) continue;
      const text = value != null ? String(value).trim() : '';
      if (text) return text;
    }
    return null;
  };
  const name = textBy([(key) => key === 'plantname' || (key.includes('plant') && key.includes('name'))]) || dhmDataName(data);
  const sapCode = textBy([
    (key) => key.includes('sap') && (key.includes('plant') || key.includes('code')),
    (key) => key === 'plantcode',
  ]);
  const plantType = textBy([(key) => key === 'planttype' || (key.includes('plant') && key.includes('type')) || key === 'type']);
  const siteRef = dhmRefCode(data.site_id) || dhmRefCode(data.site);
  const code = replicaCode(record, null);
  const dhmId = asDhmUuid(record.id);
  const siteId = siteRef
    ? await findId(
        `SELECT id FROM master_sites
         WHERE ($1::uuid IS NOT NULL AND dhm_id = $1::uuid) OR code_dhm = $2
         LIMIT 1`,
        [asDhmUuid(siteRef), siteRef],
      )
    : null;
  const existing =
    (dhmId && (await findId(`SELECT id FROM master_plants WHERE dhm_id = $1::uuid LIMIT 1`, [dhmId]))) ||
    (code && (await findId(`SELECT id FROM master_plants WHERE code_dhm = $1 LIMIT 1`, [code]))) ||
    (sapCode && (await findId(`SELECT id FROM master_plants WHERE upper(trim(plant_code)) = upper(trim($1)) LIMIT 1`, [sapCode]))) ||
    (name && (await findId(`SELECT id FROM master_plants WHERE upper(trim(plant_name)) = upper(trim($1)) LIMIT 1`, [name])));
  if (existing) {
    await query(
      `UPDATE master_plants
       SET plant_name = COALESCE($2, plant_name),
           plant_code = COALESCE($3, plant_code),
           plant_type = COALESCE($4, plant_type),
           site_id = COALESCE($5::uuid, site_id),
           site = COALESCE((SELECT site_name FROM master_sites WHERE id = $5::uuid), site),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [existing, name, sapCode, plantType, siteId],
    );
    await persistMasterReplica('master_plants', existing, record, code);
    return;
  }
  if (!name && !sapCode) return;
  const label = name || sapCode || 'DHM';
  const inserted = await query(
    `INSERT INTO master_plants (company_name, plant_code, plant_name, plant_type, site, site_id, code_dhm, dhm_id, dhm_version, dhm_updated_at, dhm_is_deleted, dhm_payload)
     VALUES ($1, $2, $3, $4, (SELECT site_name FROM master_sites WHERE id = $5::uuid), $5::uuid, $6, $7::uuid, $8, $9::timestamptz, $10, $11::jsonb)
     RETURNING id`,
    [label, sapCode || label, name, plantType, siteId, code, dhmId, record.version || null, record.updatedAt || null, record.isDeleted, JSON.stringify(data)],
  );
  if (inserted.rows[0]?.id) await persistMasterReplica('master_plants', String(inserted.rows[0].id), record, code);
}

async function siteCodeForRef(ref: string | null): Promise<string | null> {
  if (!ref) return null;
  const id = asDhmUuid(ref);
  if (!id) return ref;
  const site = await query(`SELECT code_dhm FROM master_sites WHERE dhm_id = $1::uuid LIMIT 1`, [id]);
  if (site.rows[0]?.code_dhm) return String(site.rows[0].code_dhm);
  const plant = await query(`SELECT code_dhm FROM master_plants WHERE dhm_id = $1::uuid LIMIT 1`, [id]);
  return plant.rows[0]?.code_dhm ? String(plant.rows[0].code_dhm) : null;
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
    await applyCompany(record);
    const name = dhmDataName(record.data);
    if (name) await rememberDhmOrganization(record, replicaCode(record, null), name);
    return true;
  }
  if (slug === 'site') await applySite(record);
  else if (slug === 'plant') await applyPlant(record);
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
    await query(
      `UPDATE master_companies
       SET dhm_is_deleted = true, dhm_version = COALESCE($2, dhm_version), updated_at = CURRENT_TIMESTAMP
       WHERE dhm_id = $1::uuid`,
      [id, version],
    );
    return true;
  }
  const table =
    slug === 'site'
      ? 'master_sites'
      : slug === 'plant'
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
