import { query } from '../database/connection';
import { sqlIsContractSapClosedForStoExpr } from '../utils/contractDeliveryStatus';
import { sapStoNumberKeyExpr } from '../utils/shipmentStoTypeSql';
import { shippingPerfStoMetricsKeyExpr } from '../utils/shippingPerformanceStoSql';

/** ETA milestones on raw `shipments` rows (not grouped `shipment_base` aliases). */
function shipmentTableHasAnyEtaExpr(alias: string): string {
  const f = alias;
  return `(
    ${f}.eta_arrival IS NOT NULL OR ${f}.eta_berthed IS NOT NULL OR ${f}.eta_loading_start IS NOT NULL OR ${f}.eta_loading_complete IS NOT NULL OR ${f}.eta_sailed IS NOT NULL
    OR ${f}.eta_discharge_arrival IS NOT NULL OR ${f}.eta_discharge_berthed IS NOT NULL OR ${f}.eta_discharge_start IS NOT NULL OR ${f}.eta_discharge_complete IS NOT NULL
  )`;
}

export const VESSEL_WILL_FREE_HORIZON_DAYS = 7;

export interface VesselIdleRow {
  vessel_code: string;
  vessel_name: string;
  company: string | null;
  capacity_mt: number | null;
  most_loading_port: string | null;
  most_discharge_port: string | null;
}

export interface VesselWillFreeRow extends VesselIdleRow {
  etc_at_discharge: string;
}

/** Match vessel master row to shipments (name or code). */
function sqlVesselMasterShipmentMatch(vAlias: string, sAlias = 's'): string {
  return `(
    LOWER(TRIM(${sAlias}.vessel_name)) = LOWER(TRIM(${vAlias}.vessel_name))
    OR (
      NULLIF(TRIM(${sAlias}.vessel_code), '') IS NOT NULL
      AND LOWER(TRIM(${sAlias}.vessel_code)) = LOWER(TRIM(${vAlias}.vessel_code))
    )
  )`;
}

function sqlShipmentRowEffectiveStatusExpr(alias: string, contractAlias = 'c'): string {
  const s = alias;
  const stoKey = shippingPerfStoMetricsKeyExpr(contractAlias, s);
  return `(
    CASE
      WHEN UPPER(TRIM(COALESCE(${s}.status, ''))) = 'CANCELLED' THEN 'CANCELLED'
      WHEN ${sqlIsContractSapClosedForStoExpr(contractAlias, stoKey)} THEN 'COMPLETED'
      WHEN ${s}.ata_discharge_complete IS NOT NULL THEN 'COMPLETED'
      WHEN ${s}.ata_discharge_start IS NOT NULL THEN 'UNLOADING'
      WHEN ${s}.ata_discharge_berthed IS NOT NULL THEN 'BERTHED_DP'
      WHEN ${s}.ata_discharge_arrival IS NOT NULL THEN 'ARRIVED_DP'
      WHEN ${s}.ata_sailed IS NOT NULL THEN 'SAILED'
      WHEN ${s}.ata_loading_complete IS NOT NULL THEN 'COMPLETED_LOADING'
      WHEN ${s}.ata_loading_start IS NOT NULL THEN 'LOADING'
      WHEN ${s}.ata_berthed IS NOT NULL THEN 'BERTHED_LP'
      WHEN ${s}.ata_arrival IS NOT NULL THEN 'ARRIVED_LP'
      WHEN ${shipmentTableHasAnyEtaExpr(s)} THEN 'PLANNED'
      ELSE 'UNPLANNED'
    END
  )`;
}

function sqlShipmentRowOngoingExpr(alias: string, contractAlias = 'c'): string {
  const eff = sqlShipmentRowEffectiveStatusExpr(alias, contractAlias);
  return `${eff} IN (
    'ARRIVED_LP', 'BERTHED_LP', 'LOADING', 'COMPLETED_LOADING',
    'SAILED', 'ARRIVED_DP', 'BERTHED_DP', 'UNLOADING'
  )`;
}

