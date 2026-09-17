import { isNumericPortCodeSql, sapSpdDischargePortTextExpr } from './portDisplaySql';

/** Valid human-readable port name (exclude blank / numeric SAP codes). */
export function validPortNameFilterSql(columnExpr: string): string {
  return `NULLIF(TRIM(${columnExpr}), '') IS NOT NULL
    AND TRIM(${columnExpr}) NOT IN ('', '0', '0.00', '-', '—')
    AND NOT (${isNumericPortCodeSql(columnExpr)})`;
}

/** SAP JSON — Vessel Loading Port only (no Port 1 / generic fallbacks). */
export function sapSpdVesselLoadingPortOnlyExpr(spdAlias = 'spd'): string {
  return `NULLIF(TRIM(COALESCE(
    ${spdAlias}.data->'raw'->>'Vessel Loading Port',
    ${spdAlias}.data->'raw'->>'Vessel Loading Port ',
    ${spdAlias}.data->'shipment'->>'vessel_loading_port'
  )), '')`;
}

/** Aggregate KLIP loading port names (vlp + shipment.port_of_loading) per STO group row. */
export function sqlShipmentListLoadingPortsKlipAgg(
  shipmentAlias = 's',
  vlpLoadAlias = 'vlp_load',
): string {
  return `COALESCE(
    NULLIF(
      STRING_AGG(
        DISTINCT NULLIF(TRIM(${vlpLoadAlias}.port_name), ''),
        ', ' ORDER BY NULLIF(TRIM(${vlpLoadAlias}.port_name), '')
      ) FILTER (
        WHERE NULLIF(TRIM(${vlpLoadAlias}.port_name), '') IS NOT NULL
          AND COALESCE(${vlpLoadAlias}.is_cancelled, false) = false
      ),
      ''
    ),
    MAX(NULLIF(TRIM(${shipmentAlias}.port_of_loading), ''))
  ) AS loading_ports_klip`;
}

/** Aggregate KLIP discharge port names per STO group row. */
export function sqlShipmentListDischargePortsKlipAgg(
  shipmentAlias = 's',
  vlpDiscAlias = 'vlp_disc',
): string {
  return `COALESCE(
    NULLIF(
      STRING_AGG(
        DISTINCT NULLIF(TRIM(${vlpDiscAlias}.port_name), ''),
        ', ' ORDER BY NULLIF(TRIM(${vlpDiscAlias}.port_name), '')
      ) FILTER (
        WHERE NULLIF(TRIM(${vlpDiscAlias}.port_name), '') IS NOT NULL
          AND COALESCE(${vlpDiscAlias}.is_cancelled, false) = false
      ),
      ''
    ),
    MAX(NULLIF(TRIM(${shipmentAlias}.port_of_discharge), ''))
  ) AS discharge_ports_klip`;
}

/** SAP raw paths for Vessel Loading Port (incl. multi-port rows). */
const SAP_VESSEL_LOADING_PORT_PATHS = [
  `'Vessel Loading Port'`,
  `'Vessel Loading Port '`,
  `'Vessel Loading Port 2'`,
  `'Vessel Loading Port 3'`,
] as const;

function sapVesselLoadingPortUnionSql(skAlias: string): string {
  return SAP_VESSEL_LOADING_PORT_PATHS.map(
    (path) =>
      `SELECT ${skAlias}.sto_key, NULLIF(TRIM(${skAlias}.data->'raw'->>${path}), '') AS port_name FROM spd_keyed ${skAlias}`,
  ).join('\n          UNION ALL\n          ');
}

function sapVesselDischargePortUnionSql(skAlias: string): string {
  return `SELECT ${skAlias}.sto_key, ${sapSpdDischargePortTextExpr(skAlias)} AS port_name FROM spd_keyed ${skAlias}`;
}

/** SAP port aggregation CTEs — appended after spd_keyed in shipment list SAP join path. */
export const SHIPMENT_LIST_SAP_PORTS_AGG_CTES = `
      sap_loading_port_rows AS (
        SELECT q.sto_key, q.port_name
        FROM (
          ${sapVesselLoadingPortUnionSql('sk')}
        ) q
        WHERE ${validPortNameFilterSql('q.port_name')}
      ),
      sap_discharge_port_rows AS (
        SELECT q.sto_key, q.port_name
        FROM (
          ${sapVesselDischargePortUnionSql('sk')}
        ) q
        WHERE ${validPortNameFilterSql('q.port_name')}
      ),
      sap_loading_ports_agg AS (
        SELECT sto_key, STRING_AGG(DISTINCT port_name, ', ' ORDER BY port_name) AS sap_loading_ports
        FROM sap_loading_port_rows
        GROUP BY sto_key
      ),
      sap_discharge_ports_agg AS (
        SELECT sto_key, STRING_AGG(DISTINCT port_name, ', ' ORDER BY port_name) AS sap_discharge_ports
        FROM sap_discharge_port_rows
        GROUP BY sto_key
      )`;

export const SHIPMENT_LIST_SAP_PORTS_AGG_STUB = `
      sap_loading_ports_agg AS (
        SELECT NULL::text AS sto_key, NULL::text AS sap_loading_ports WHERE false
      ),
      sap_discharge_ports_agg AS (
        SELECT NULL::text AS sto_key, NULL::text AS sap_discharge_ports WHERE false
      )`;
