/**
 * SQL helpers to resolve display vessel name from master_vessels (KLIP) with SAP / shipment fallbacks.
 */
import {
  sqlMasterVesselCanonicalLateralJoin,
  sqlNormalizeVesselNameExpr,
} from './masterVesselCanonicalSql';

export { sqlNormalizeVesselNameExpr };

export function sqlMasterVesselLateralJoin(
  vesselCodeExpr: string,
  vesselNameExpr: string,
  alias = 'mv',
  masterVesselIdExpr?: string,
): string {
  return sqlMasterVesselCanonicalLateralJoin(
    vesselCodeExpr,
    vesselNameExpr,
    alias,
    masterVesselIdExpr,
  );
}

/** Shipments list: lateral join master_vessels using sp + sap_latest (sl) aliases. */
export const SHIPMENT_LIST_MASTER_VESSEL_LATERAL_JOIN = sqlMasterVesselLateralJoin(
  'COALESCE(sp.vessel_code, sl.vessel_code_sap)',
  'COALESCE(sp.vessel_name, sl.vessel_name_sap)',
  'mv',
  'sp.master_vessel_id',
);

/** Compact skipSapJoin shell — KLIP vessel only (no sap_latest). */
export const SHIPMENT_LIST_MASTER_VESSEL_LATERAL_JOIN_SHELL = sqlMasterVesselLateralJoin(
  'sp.vessel_code',
  'sp.vessel_name',
  'mv',
  'sp.master_vessel_id',
);

/** Shipping performance: lateral join using shipments s + sap_agg sa aliases. */
export const SHIPPING_PERF_MASTER_VESSEL_LATERAL_JOIN = sqlMasterVesselLateralJoin(
  's.vessel_code',
  'COALESCE(s.vessel_name, sa.vessel_name_sap)',
  'mv',
  's.master_vessel_id',
);
