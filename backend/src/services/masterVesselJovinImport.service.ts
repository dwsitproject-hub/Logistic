import * as XLSX from 'xlsx';
import type { PoolClient } from 'pg';
import { query } from '../database/connection';
import {
  loadSapVesselCodeMap,
  resolveVesselCodeFromMaps,
  type MasterVesselCodeSource,
} from '../utils/masterVesselCodeResolve';
import { isMissingVesselCode, normalizeVesselName, uppercaseText } from '../utils/vesselNameNormalize';
import { resolveMasterVessel } from './resolveMasterVessel.service';
import {
  runMasterVesselCleanup,
  type MasterVesselCleanupStats,
} from './masterVesselCleanup.service';

export interface JovinImportStats {
  totalJovinRows: number;
  resolvedFromKlip: number;
  resolvedFromSap: number;
  resolvedFromDb: number;
  resolvedFromJovin: number;
  provisionalInserted: number;
  promoted: number;
  inserted: number;
  updated: number;
  skippedEmptyName: number;
  klipSapMismatchWarnings: Array<{ vesselName: string; klipCode: string; sapCode: string }>;
  needsCodeReview: Array<{ vesselName: string; internalCode: string }>;
  cleanup: MasterVesselCleanupStats | null;
  dryRun: boolean;
}

export interface JovinImportRow {
  vessel_code: string;
  vessel_name: string;
  sap_vendor_code: string | null;
  vessel_owner: string | null;
  vessel_capacity_mt: number | null;
  vessel_type: string | null;
  heating: boolean;
  lambung_type: string | null;
  terms: string | null;
  code_status: 'OFFICIAL' | 'PROVISIONAL';
  code_source: MasterVesselCodeSource;
}

type DbVesselRow = {
  id: string;
  vessel_code: string;
  vessel_name: string;
  code_status: string | null;
};

function parseHeating(value: unknown): boolean {
  const s = String(value ?? '').trim().toUpperCase();
  return s === 'YES' || s === 'Y' || s === 'TRUE' || value === true;
}

