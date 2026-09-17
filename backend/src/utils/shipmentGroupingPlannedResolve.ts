import { query } from '../database/connection';
import {
  humanReadablePortNameExpr,
  sapSpdDischargePortTextExpr,
  sapSpdLoadingPortTextExpr,
} from '../utils/portDisplaySql';
import { charterTypeFromMasterTerms } from '../utils/shipmentGroupingPlannedClassify';
import { normalizeVesselName } from '../utils/vesselNameNormalize';

export type MasterVesselForPlanning = {
  vesselName: string;
  vesselCode: string | null;
  vesselOwner: string | null;
  vesselCapacityMt: number | null;
  vesselHullType: string | null;
  charterType: string;
};

export async function fetchMasterVesselNamesForGroupingTemplate(): Promise<string[]> {
  const res = await query(
    `
      SELECT DISTINCT NULLIF(TRIM(vessel_name), '') AS vessel_name
      FROM master_vessels
      WHERE NULLIF(TRIM(vessel_name), '') IS NOT NULL
      ORDER BY 1
    `,
  );
  return res.rows.map((row: { vessel_name: string }) => String(row.vessel_name));
}

export async function fetchMasterVesselsForPlanning(): Promise<MasterVesselForPlanning[]> {
  const res = await query(
    `
      SELECT vessel_name, vessel_code, vessel_owner, vessel_capacity_mt, vessel_type, terms
      FROM master_vessels
      WHERE NULLIF(TRIM(vessel_name), '') IS NOT NULL
    `,
  );
  return res.rows.map((row) => ({
    vesselName: String(row.vessel_name ?? '').trim(),
    vesselCode: row.vessel_code != null ? String(row.vessel_code).trim() || null : null,
    vesselOwner: row.vessel_owner != null ? String(row.vessel_owner).trim() || null : null,
    vesselCapacityMt:
      row.vessel_capacity_mt != null && Number.isFinite(Number(row.vessel_capacity_mt))
        ? Number(row.vessel_capacity_mt)
        : null,
    vesselHullType: row.vessel_type != null ? String(row.vessel_type).trim() || null : null,
    charterType: charterTypeFromMasterTerms(row.terms),
  }));
}

export function matchMasterVesselForPlanning(
  vessels: MasterVesselForPlanning[],
  rawName: string,
): MasterVesselForPlanning | null {
  const wanted = String(rawName ?? '').trim();
  if (!wanted) return null;
  const wantedNorm = normalizeVesselName(wanted);
  const wantedUpper = wanted.toUpperCase();
  const byName = vessels.find(
    (v) =>
      normalizeVesselName(v.vesselName) === wantedNorm ||
      v.vesselName.trim().toUpperCase() === wantedUpper,
  );
  if (byName) return byName;
  const byCode = vessels.find(
    (v) => v.vesselCode && v.vesselCode.replace(/\s+/g, '').toUpperCase() === wanted.replace(/\s+/g, '').toUpperCase(),
  );
  return byCode ?? null;
}

export type SapPortsForContract = {
  contractUuid: string;
  contractNumber: string;
  loadingPort: string;
  dischargePort: string;
};

export async function fetchSapPortsForContractUuids(
  contractUuids: string[],
): Promise<Map<string, SapPortsForContract>> {
  const ids = [...new Set(contractUuids.map((id) => String(id).trim()).filter(Boolean))];
  const map = new Map<string, SapPortsForContract>();
  if (ids.length === 0) return map;

  const loadingExpr = humanReadablePortNameExpr(sapSpdLoadingPortTextExpr('lss'));
  const dischargeExpr = humanReadablePortNameExpr(sapSpdDischargePortTextExpr('lss'));
  const res = await query(
    `
      SELECT
        c.id::text AS id,
        c.contract_id AS contract_number,
        ${loadingExpr} AS loading_port,
        ${dischargeExpr} AS discharge_port
      FROM contracts c
      LEFT JOIN contract_latest_spd_snapshot lss ON lss.contract_number = c.contract_id
      WHERE c.id = ANY($1::uuid[])
    `,
    [ids],
  );
  for (const row of res.rows) {
    const contractUuid = String(row.id);
    map.set(contractUuid, {
      contractUuid,
      contractNumber: String(row.contract_number ?? '').trim(),
      loadingPort: String(row.loading_port ?? '').trim(),
      dischargePort: String(row.discharge_port ?? '').trim(),
    });
  }
  return map;
}
