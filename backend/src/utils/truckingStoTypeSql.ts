/**
 * Trucking page transport scope — contract Sea/Land = LAND only (aligned with Shipments SEA/MIX approach).
 * No SAP STO Type filter on the trucking list/calendar/suggestions.
 */

/** Effective Sea/Land from contract row with SAP fallback (matches Contracts page). */
export function contractEffectiveSeaLandExpr(contractAlias = 'c'): string {
  return `UPPER(TRIM(COALESCE(
    NULLIF(TRIM(${contractAlias}.transport_mode), ''),
    (
      SELECT COALESCE(
        spd.data->'contract'->>'transport_mode',
        spd.data->'contract'->>'sea_land',
        spd.data->'raw'->>'Sea / Land',
        spd.data->'raw'->>'Sea_Land'
      )
      FROM sap_processed_data spd
      WHERE TRIM(spd.contract_number) = TRIM((${contractAlias}).contract_id::text)
      ORDER BY spd.created_at DESC NULLS LAST
      LIMIT 1
    ),
    'LAND'
  )))`;
}

/** Trucking page scope: LAND transport only (excludes SEA and MIX). */
export function buildTruckingPageLandTransportSql(contractAlias = 'c'): string {
  return `${contractEffectiveSeaLandExpr(contractAlias)} = 'LAND'`;
}

export function buildTruckingPageListScopeSql(): string {
  return buildTruckingPageLandTransportSql('c');
}

/** AND-prefixed WHERE fragment for trucking list, calendar, get-by-id, and contract suggestions. */
export const truckingPageListScopeWhereSql = `AND ${buildTruckingPageListScopeSql()}`;

export const truckingPageLandTransportForContractWhereSql = truckingPageListScopeWhereSql;