function sqlShipmentRowPlannedExpr(alias: string, contractAlias = 'c'): string {
  return `${sqlShipmentRowEffectiveStatusExpr(alias, contractAlias)} = 'PLANNED'`;
}

function sqlShipmentRowActiveEngagementExpr(alias: string, contractAlias = 'c'): string {
  const s = alias;
  const stoKey = shippingPerfStoMetricsKeyExpr(contractAlias, s);
  return `(
    UPPER(TRIM(COALESCE(${s}.status, ''))) NOT IN ('COMPLETED', 'CANCELLED', 'CANCELED')
    AND NOT (${sqlIsContractSapClosedForStoExpr(contractAlias, stoKey)})
    AND ${s}.ata_discharge_complete IS NULL
  )`;
}

/** Uses `latest_spd.effective_sto` — not sap_processed_data JSON (alias may be latest_spd CTE). */
function sqlShipmentRowHasSapStoFromLatestSpdExpr(
  contractAlias = 'c',
  latestSpdAlias = 'spd',
): string {
  return `NULLIF(TRIM(COALESCE(
    NULLIF(TRIM(${contractAlias}.sto_number::text), ''),
    ${latestSpdAlias}.effective_sto,
    ''
  )), '') IS NOT NULL`;
}

function sqlShipmentDischargeEtcExpr(shipmentAlias: string, dischargePortAlias: string): string {
  return `COALESCE(${dischargePortAlias}.discharge_eta_completed, ${shipmentAlias}.eta_discharge_complete::date)`;
}

function sqlLatestSpdCte(): string {
  return `
    latest_spd AS (
      SELECT DISTINCT ON (spd.contract_number)
        spd.contract_number,
        ${sapStoNumberKeyExpr('spd')} AS effective_sto
      FROM sap_processed_data spd
      WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) <> ''
      ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
    )`;
}

function sqlDischargePortLateralJoin(shipmentAlias: string, dischargePortAlias: string): string {
  return `
    LEFT JOIN LATERAL (
      SELECT vlp.eta_vessel_complete_discharge::date AS discharge_eta_completed
      FROM vessel_loading_ports vlp
      WHERE vlp.shipment_id = ${shipmentAlias}.id
        AND COALESCE(vlp.is_discharge_port, false) = true
      ORDER BY vlp.port_sequence NULLS LAST, vlp.id
      LIMIT 1
    ) ${dischargePortAlias} ON true`;
}

