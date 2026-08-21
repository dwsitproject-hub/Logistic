/**
 * SQL helpers for canonical vessel identity (normalized name + code aliases).
 */

/** SQL expression matching normalizeVesselName() in vesselNameNormalize.ts */
export function sqlNormalizeVesselNameExpr(nameExpr: string): string {
  return `normalize_vessel_name(${nameExpr})`;
}

/** Resolve shipment row to master_vessels.id via alias code, primary code, or normalized name. */
export function sqlResolveMasterVesselIdFromShipment(shipmentAlias = 's'): string {
  const normShipmentName = sqlNormalizeVesselNameExpr(`${shipmentAlias}.vessel_name`);
  return `COALESCE(
    ${shipmentAlias}.master_vessel_id,
    (
      SELECT mv.id
      FROM master_vessel_code_aliases a
      INNER JOIN master_vessels mv ON mv.id = a.master_vessel_id
      WHERE upper(trim(a.vessel_code)) = upper(trim(${shipmentAlias}.vessel_code))
      LIMIT 1
    ),
    (
      SELECT mv.id
      FROM master_vessels mv
      WHERE upper(trim(mv.vessel_code)) = upper(trim(${shipmentAlias}.vessel_code))
      LIMIT 1
    ),
    (
      SELECT mv.id
      FROM master_vessels mv
      WHERE mv.normalized_vessel_name = ${normShipmentName}
        AND NULLIF(trim(${shipmentAlias}.vessel_name), '') IS NOT NULL
      ORDER BY CASE WHEN mv.code_status = 'OFFICIAL' THEN 0 ELSE 1 END, mv.updated_at DESC
      LIMIT 1
    )
  )`;
}

/** Match canonical master vessel row to shipment (alias code, primary code, or normalized name). */
export function sqlVesselCanonicalShipmentMatch(vAlias: string, sAlias = 's'): string {
  const normMaster = `${vAlias}.normalized_vessel_name`;
  const normShipment = sqlNormalizeVesselNameExpr(`${sAlias}.vessel_name`);
  return `(
    ${vAlias}.id = ${sqlResolveMasterVesselIdFromShipment(sAlias)}
    OR (
      NULLIF(trim(${sAlias}.vessel_code), '') IS NOT NULL
      AND upper(trim(${sAlias}.vessel_code)) = upper(trim(${vAlias}.vessel_code))
    )
    OR (
      NULLIF(trim(${sAlias}.vessel_name), '') IS NOT NULL
      AND ${normMaster} = ${normShipment}
    )
    OR EXISTS (
      SELECT 1 FROM master_vessel_code_aliases a
      WHERE a.master_vessel_id = ${vAlias}.id
        AND upper(trim(a.vessel_code)) = upper(trim(${sAlias}.vessel_code))
    )
  )`;
}

/** Lateral join master_vessels using alias table + normalized name (replaces dual OR match). */
export function sqlMasterVesselCanonicalLateralJoin(
  vesselCodeExpr: string,
  vesselNameExpr: string,
  alias = 'mv',
  masterVesselIdExpr?: string,
): string {
  const normName = sqlNormalizeVesselNameExpr(vesselNameExpr);
  const idMatch = masterVesselIdExpr
    ? `OR (
            ${masterVesselIdExpr} IS NOT NULL
            AND mv.id = ${masterVesselIdExpr}
          )`
    : '';
  const idRank = masterVesselIdExpr
    ? `CASE WHEN ${masterVesselIdExpr} IS NOT NULL AND mv.id = ${masterVesselIdExpr} THEN 0 ELSE 1 END,`
    : '';
  return `
      LEFT JOIN LATERAL (
        SELECT
          mv.id,
          mv.vessel_name AS vessel_name_master,
          mv.vessel_code AS vessel_code_master,
          mv.vessel_owner AS vessel_owner_master,
          mv.vessel_capacity_mt AS vessel_capacity_mt_master,
          mv.vessel_type AS vessel_type_master,
          mv.terms AS vessel_terms_master
        FROM master_vessels mv
        LEFT JOIN master_vessel_code_aliases a
          ON a.master_vessel_id = mv.id
          AND NULLIF(trim(${vesselCodeExpr}), '') IS NOT NULL
          AND upper(trim(a.vessel_code)) = upper(trim(${vesselCodeExpr}))
        WHERE (
          a.id IS NOT NULL
          OR (
            NULLIF(trim(${vesselCodeExpr}), '') IS NOT NULL
            AND upper(trim(${vesselCodeExpr})) NOT IN ('#N/A', 'N/A')
            AND upper(trim(mv.vessel_code)) = upper(trim(${vesselCodeExpr}))
          )
          OR (
            NULLIF(trim(${vesselNameExpr}), '') IS NOT NULL
            AND mv.normalized_vessel_name = ${normName}
          )
          ${idMatch}
        )
        ORDER BY
          ${idRank}
          CASE WHEN a.is_primary THEN 0 WHEN a.id IS NOT NULL THEN 1 ELSE 2 END,
          CASE WHEN upper(trim(COALESCE(${vesselCodeExpr}, ''))) = upper(trim(mv.vessel_code)) THEN 0 ELSE 1 END,
          CASE WHEN mv.code_status = 'OFFICIAL' THEN 0 ELSE 1 END,
          mv.updated_at DESC
        LIMIT 1
      ) ${alias} ON TRUE`;
}
