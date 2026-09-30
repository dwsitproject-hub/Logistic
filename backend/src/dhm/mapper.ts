import type { KlipVesselForDhm } from './types';

const VESSEL_TYPE_TO_DHM: Record<string, string> = {
  BARGE: 'barge',
  TANKER: 'tanker',
  SPOB: 'SPOB',
};

const VESSEL_TYPE_FROM_DHM: Record<string, string> = {
  barge: 'BARGE',
  tanker: 'TANKER',
  SPOB: 'SPOB',
};

const LAMBUNG_TO_DHM: Record<string, string> = {
  DHDB: 'Double hull Double Bottom',
  SHSB: 'Single hull Single Bottom',
  SHDB: 'Single hull Double Bottom',
};

const LAMBUNG_FROM_DHM: Record<string, string> = {
  'Double hull Double Bottom': 'DHDB',
  'Single hull Single Bottom': 'SHSB',
  'Single hull Double Bottom': 'SHDB',
};

const TERMS_TO_DHM: Record<string, string> = {
  'V/C': 'Voyage Charter',
  'T/C': 'Time Charter',
};

const TERMS_FROM_DHM: Record<string, string> = {
  'Voyage Charter': 'V/C',
  'Time Charter': 'T/C',
};

function mapLookup(table: Record<string, string>, value: unknown): string | undefined {
  const key = String(value ?? '').trim();
  if (!key) return undefined;
  return table[key] ?? table[key.toUpperCase()];
}

/** Hub keys only — unknown keys are rejected by DHM. */
export function toDhmVesselPayload(
  row: KlipVesselForDhm,
  options?: { code?: string },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    Vessel_Name: String(row.vessel_name ?? '').trim(),
  };
  if (options?.code) payload.code = options.code;

  const sapCode = String(row.vessel_code ?? '').trim();
  if (sapCode) payload.Vessel_Code_SAP = sapCode;

  if (row.vessel_capacity_mt != null && Number.isFinite(Number(row.vessel_capacity_mt))) {
    payload.Vessel_Capacity_MT = Number(row.vessel_capacity_mt);
  }

  if (row.heating != null) payload.Heater = Boolean(row.heating);

  const vesselType = mapLookup(VESSEL_TYPE_TO_DHM, row.vessel_type);
  if (vesselType) payload.Vessel_Type = vesselType;

  const lambung = mapLookup(LAMBUNG_TO_DHM, row.lambung_type);
  if (lambung) payload.Type_lambung = lambung;

  const charter = mapLookup(TERMS_TO_DHM, row.terms);
  if (charter) payload.Type_Charter = charter;

  return payload;
}

export function fromDhmVesselData(data: Record<string, unknown> | null | undefined): {
  dhm_code: string | null;
  vessel_name: string | null;
  vessel_code_sap: string | null;
  vessel_capacity_mt: number | null;
  heating: boolean | null;
  vessel_type: string | null;
  lambung_type: string | null;
  terms: string | null;
} {
  const d = data && typeof data === 'object' ? data : {};
  const cap = d.Vessel_Capacity_MT;
  const capN = cap == null || cap === '' ? null : Number(cap);
  return {
    dhm_code: d.code != null ? String(d.code).trim() || null : null,
    vessel_name: d.Vessel_Name != null ? String(d.Vessel_Name).trim() || null : null,
    vessel_code_sap:
      d.Vessel_Code_SAP != null ? String(d.Vessel_Code_SAP).trim() || null : null,
    vessel_capacity_mt: capN != null && Number.isFinite(capN) ? capN : null,
    heating: typeof d.Heater === 'boolean' ? d.Heater : null,
    vessel_type: mapLookup(VESSEL_TYPE_FROM_DHM, d.Vessel_Type) ?? null,
    lambung_type: mapLookup(LAMBUNG_FROM_DHM, d.Type_lambung) ?? null,
    terms: mapLookup(TERMS_FROM_DHM, d.Type_Charter) ?? null,
  };
}

export function dhmRecordCode(record: { data?: Record<string, unknown> } | null | undefined): string | null {
  const code = record?.data?.code;
  return code != null ? String(code).trim() || null : null;
}

export interface DhmCatalogFieldShape {
  key: string;
  required?: boolean;
  systemGenerated?: boolean;
}

export interface DhmCatalogShape {
  fields?: DhmCatalogFieldShape[];
}

/**
 * Keep only keys the live catalog lists. Copy `name` into short_name / long_name when those
 * fields exist, and omit system-assigned `code` unless this is an update.
 */
