import { query } from '../database/connection';
import logger from '../utils/logger';
import { dhmDataName, dhmRefCode } from './mapper';
import { asDhmUuid, persistMasterReplica, rememberDhmOrganization, replicaCode } from './masterReplica';
import { shouldApplyDhmRecord, type DhmApplyOptions } from './versionGuard';
import { sqlCanonicalProductName } from '../utils/productAlias';
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

/**
 * A DHM commodity is identified by its material_code (unique in DHM; the same short_name is allowed, Ryan 2026-11-12), and the material is the smallest unit KLIP keeps: one
 * product_materials row per commodity, carrying ITS OWN DataHub code, which is what JPS takes as cargo_hub_code. Three commodities named "CPO" are three rows here.
 *
 * Local database only: this reads what DHM sent and records it. The SAP import fills the material, its description and the link to the broad Master Product; this adds the DHM side
 * (code_dhm, dhm_*) and never overwrites SAP's description or a link a person set.
 */
async function recordMaterialCommodity(args: {
  materialCode: string;
  name: string | null;
  longName: string | null;
  code: string | null;
  dhmId: string | null;
  record: DhmRecord;
}): Promise<void> {
  const { materialCode, name, longName, code, dhmId, record } = args;
  try {
    // code_dhm and dhm_id are unique: if another material already holds this record's code, keep that one and say so, instead of failing the record.
    const holder = await findId(
      `SELECT id FROM product_materials
        WHERE (($1::text IS NOT NULL AND code_dhm = $1) OR ($2::uuid IS NOT NULL AND dhm_id = $2::uuid))
          AND upper(trim(material_code)) <> upper(trim($3))
        LIMIT 1`,
      [code, dhmId, materialCode],
    );
    if (holder) {
      logger.warn('DHM commodity code already belongs to another material; the record was not stored at material level', { code, materialCode });
      return;
    }
    await query(
      `INSERT INTO product_materials (material_code, material_description, product_label, product_id, code_dhm, dhm_id, dhm_version, dhm_updated_at, dhm_is_deleted, dhm_payload)
       VALUES ($1, $2, $3,
               (SELECT p.id FROM products p
                 WHERE UPPER(TRIM(${sqlCanonicalProductName('p.product_name')})) = UPPER(TRIM(${sqlCanonicalProductName('$3::text')}))
                 ORDER BY p.created_at LIMIT 1),
               $4, $5::uuid, $6, $7::timestamptz, $8, $9::jsonb)
       ON CONFLICT (upper(trim(material_code))) DO UPDATE SET
         code_dhm = COALESCE(EXCLUDED.code_dhm, product_materials.code_dhm),
         dhm_id = COALESCE(EXCLUDED.dhm_id, product_materials.dhm_id),
         dhm_version = EXCLUDED.dhm_version,
         dhm_updated_at = EXCLUDED.dhm_updated_at,
         dhm_is_deleted = EXCLUDED.dhm_is_deleted,
         dhm_payload = EXCLUDED.dhm_payload,
         material_description = COALESCE(product_materials.material_description, EXCLUDED.material_description),
         product_label = COALESCE(product_materials.product_label, EXCLUDED.product_label),
         product_id = CASE
           WHEN product_materials.product_link_source = 'USER' THEN product_materials.product_id
           ELSE COALESCE(product_materials.product_id, EXCLUDED.product_id)
         END,
         updated_at = CURRENT_TIMESTAMP`,
      [
        materialCode,
        longName,
        name,
        code,
        dhmId,
        record.version || null,
        record.updatedAt || null,
        record.isDeleted,
        JSON.stringify(record.data ?? {}),
      ],
    );
  } catch (error) {
    logger.warn('DHM commodity could not be stored at material level', { code, materialCode, error: error instanceof Error ? error.message : String(error) });
  }
}

