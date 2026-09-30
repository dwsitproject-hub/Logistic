import { query } from '../database/connection';
import { isDhmEnabled } from './config';
import { pushNamedMasterToDhm, pushMasterCompanyToDhm, pushMasterExternalPartyToDhm, pushMasterPlantToDhm, pushMasterPortToDhm, pushMasterSiteToDhm } from './pushMaster';
import { pushMasterVesselToDhm, type DhmPushAttachment } from './pushVessel';
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
}

function isSyncMaster(value: string): value is DhmSyncMaster {
  return (DHM_SYNC_MASTERS as readonly string[]).includes(value);
}

export function readDhmSyncMaster(value: unknown): DhmSyncMaster | null {
  const master = String(value ?? '').trim();
  return isSyncMaster(master) ? master : null;
}

function rowName(master: DhmSyncMaster, row: Record<string, unknown>): string {
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

async function loadRows(master: DhmSyncMaster): Promise<Record<string, unknown>[]> {
  const sql =
    master === 'vessel'
      ? `SELECT * FROM master_vessels ORDER BY vessel_name`
      : master === 'product'
        ? `SELECT * FROM products ORDER BY product_name`
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

async function pushRow(master: DhmSyncMaster, row: Record<string, unknown>, overwrite: boolean): Promise<DhmPushAttachment> {
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
  const extra: Record<string, string> = {};
  if (name) extra.short_name = name;
  const longName = String(row.long_name ?? '').trim();
  const commodityType = String(row.commodity_type ?? '').trim();
  if (longName) extra.long_name = longName;
  if (commodityType) extra.type = commodityType;
  return pushNamedMasterToDhm('products', id, 'commodity', name, row.code_dhm != null ? String(row.code_dhm) : null, {
    overwrite,
    extra,
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
  const errors: Array<{ name: string; error: string }> = [];
  for (const row of rows) {
    const result = await pushRow(master, row, overwrite);
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
  return { total: rows.length, synced, failed, conflicts, disabled: false, errors };
}