function parseCapacity(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function normalizeTerms(value: unknown): string | null {
  const s = String(value ?? '').trim().toUpperCase();
  return s === 'V/C' || s === 'T/C' ? s : null;
}

function readSheetRows(wb: XLSX.WorkBook, sheetName: string): Record<string, unknown>[] {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found in workbook`);
  return XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, unknown>[];
}

function buildKlipCodeMap(klipRows: Record<string, unknown>[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of klipRows) {
    const name = String(row['Vessel Name'] ?? '').trim();
    const code = String(row['Vessel Code'] ?? '').trim().toUpperCase();
    if (!name || !code || isMissingVesselCode(code)) continue;
    map.set(normalizeVesselName(name), code);
  }
  return map;
}

function jovinRowToPayload(
  row: Record<string, unknown>,
  resolved: ReturnType<typeof resolveVesselCodeFromMaps>,
): JovinImportRow | null {
  const vesselName = uppercaseText(row['Vessel Name']);
  if (!vesselName) return null;

  return {
    vessel_code: resolved.vessel_code,
    vessel_name: vesselName,
    sap_vendor_code: uppercaseText(row['Company Code']),
    vessel_owner: uppercaseText(row['Company Name']),
    vessel_capacity_mt: parseCapacity(row['Vessel Capacity']),
    vessel_type: uppercaseText(row['Vessel Type']),
    heating: parseHeating(row['Heating']),
    lambung_type: uppercaseText(row['Type Lambung']),
    terms: normalizeTerms(row['Terms']),
    code_status: resolved.code_status,
    code_source: resolved.source,
  };
}

async function loadDbVessels(client?: PoolClient): Promise<{
  byCode: Map<string, DbVesselRow>;
  byNormName: Map<string, DbVesselRow>;
}> {
  const run = client ? client.query.bind(client) : query;
  const result = await run(
    `SELECT id, vessel_code, vessel_name, code_status FROM master_vessels`,
  );
  const byCode = new Map<string, DbVesselRow>();
  const byNormName = new Map<string, DbVesselRow>();
  for (const row of result.rows as DbVesselRow[]) {
    byCode.set(row.vessel_code.toUpperCase(), row);
    const norm = normalizeVesselName(row.vessel_name);
    if (norm && !byNormName.has(norm)) byNormName.set(norm, row);
  }
  return { byCode, byNormName };
}

async function upsertJovinPayload(
  payload: JovinImportRow,
  existingByNormName: Map<string, DbVesselRow>,
  dryRun: boolean,
  client?: PoolClient,
): Promise<'inserted' | 'updated' | 'promoted' | 'alias_added'> {
  const norm = normalizeVesselName(payload.vessel_name);
  const existing = norm ? existingByNormName.get(norm) : undefined;
  const hadExisting = Boolean(existing);

  if (dryRun) {
    if (!hadExisting) return 'inserted';
    if (
      existing!.code_status === 'PROVISIONAL' &&
      payload.code_status === 'OFFICIAL' &&
      existing!.vessel_code.toUpperCase() !== payload.vessel_code.toUpperCase()
    ) {
      return 'promoted';
    }
    if (
      existing &&
      payload.vessel_code.toUpperCase() !== existing.vessel_code.toUpperCase()
    ) {
      return 'alias_added';
    }
    return 'updated';
  }

  const source =
    payload.code_source === 'klip_sheet'
      ? 'klip_sheet'
      : payload.code_source === 'sap_import'
        ? 'sap_import'
        : payload.code_source === 'jovin'
          ? 'jovin'
          : 'manual';

  const result = await resolveMasterVessel(
    {
      vessel_code: payload.vessel_code,
      vessel_name: payload.vessel_name,
      vessel_owner: payload.vessel_owner,
      sap_vendor_code: payload.sap_vendor_code,
      vessel_capacity_mt: payload.vessel_capacity_mt,
      vessel_type: payload.vessel_type,
      heating: payload.heating,
      lambung_type: payload.lambung_type,
      terms: payload.terms,
      code_status: payload.code_status,
      source,
      updateAttributes: true,
    },
    client,
  );

  if (!result) return 'updated';

  if (norm) {
    existingByNormName.set(norm, {
      id: result.master_vessel_id,
      vessel_code: result.vessel_code,
      vessel_name: result.vessel_name,
      code_status: payload.code_status,
    });
  }

  if (result.created) return 'inserted';
  if (result.alias_added) return 'alias_added';
  if (
    hadExisting &&
    existing!.code_status === 'PROVISIONAL' &&
    payload.code_status === 'OFFICIAL'
  ) {
    return 'promoted';
  }
  return 'updated';
}

export async function importMasterVesselJovinFromBuffer(
  fileBuffer: Buffer,
  options: { dryRun?: boolean; client?: PoolClient } = {},
): Promise<JovinImportStats> {
  const dryRun = options.dryRun ?? false;
  const wb = XLSX.read(fileBuffer, { type: 'buffer' });
  const jovinRows = readSheetRows(wb, 'Jovin');
  const klipRows = wb.SheetNames.includes('KLIP') ? readSheetRows(wb, 'KLIP') : [];
  const klipMap = buildKlipCodeMap(klipRows);
  const sapMap = await loadSapVesselCodeMap(options.client);
  const { byNormName: dbByNormName } = await loadDbVessels(options.client);

  const stats: JovinImportStats = {
    totalJovinRows: 0,
    resolvedFromKlip: 0,
    resolvedFromSap: 0,
    resolvedFromDb: 0,
    resolvedFromJovin: 0,
    provisionalInserted: 0,
    promoted: 0,
    inserted: 0,
    updated: 0,
    skippedEmptyName: 0,
    klipSapMismatchWarnings: [],
    needsCodeReview: [],
    cleanup: null,
    dryRun,
  };

  const goldenNames = new Map<string, string>();

  for (const klipNorm of klipMap.keys()) {
    const klipCode = klipMap.get(klipNorm)!;
    const sapCode = sapMap.get(klipNorm);
    if (sapCode && sapCode !== klipCode) {
      stats.klipSapMismatchWarnings.push({
        vesselName: klipNorm,
        klipCode,
        sapCode,
      });
    }
  }

  const workingDbByNorm = new Map(dbByNormName);

  for (const row of jovinRows) {
    const vesselNameRaw = String(row['Vessel Name'] ?? '').trim();
    if (!vesselNameRaw) {
      stats.skippedEmptyName += 1;
      continue;
    }
    stats.totalJovinRows += 1;

    const resolved = resolveVesselCodeFromMaps(
      vesselNameRaw,
      row['Vessel Code'],
      klipMap,
      sapMap,
      workingDbByNorm,
    );

    switch (resolved.source) {
      case 'klip_sheet':
        stats.resolvedFromKlip += 1;
        break;
      case 'sap_import':
        stats.resolvedFromSap += 1;
        break;
      case 'db_existing':
        stats.resolvedFromDb += 1;
        break;
      case 'jovin':
        stats.resolvedFromJovin += 1;
        break;
      case 'provisional':
        stats.provisionalInserted += 1;
        stats.needsCodeReview.push({
          vesselName: uppercaseText(vesselNameRaw)!,
          internalCode: resolved.vessel_code,
        });
        break;
      default:
        break;
    }

    const payload = jovinRowToPayload(row, resolved);
    if (!payload) {
      stats.skippedEmptyName += 1;
      continue;
    }

    const goldenNorm = normalizeVesselName(payload.vessel_name);
    if (goldenNorm && !goldenNames.has(goldenNorm)) {
      goldenNames.set(goldenNorm, payload.vessel_name);
    }

    const action = await upsertJovinPayload(payload, workingDbByNorm, dryRun, options.client);
    if (action === 'inserted') stats.inserted += 1;
    else if (action === 'updated' || action === 'alias_added') stats.updated += 1;
    else if (action === 'promoted') stats.promoted += 1;
  }

  stats.cleanup = await runMasterVesselCleanup({
    dryRun,
    client: options.client,
    goldenNames,
  });

  return stats;
}

export async function importMasterVesselJovinFromFile(
  filePath: string,
  options: { dryRun?: boolean } = {},
): Promise<JovinImportStats> {
  const fs = await import('fs');
  const buffer = fs.readFileSync(filePath);
  return importMasterVesselJovinFromBuffer(buffer, options);
}
