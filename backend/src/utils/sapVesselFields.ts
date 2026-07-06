/** Shared SAP JSON paths for vessel identity (shipments list + distribution). */

export function sqlSapVesselNameFromSpdJsonb(dataExpr: string): string {
  return `NULLIF(TRIM(COALESCE(
    ${dataExpr}->'shipment'->>'vessel_name',
    ${dataExpr}->'vessel'->>'vessel_name',
    ${dataExpr}->'raw'->>'Vessel Name',
    ${dataExpr}->'raw'->>'Vessel',
    ${dataExpr}->'raw'->>'vessel name'
  )), '')`;
}

export const SAP_VESSEL_NAME_FROM_SK_SQL = sqlSapVesselNameFromSpdJsonb('sk.data');

export const SAP_VESSEL_CODE_FROM_SK_SQL = `NULLIF(TRIM(COALESCE(
  sk.data->'shipment'->>'vessel_code',
  sk.data->'vessel'->>'vessel_code',
  sk.data->'raw'->>'Vessel Code',
  sk.data->'raw'->>'vessel code'
)), '')`;

export const SAP_VESSEL_OWNER_FROM_SK_SQL = `NULLIF(TRIM(COALESCE(
  sk.data->'shipment'->>'vessel_owner',
  sk.data->'vessel'->>'vessel_owner',
  sk.data->'raw'->>'Vessel Owner',
  sk.data->'raw'->>'Vessel Company',
  sk.data->'raw'->>'vessel owner'
)), '')`;

function pickSapText(...values: unknown[]): string | null {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).replace(/\r/g, '').trim();
    if (!text || text === '0.00') continue;
    return text;
  }
  return null;
}

export type SapVesselIdentity = {
  vessel_code: string | null;
  vessel_name: string | null;
  vessel_owner: string | null;
};

/** Resolve vessel code/name/owner from normalized SAP payload objects. */
export function resolveSapVesselIdentity(
  shipment: Record<string, unknown> | null | undefined,
  vessel: Record<string, unknown> | null | undefined,
  raw: Record<string, unknown> | null | undefined,
): SapVesselIdentity {
  const ship = shipment ?? {};
  const ves = vessel ?? {};
  const rawRow = raw ?? {};

  return {
    vessel_code: pickSapText(
      ship.vessel_code,
      ves.vessel_code,
      rawRow['Vessel Code'],
      rawRow['vessel code'],
    ),
    vessel_name: pickSapText(
      ship.vessel_name,
      ship.vessel,
      ves.vessel_name,
      ves.name,
      rawRow['Vessel Name'],
      rawRow.Vessel,
      rawRow['vessel name'],
    ),
    vessel_owner: pickSapText(
      ship.vessel_owner,
      ves.vessel_owner,
      rawRow['Vessel Owner'],
      rawRow['Vessel Company'],
      rawRow['vessel owner'],
    ),
  };
}

/** View-table vessel: SAP Vessel Name first, then KLIP user input on shipments. */
export function resolveShipmentDisplayVesselName(
  vesselNameSap: unknown,
  vesselNameKlip: unknown,
): string | null {
  const sap = pickSapText(vesselNameSap);
  const klip = pickSapText(vesselNameKlip);
  return sap ?? klip;
}

export const sqlShipmentDisplayVesselName = (
  sapExpr: string,
  klipExpr: string,
): string => `COALESCE(${sapExpr}, NULLIF(TRIM(${klipExpr}), ''))`;

export function hasCompleteSapVesselIdentity(identity: SapVesselIdentity): boolean {
  return Boolean(identity.vessel_code && identity.vessel_name);
}