export function buildVesselIdleListQuery(): string {
  const vesselMatch = sqlVesselMasterShipmentMatch('mv', 's');
  const hasSapSto = sqlShipmentRowHasSapStoFromLatestSpdExpr('c', 'spd');
  const isPlanned = sqlShipmentRowPlannedExpr('s', 'c');
  const isOngoing = sqlShipmentRowOngoingExpr('s', 'c');

  return `
    WITH ${sqlLatestSpdCte()},
    busy_vessel_ids AS (
      SELECT DISTINCT mv.id
      FROM master_vessels mv
      INNER JOIN shipments s ON ${vesselMatch}
      LEFT JOIN contracts c ON s.contract_id = c.id
      LEFT JOIN latest_spd spd ON spd.contract_number = c.contract_id
      WHERE ${sqlShipmentRowActiveEngagementExpr('s', 'c')}
        AND (
          ${hasSapSto}
          OR ${isPlanned}
          OR ${isOngoing}
        )
    ),
    idle_vessels AS (
      SELECT
        mv.id,
        mv.vessel_code,
        mv.vessel_name,
        NULLIF(TRIM(mv.vessel_owner_group), '') AS company,
        mv.vessel_capacity_mt AS capacity_mt
      FROM master_vessels mv
      WHERE mv.id NOT IN (SELECT id FROM busy_vessel_ids)
        -- Vessel idle is charter-relevant only for Time Charter (T/C) vessels.
        AND UPPER(TRIM(COALESCE(mv.terms, ''))) = 'T/C'
    ),
    port_usage AS (
      SELECT
        iv.id AS vessel_id,
        TRIM(p.port_name) AS port_name,
        p.is_discharge,
        COUNT(*)::int AS usage_count
      FROM idle_vessels iv
      INNER JOIN shipments s ON ${sqlVesselMasterShipmentMatch('iv', 's')}
      CROSS JOIN LATERAL (
        SELECT TRIM(vlp.port_name) AS port_name, COALESCE(vlp.is_discharge_port, false) AS is_discharge
        FROM vessel_loading_ports vlp
        WHERE vlp.shipment_id = s.id
          AND NULLIF(TRIM(COALESCE(vlp.port_name, '')), '') IS NOT NULL
        UNION ALL
        SELECT TRIM(s.port_of_loading), false
        WHERE NULLIF(TRIM(COALESCE(s.port_of_loading, '')), '') IS NOT NULL
        UNION ALL
        SELECT TRIM(s.port_of_discharge), true
        WHERE NULLIF(TRIM(COALESCE(s.port_of_discharge, '')), '') IS NOT NULL
      ) p
      GROUP BY iv.id, TRIM(p.port_name), p.is_discharge
    ),
    most_loading AS (
      SELECT DISTINCT ON (vessel_id)
        vessel_id,
        port_name AS most_loading_port
      FROM port_usage
      WHERE is_discharge = false
      ORDER BY vessel_id, usage_count DESC, port_name ASC
    ),
    most_discharge AS (
      SELECT DISTINCT ON (vessel_id)
        vessel_id,
        port_name AS most_discharge_port
      FROM port_usage
      WHERE is_discharge = true
      ORDER BY vessel_id, usage_count DESC, port_name ASC
    )
    SELECT
      iv.vessel_code,
      iv.vessel_name,
      iv.company,
      iv.capacity_mt,
      ml.most_loading_port,
      md.most_discharge_port
    FROM idle_vessels iv
    LEFT JOIN most_loading ml ON ml.vessel_id = iv.id
    LEFT JOIN most_discharge md ON md.vessel_id = iv.id
    ORDER BY iv.vessel_name ASC, iv.vessel_code ASC`;
}

