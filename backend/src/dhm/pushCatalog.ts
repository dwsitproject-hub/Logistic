import { query } from '../database/connection';
import { isDhmEnabled } from './config';
import { pushNamedMasterToDhm, pushMasterCompanyToDhm, pushMasterExternalPartyToDhm, pushMasterPlantToDhm, pushMasterPortToDhm, pushMasterSiteToDhm } from './pushMaster';
import { pushMasterVesselToDhm, type DhmPushAttachment } from './pushVessel';
import { recordPushOutcome } from './pushState';
import { productDhmExtra } from './productExtra';
import type { KlipVesselForDhm } from './types';

export const DHM_SYNC_MASTERS = ['vessel', 'product', 'port', 'plant', 'site', 'company', 'ext_company', 'incoterm'] as const;
export type DhmSyncMaster = (typeof DHM_SYNC_MASTERS)[number];

export interface DhmCatalogSyncResult {
  total: number;
  synced: number;
  failed: number;
  conflicts: number;
  disabled: boolean;
  errors: Array<{ name: string; error: string }>;
  /** DHM answered "too many requests": the run stopped there instead of sending the rest into the limit. Run it again after retryAfterSeconds. */
  throttled?: boolean;
  retryAfterSeconds?: number | null;
  /** Rows left out because KLIP has no transaction on them (product only), so there was nothing to send. */
  skippedUnused?: number;
}

function isSyncMaster(value: string): value is DhmSyncMaster {
  return (DHM_SYNC_MASTERS as readonly string[]).includes(value);
}

export function readDhmSyncMaster(value: unknown): DhmSyncMaster | null {
  const master = String(value ?? '').trim();
  return isSyncMaster(master) ? master : null;
}

export function rowName(master: DhmSyncMaster, row: Record<string, unknown>): string {
  const value =
    master === 'vessel'
      ? row.vessel_name
      : master === 'product'
        ? row.product_name
        : master === 'port'
          ? row.port
          : master === 'plant'
            ? row.plant_name
            : master === 'site'
              ? row.site_name
              : master === 'company'
                ? row.company_name
              : master === 'incoterm'
                ? row.value_1
                : row.value_3;
  return String(value || row.code_klip || row.id || '').trim() || 'row';
}

function vesselForDhm(row: Record<string, unknown>): KlipVesselForDhm & { dhm_code?: string | null } {
  return {
    vessel_code: row.vessel_code != null ? String(row.vessel_code) : null,
    vessel_name: String(row.vessel_name ?? ''),
    vessel_capacity_mt: row.vessel_capacity_mt != null ? Number(row.vessel_capacity_mt) : null,
    heating: typeof row.heating === 'boolean' ? row.heating : null,
    vessel_type: row.vessel_type != null ? String(row.vessel_type) : null,
    lambung_type: row.lambung_type != null ? String(row.lambung_type) : null,
    terms: row.terms != null ? String(row.terms) : null,
    dhm_code: row.dhm_code != null ? String(row.dhm_code) : null,
  };
}

/**
 * The products worth sending in a bulk Sync: the ones a KLIP contract uses (its SAP material_code, or a product of that name) and the ones DHM never received (no dhm_id: made in KLIP,
 * possibly not delivered yet). The other ~3,400 are DHM's own catalog coming back: pushing them again changes nothing in DHM and, one request each, runs into its rate limit.
 */
export const USED_OR_UNDELIVERED_PRODUCTS_SQL = `
  WITH used AS (
    SELECT upper(trim(material_code)) AS material_code, NULL::text AS product FROM contracts WHERE NULLIF(trim(material_code), '') IS NOT NULL
    UNION
    SELECT NULL::text, upper(trim(product)) FROM contracts WHERE NULLIF(trim(product), '') IS NOT NULL
  )
  SELECT p.* FROM products p
   WHERE p.dhm_id IS NULL
      OR EXISTS (SELECT 1 FROM used u WHERE u.material_code IS NOT NULL AND u.material_code = upper(trim(p.material_code)))
      OR EXISTS (SELECT 1 FROM used u WHERE u.product IS NOT NULL AND u.product = upper(trim(p.product_name)))
   ORDER BY p.product_name`;

/** DHM's rate limit says "Too many requests (integration API); retry in 40s". */
export function readDhmThrottle(error: unknown): { throttled: boolean; retryAfterSeconds: number | null } {
  const text = String(error ?? '');
  if (!/too many requests/i.test(text)) return { throttled: false, retryAfterSeconds: null };
  const seconds = /retry in\s+(\d+)\s*s/i.exec(text);
  return { throttled: true, retryAfterSeconds: seconds ? Number(seconds[1]) : null };
}

async function loadRows(master: DhmSyncMaster): Promise<Record<string, unknown>[]> {
  if (master === 'product') return (await query(USED_OR_UNDELIVERED_PRODUCTS_SQL)).rows as Record<string, unknown>[];
  const sql =
    master === 'vessel'
      ? `SELECT * FROM master_vessels ORDER BY vessel_name`
      : master === 'port'
          ? `SELECT * FROM master_loading_ports ORDER BY port`
          : master === 'plant'
            ? `SELECT * FROM master_plants ORDER BY plant_name`
            : master === 'site'
        ? `SELECT * FROM master_sites ORDER BY site_name`
        : master === 'company'
          ? `SELECT * FROM master_companies ORDER BY company_name`
          : master === 'incoterm'
                ? `SELECT * FROM master_reference_items WHERE kind = 'incoterm' ORDER BY value_1`
                : `SELECT * FROM master_reference_items WHERE kind = 'ext_company' ORDER BY value_3`;
  const result = await query(sql);
  return result.rows as Record<string, unknown>[];
}

