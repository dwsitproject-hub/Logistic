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