/** T/C vessels with on-going shipment whose ETC at Discharge Port falls within the next 7 days. */
export function buildVesselWillFreeListQuery(): string {
  const vesselMatch = sqlVesselMasterShipmentMatch('mv', 's');
  const isOngoing = sqlShipmentRowOngoingExpr('s', 'c');
  const etcExpr = sqlShipmentDischargeEtcExpr('s', 'dp');

  return `
    WITH ${sqlLatestSpdCte()},
    will_free_vessels AS (
      SELECT
        mv.id,
        mv.vessel_code,
        mv.vessel_name,
        NULLIF(TRIM(mv.vessel_owner_group), '') AS company,
        mv.vessel_capacity_mt AS capacity_mt,
        MAX(${etcExpr}) AS etc_at_discharge
      FROM master_vessels mv
      INNER JOIN shipments s ON ${vesselMatch}
      LEFT JOIN contracts c ON s.contract_id = c.id
      ${sqlDischargePortLateralJoin('s', 'dp')}
      WHERE UPPER(TRIM(COALESCE(mv.terms, ''))) = 'T/C'
        AND ${sqlShipmentRowActiveEngagementExpr('s', 'c')}
        AND ${isOngoing}
        AND ${etcExpr} IS NOT NULL
      GROUP BY mv.id, mv.vessel_code, mv.vessel_name, mv.vessel_owner_group, mv.vessel_capacity_mt
      HAVING MAX(${etcExpr}) >= CURRENT_DATE
        AND MAX(${etcExpr}) <= CURRENT_DATE + ${VESSEL_WILL_FREE_HORIZON_DAYS}
    ),
    port_usage AS (
      SELECT
        wfv.id AS vessel_id,
        TRIM(p.port_name) AS port_name,
        p.is_discharge,
        COUNT(*)::int AS usage_count
      FROM will_free_vessels wfv
      INNER JOIN shipments s ON ${sqlVesselMasterShipmentMatch('wfv', 's')}
      CROSS JOIN LATERAL (
        SELECT TRIM(vlp.port_name) AS port_name, COALESCE(vlp.is_discharge_port, false) AS is_discharge
        FROM vessel_loading_ports vlp
        WHERE vlp.shipment_id = s.id
          AND NULLIF(TRIM(COALESCE(vlp.port_name, '')), '') IS NOT NULL
        UNION ALL
        SELECT TRIM(s.port_of_loading), false
        WHERE NULLIF(TRIM(COALESCE(s.port_of_loading, '')), '') IS NOT NULL
        UNION ALL
        SELECT TRIM(s.port_of_discharge), true
        WHERE NULLIF(TRIM(COALESCE(s.port_of_discharge, '')), '') IS NOT NULL
      ) p
      GROUP BY wfv.id, TRIM(p.port_name), p.is_discharge
    ),
    most_loading AS (
      SELECT DISTINCT ON (vessel_id)
        vessel_id,
        port_name AS most_loading_port
      FROM port_usage
      WHERE is_discharge = false
      ORDER BY vessel_id, usage_count DESC, port_name ASC
    ),
    most_discharge AS (
      SELECT DISTINCT ON (vessel_id)
        vessel_id,
        port_name AS most_discharge_port
      FROM port_usage
      WHERE is_discharge = true
      ORDER BY vessel_id, usage_count DESC, port_name ASC
    )
    SELECT
      wfv.vessel_code,
      wfv.vessel_name,
      wfv.company,
      wfv.capacity_mt,
      ml.most_loading_port,
      md.most_discharge_port,
      wfv.etc_at_discharge::text AS etc_at_discharge
    FROM will_free_vessels wfv
    LEFT JOIN most_loading ml ON ml.vessel_id = wfv.id
    LEFT JOIN most_discharge md ON md.vessel_id = wfv.id
    ORDER BY wfv.etc_at_discharge ASC, wfv.vessel_name ASC, wfv.vessel_code ASC`;
}

function normalizeVesselIdleRow(row: Record<string, unknown>): VesselIdleRow {
  const capacityRaw = row.capacity_mt;
  const capacity =
    capacityRaw === null || capacityRaw === undefined
      ? null
      : Number.isFinite(Number(capacityRaw))
        ? Number(capacityRaw)
        : null;
  return {
    vessel_code: String(row.vessel_code ?? '').trim(),
    vessel_name: String(row.vessel_name ?? '').trim(),
    company: row.company != null ? String(row.company).trim() || null : null,
    capacity_mt: capacity,
    most_loading_port:
      row.most_loading_port != null ? String(row.most_loading_port).trim() || null : null,
    most_discharge_port:
      row.most_discharge_port != null ? String(row.most_discharge_port).trim() || null : null,
  };
}

function normalizeVesselWillFreeRow(row: Record<string, unknown>): VesselWillFreeRow {
  const base = normalizeVesselIdleRow(row);
  const etcRaw = row.etc_at_discharge;
  const etc =
    etcRaw instanceof Date
      ? etcRaw.toISOString().slice(0, 10)
      : String(etcRaw ?? '').trim().slice(0, 10);
  return {
    ...base,
    etc_at_discharge: etc,
  };
}

export async function loadVesselIdleList(): Promise<{
  count: number;
  vessels: VesselIdleRow[];
  willFreeCount: number;
  willFree: VesselWillFreeRow[];
}> {
  const [idleResult, willFreeResult] = await Promise.all([
    query(buildVesselIdleListQuery(), []),
    query(buildVesselWillFreeListQuery(), []),
  ]);
  const vessels = idleResult.rows.map((row) =>
    normalizeVesselIdleRow(row as Record<string, unknown>),
  );
  const willFree = willFreeResult.rows.map((row) =>
    normalizeVesselWillFreeRow(row as Record<string, unknown>),
  );
  return {
    count: vessels.length,
    vessels,
    willFreeCount: willFree.length,
    willFree,
  };
}