/** The table (and the filter that picks a master out of a shared one) behind each master, to load rows by id. */
const ROW_SOURCE: Record<DhmSyncMaster, { from: string; where: string }> = {
  vessel: { from: 'master_vessels', where: '' },
  product: { from: 'products', where: '' },
  port: { from: 'master_loading_ports', where: '' },
  plant: { from: 'master_plants', where: '' },
  site: { from: 'master_sites', where: '' },
  company: { from: 'master_companies', where: '' },
  incoterm: { from: 'master_reference_items', where: "kind = 'incoterm'" },
  ext_company: { from: 'master_reference_items', where: "kind = 'ext_company'" },
};

/** The CURRENT rows for these ids, so a retry pushes what the master holds now and not what failed earlier. */
export async function loadRowsByIds(master: DhmSyncMaster, ids: string[]): Promise<Record<string, unknown>[]> {
  if (ids.length === 0) return [];
  const { from, where } = ROW_SOURCE[master];
  const result = await query(`SELECT * FROM ${from} WHERE id = ANY($1::uuid[])${where ? ` AND ${where}` : ''}`, [ids]);
  return result.rows as Record<string, unknown>[];
}

/** Push one row and remember how it went (see pushState.ts), whoever asked: the Sync button or the retry job. */
export async function pushRow(master: DhmSyncMaster, row: Record<string, unknown>, overwrite: boolean): Promise<DhmPushAttachment> {
  const result = await pushRowUntracked(master, row, overwrite);
  await recordPushOutcome(master, String(row.id), result);
  return result;
}

async function pushRowUntracked(master: DhmSyncMaster, row: Record<string, unknown>, overwrite: boolean): Promise<DhmPushAttachment> {
  const id = String(row.id);
  if (master === 'vessel') return pushMasterVesselToDhm(id, vesselForDhm(row), { overwrite });
  if (master === 'port') return pushMasterPortToDhm(id, row, { overwrite });
  if (master === 'plant') return pushMasterPlantToDhm(id, row, { overwrite });
  if (master === 'site') return pushMasterSiteToDhm(id, row, { overwrite });
  if (master === 'company') return pushMasterCompanyToDhm(id, row, { overwrite });
  if (master === 'ext_company') return pushMasterExternalPartyToDhm(id, row, { overwrite });
  if (master === 'incoterm') {
    return pushNamedMasterToDhm(
      'master_reference_items',
      id,
      'incoterm',
      String(row.value_1 ?? ''),
      row.code_dhm != null ? String(row.code_dhm) : null,
      { overwrite },
    );
  }
  const name = String(row.product_name ?? '').trim();
  return pushNamedMasterToDhm('products', id, 'commodity', name, row.code_dhm != null ? String(row.code_dhm) : null, {
    overwrite,
    extra: productDhmExtra(row),
  });
}

export async function pushMasterCatalogToDhm(master: DhmSyncMaster, overwrite: boolean): Promise<DhmCatalogSyncResult> {
  if (!isDhmEnabled()) {
    return { total: 0, synced: 0, failed: 0, conflicts: 0, disabled: true, errors: [] };
  }
  const rows = await loadRows(master);
  let synced = 0;
  let failed = 0;
  let conflicts = 0;
  let throttle: { throttled: boolean; retryAfterSeconds: number | null } = { throttled: false, retryAfterSeconds: null };
  const errors: Array<{ name: string; error: string }> = [];
  for (const row of rows) {
    const result = await pushRow(master, row, overwrite);
    const limit = readDhmThrottle(result.dhmError);
    if (limit.throttled) {
      // not a problem with this row: DHM asks to slow down, so stop here and report it once (the rows after it would only fail the same way)
      throttle = limit;
      failed += 1;
      errors.push({ name: rowName(master, row), error: String(result.dhmError) });
      break;
    }
    if (result.dhmConflict) {
      conflicts += 1;
      continue;
    }
    if (result.dhmError) {
      failed += 1;
      if (errors.length < 8) errors.push({ name: rowName(master, row), error: result.dhmError });
      continue;
    }
    if (result.dhmStatus || result.dhmCode) {
      synced += 1;
      continue;
    }
    failed += 1;
    if (errors.length < 8) errors.push({ name: rowName(master, row), error: 'DHM did not confirm the row' });
  }
  const skippedUnused = master === 'product' ? Math.max(0, Number((await query('SELECT COUNT(*)::int AS n FROM products')).rows[0]?.n ?? 0) - rows.length) : 0;
  return {
    total: rows.length,
    synced,
    failed,
    conflicts,
    disabled: false,
    errors,
    ...(throttle.throttled ? { throttled: true, retryAfterSeconds: throttle.retryAfterSeconds } : {}),
    ...(master === 'product' ? { skippedUnused } : {}),
  };
}