async function applyCommodity(record: DhmRecord): Promise<void> {
  const name = commodityText(record.data, 'short_name') || dhmDataName(record.data);
  const longName = commodityText(record.data, 'long_name');
  const commodityType = commodityText(record.data, 'type');
  const materialCodeRaw = commodityText(record.data, 'material_code');
  const materialGroup = commodityText(record.data, 'material_group');
  const hsCode = commodityText(record.data, 'hs_code');
  const uom = commodityText(record.data, 'uom');
  const code = replicaCode(record, null);
  const dhmId = asDhmUuid(record.id);
  // The commodity of a SAP material is recorded at material level whatever happens to the broad Master Product below.
  if (materialCodeRaw) await recordMaterialCommodity({ materialCode: materialCodeRaw, name, longName, code, dhmId, record });
  const byIdentity =
    (dhmId && (await findId(`SELECT id FROM products WHERE dhm_id = $1::uuid LIMIT 1`, [dhmId]))) ||
    (code && (await findId(`SELECT id FROM products WHERE code_dhm = $1 LIMIT 1`, [code]))) ||
    // The SAP material number is the stable identity of a product, so it comes before the name.
    (materialCodeRaw &&
      (await findId(`SELECT id FROM products WHERE upper(trim(material_code)) = upper(trim($1)) LIMIT 1`, [materialCodeRaw])));
  // A product keeps ONE DHM link, and DHM may hold several commodities under one short_name (CPO has three materials). A record that is none of the product's linked commodity, yet
  // names a product that IS linked to another one, is a sibling: matched by name it would take the product's dhm_id, code and material_code from the first, and swap them back on the
  // next record, every sync. It stays at material level (product_materials) only.
  if (!byIdentity && materialCodeRaw && name) {
    const sibling = await findId(
      `SELECT id FROM products
        WHERE upper(trim(product_name)) = upper(trim($1)) AND dhm_id IS NOT NULL AND ($2::uuid IS NULL OR dhm_id <> $2::uuid) AND COALESCE(dhm_is_deleted, false) = false
        LIMIT 1`,
      [name, dhmId],
    );
    if (sibling) {
      logger.info('DHM commodity shares its short_name with another commodity of the product: kept at material level', { code, materialCode: materialCodeRaw, name });
      return;
    }
  }
  const existing =
    byIdentity || (name && (await findId(`SELECT id FROM products WHERE upper(trim(product_name)) = upper(trim($1)) LIMIT 1`, [name])));
  // material_code is unique in KLIP. A record whose code another product already holds must not make the record fail
  // (the sync would skip it and the DHM link would never be stored): keep the other product's code, drop this one.
  let materialCode = materialCodeRaw;
  if (materialCodeRaw) {
    const holder = await findId(
      `SELECT id FROM products WHERE upper(trim(material_code)) = upper(trim($1)) AND ($2::uuid IS NULL OR id <> $2::uuid) LIMIT 1`,
      [materialCodeRaw, existing || null],
    );
    if (holder) {
      logger.warn('DHM commodity material_code already belongs to another product; it was not copied', {
        code,
        materialCode: materialCodeRaw,
      });
      materialCode = null;
    }
  }
  if (existing) {
    await query(
      `UPDATE products
       SET product_name = COALESCE($2, product_name),
           long_name = COALESCE($3, long_name),
           commodity_type = COALESCE($4, commodity_type),
           material_code = COALESCE($5, material_code),
           material_group = COALESCE($6, material_group),
           hs_code = COALESCE($7, hs_code),
           uom = COALESCE($8, uom),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [existing, name, longName, commodityType, materialCode, materialGroup, hsCode, uom],
    );
    await persistMasterReplica('products', existing, record, code);
    return;
  }
  if (!name) return;
  const inserted = await query(
    `INSERT INTO products (product_name, long_name, commodity_type, code_dhm, dhm_id, dhm_version, dhm_updated_at, dhm_is_deleted, dhm_payload, material_code, material_group, hs_code, uom)
     VALUES ($1, $2, $3, $4, $5::uuid, $6, $7::timestamptz, $8, $9::jsonb, $10, $11, $12, $13)
     ON CONFLICT (product_name) DO UPDATE SET
       long_name = COALESCE(EXCLUDED.long_name, products.long_name),
       commodity_type = COALESCE(EXCLUDED.commodity_type, products.commodity_type),
       material_code = COALESCE(EXCLUDED.material_code, products.material_code),
       material_group = COALESCE(EXCLUDED.material_group, products.material_group),
       hs_code = COALESCE(EXCLUDED.hs_code, products.hs_code),
       uom = COALESCE(EXCLUDED.uom, products.uom),
       code_dhm = COALESCE(EXCLUDED.code_dhm, products.code_dhm),
       dhm_id = COALESCE(EXCLUDED.dhm_id, products.dhm_id),
       dhm_version = EXCLUDED.dhm_version,
       dhm_updated_at = EXCLUDED.dhm_updated_at,
       dhm_is_deleted = EXCLUDED.dhm_is_deleted,
       dhm_payload = EXCLUDED.dhm_payload,
       updated_at = CURRENT_TIMESTAMP
     RETURNING id`,
    [
      name,
      longName,
      commodityType,
      code,
      dhmId,
      record.version || null,
      record.updatedAt || null,
      record.isDeleted,
      JSON.stringify(record.data ?? {}),
      materialCode,
      materialGroup,
      hsCode,
      uom,
    ],
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
  // The SAP Company Code: DHM's company_code_sap when the organisation has one (the legal entities, whose short_name is only a short name, e.g. PMC for SAP code PM), else
  // short_name (the older organisations KLIP created from its own SAP-coded rows, whose short_name IS the SAP code).
  const sap = commodityText(record.data, 'company_code_sap') || commodityText(record.data, 'short_name');
  const dhmId = asDhmUuid(record.id);
  const existing =
    (dhmId && (await findId(`SELECT id FROM master_companies WHERE dhm_id = $1::uuid LIMIT 1`, [dhmId]))) ||
    (code && (await findId(`SELECT id FROM master_companies WHERE code_dhm = $1 LIMIT 1`, [code]))) ||
    // The two fallbacks below match on a code or a name a person typed, so they must not take a row that
    // already belongs to ANOTHER DHM organisation. DHM can hold two organisations with one name (SIT has
    // PT. ENERGI OLEO PERSADA twice: ORG-0003 and ORG-0028); once the local row of one is gone, the other's
    // record would match the survivor by name and overwrite its dhm_id and code. A row that is free
    // (no dhm_id), already this record's, or marked deleted in DHM may still be claimed.
    (sap &&
      (await findId(
        `SELECT id FROM master_companies
          WHERE upper(trim(company_code)) = upper(trim($1))
            AND (dhm_id IS NULL OR dhm_id IS NOT DISTINCT FROM $2::uuid OR dhm_is_deleted)
          LIMIT 1`,
        [sap, dhmId],
      ))) ||
    (name &&
      (await findId(
        `SELECT id FROM master_companies
          WHERE upper(trim(company_name)) = upper(trim($1))
            AND (dhm_id IS NULL OR dhm_id IS NOT DISTINCT FROM $2::uuid OR dhm_is_deleted)
          LIMIT 1`,
        [name, dhmId],
      )));
  let id = existing;
  if (id) {
    // company_code is unique. A code another row holds is NOT taken from it: the current code stays and the conflict is logged. Releasing the holder is a decision
    // (companyCodeRepair.ts plans it and says what moves), not something a sync does on its own.
    let codeToSet = sap;
    if (sap) {
      const holder = await findId(
        `SELECT id FROM master_companies WHERE upper(trim(company_code)) = upper(trim($1)) AND id <> $2::uuid LIMIT 1`,
        [sap, id],
      );
      if (holder) {
        logger.warn('DHM company: its SAP Company Code is held by another Master Company row; the current code was kept', { sap, dhmCode: code, rowId: id, heldBy: holder });
        codeToSet = null;
      }
    }
    if (name || codeToSet) {
      await query(
        `UPDATE master_companies
         SET company_name = COALESCE($2, company_name),
             company_code = COALESCE($3, company_code),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [id, name, codeToSet],
      );
    }
    await persistMasterReplica('master_companies', id, record, code);
  } else if (name) {
    // A new row takes the SAP code unless another row already holds it; then it is filed under its DHM code (unique) and the repair plan sorts out the pair.
    const held = sap ? await findId(`SELECT id FROM master_companies WHERE upper(trim(company_code)) = upper(trim($1)) LIMIT 1`, [sap]) : null;
    const inserted = await query(
      `INSERT INTO master_companies (company_code, company_name, code_dhm, dhm_id, dhm_version, dhm_updated_at, dhm_is_deleted, dhm_payload)
       VALUES ($1, $2, $3, $4::uuid, $5, $6::timestamptz, $7, $8::jsonb)
       RETURNING id`,
      [held ? code || name : sap || name, name, code, dhmId, record.version || null, record.updatedAt || null, record.isDeleted, JSON.stringify(record.data ?? {})],
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

/**
 * Apply one DHM master record. Returns false when it was not written: an unknown slug, or a record OLDER than what the
 * replica already holds (see versionGuard.ts).
 */
export async function applyDhmMasterRecord(
  slug: string,
  record: DhmRecord,
  options: DhmApplyOptions = {},
): Promise<boolean> {
  if (!isMasterSlug(slug)) return false;
  if (!(await shouldApplyDhmRecord(slug, record, options))) return false;
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

/**
 * A tombstone only counts if the replica does not already hold a NEWER version: a late "deleted" must not bury a record
 * that was updated after it. Unknown on either side (no version in the delivery, a row never versioned) still applies.
 * Written into the UPDATE, not checked beforehand, so a delete and an update arriving together cannot slip past each other.
 */
export const NOT_NEWER_THAN_DELETE_SQL = ` AND ($2::int IS NULL OR dhm_version IS NULL OR dhm_version <= $2::int)`;

export async function markDhmMasterDeleted(slug: string, recordId: string, version: number | null): Promise<boolean> {
  if (!isMasterSlug(slug)) return false;
  const id = asDhmUuid(recordId);
  if (!id) return true;
  if (slug === 'company' || slug === 'organization') {
    await query(
      `UPDATE dhm_organizations
       SET dhm_is_deleted = true, dhm_version = COALESCE($2, dhm_version), updated_at = CURRENT_TIMESTAMP
       WHERE dhm_id = $1::uuid${NOT_NEWER_THAN_DELETE_SQL}`,
      [id, version],
    );
    await query(
      `UPDATE master_companies
       SET dhm_is_deleted = true, dhm_version = COALESCE($2, dhm_version), updated_at = CURRENT_TIMESTAMP
       WHERE dhm_id = $1::uuid${NOT_NEWER_THAN_DELETE_SQL}`,
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
     WHERE dhm_id = $1::uuid${kindSql}${NOT_NEWER_THAN_DELETE_SQL}`,
    [id, version],
  );
  return true;
}