export function toDhmCatalogPayload(
  entity: DhmCatalogShape,
  values: Record<string, unknown>,
  options?: { code?: string },
): { payload: Record<string, unknown>; missing: string[] } {
  const fields = entity.fields ?? [];
  if (fields.length === 0) {
    const name = String(values.name ?? '').trim();
    const extra: Record<string, string> = {};
    for (const [key, value] of Object.entries(values)) {
      if (key === 'name' || key === 'code') continue;
      const text = String(value ?? '').trim();
      if (text) extra[key] = text;
    }
    return { payload: toDhmNamePayload(name, { code: options?.code, extra }), missing: [] };
  }

  const byKey = new Map(fields.map((field) => [field.key, field]));
  const copies: Record<string, unknown> = { ...values };
  const name = String(values.name ?? '').trim();
  if (name) {
    if (byKey.has('short_name') && !String(copies.short_name ?? '').trim()) copies.short_name = name;
    if (byKey.has('long_name') && !String(copies.long_name ?? '').trim()) copies.long_name = name;
  }

  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(copies)) {
    const field = byKey.get(key);
    if (!field || field.systemGenerated) continue;
    if (value == null) continue;
    if (Array.isArray(value)) {
      const items = value.map((item) => String(item ?? '').trim()).filter(Boolean);
      if (!items.length) continue;
      payload[key] = items;
      continue;
    }
    if (typeof value === 'string') {
      const text = value.trim();
      if (!text) continue;
      payload[key] = text;
      continue;
    }
    payload[key] = value;
  }

  const code = String(options?.code ?? '').trim();
  if (code && byKey.has('code')) payload.code = code;

  const missing = fields
    .filter((field) => field.required && !field.systemGenerated && (payload[field.key] == null || payload[field.key] === ''))
    .map((field) => field.key);
  return { payload, missing };
}

/** First catalog field that can point at the parent (company_id replaced organization_id). */
export function dhmParentRefKey(entity: DhmCatalogShape, candidates: string[]): string | null {
  const keys = new Set((entity.fields ?? []).map((field) => field.key));
  return candidates.find((key) => keys.has(key)) ?? null;
}

function normalizedCatalogKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** External party payload: Group from the master row, Type always Vendor. */
export function externalPartyCatalogExtra(
  entity: DhmCatalogShape | null,
  group: string,
): Record<string, string> {
  const groupText = String(group ?? '').trim();
  if (!entity?.fields?.length) {
    const extra: Record<string, string> = { type: 'Vendor' };
    if (groupText) extra.group = groupText;
    return extra;
  }
  const extra: Record<string, string> = {};
  const groupKey = matchDhmFieldKey(entity, [
    (key) => key === 'group',
    (key) => key.includes('group') && !key.endsWith('id'),
  ]);
  const typeKey = matchDhmFieldKey(entity, [
    (key) => key === 'type',
    (key) => key.includes('party') && key.includes('type'),
  ]);
  if (groupKey && groupText) extra[groupKey] = groupText;
  if (typeKey) extra[typeKey] = 'Vendor';
  return extra;
}

/** Company payload: SAP code as short name, linked Master Site codes as sites. */
export function companyCatalogExtra(
  entity: DhmCatalogShape | null,
  sapCode: string,
  siteCodes: string[],
): Record<string, string | string[]> {
  const code = String(sapCode ?? '').trim();
  const sites = siteCodes.map((item) => String(item ?? '').trim()).filter(Boolean);
  if (!entity?.fields?.length) {
    const extra: Record<string, string | string[]> = {};
    if (code) extra.short_name = code;
    if (sites.length) extra.sites = sites;
    return extra;
  }
  const extra: Record<string, string | string[]> = {};
  const shortKey = matchDhmFieldKey(entity, [
    (key) => key === 'shortname',
    (key) => key.includes('short') && key.includes('name'),
  ]);
  const sitesKey = matchDhmFieldKey(entity, [
    (key) => key === 'sites',
    (key) => key === 'siteids',
    (key) => key.includes('site') && !key.includes('name') && !key.includes('code'),
  ]);
  if (shortKey && code) extra[shortKey] = code;
  if (sitesKey && sites.length) {
    extra[sitesKey] = sitesKey.toLowerCase().endsWith('s') ? sites : sites[0];
  }
  return extra;
}

/** Pick a live catalog field by meaning. System-generated code is never chosen. */
export function matchDhmFieldKey(
  entity: DhmCatalogShape,
  predicates: Array<(normalized: string) => boolean>,
): string | null {
  const fields = entity.fields ?? [];
  for (const predicate of predicates) {
    const found = fields.find((field) => !field.systemGenerated && predicate(normalizedCatalogKey(field.key)));
    if (found) return found.key;
  }
  return null;
}

/** Name-only masters. Optional keys are the hub field names (company_id, site_id). */
export function toDhmNamePayload(
  name: string,
  options?: { code?: string; extra?: Record<string, string> },
): Record<string, unknown> {
  const payload: Record<string, unknown> = { name: String(name ?? '').trim() };
  const code = String(options?.code ?? '').trim();
  if (code) payload.code = code;
  for (const [key, value] of Object.entries(options?.extra ?? {})) {
    const text = String(value ?? '').trim();
    if (text) payload[key] = text;
  }
  return payload;
}

export function dhmDataName(data: Record<string, unknown> | null | undefined): string | null {
  if (!data) return null;
  for (const key of ['name', 'short_name', 'long_name']) {
    const value = data[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return null;
}

/** REFERENCE values may be a code, a UUID, or `{ code }`. */
export function dhmRefCode(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (value && typeof value === 'object' && 'code' in value) {
    const code = (value as { code?: unknown }).code;
    return code != null ? String(code).trim() || null : null;
  }
  return null;
}
