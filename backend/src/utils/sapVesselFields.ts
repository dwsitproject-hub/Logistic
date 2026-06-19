/** Shared SAP JSON paths for vessel identity (shipments list + distribution). */

export const SAP_VESSEL_NAME_FROM_SK_SQL = `NULLIF(TRIM(COALESCE(
  sk.data->'shipment'->>'vessel_name',
  sk.data->'vessel'->>'vessel_name',
  sk.data->'raw'->>'Vessel Name',
  sk.data->'raw'->>'Vessel',
  sk.data->'raw'->>'vessel name'
)), '')`;

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

export function hasCompleteSapVesselIdentity(identity: SapVesselIdentity): boolean {
  return Boolean(identity.vessel_code && identity.vessel_name);
}
