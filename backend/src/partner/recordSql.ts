import { shipmentPageEffectiveStatusExpr } from '../utils/shipmentListFilters';
import { sqlResolveMasterVesselIdFromShipment } from '../utils/masterVesselCanonicalSql';
import { buildShipmentDailyBaseCteSql } from '../utils/shipmentPipelineDailySummarySql';

/**
 * SQL behind the KMAPS partner records (partner/refresh.ts). Four reads, all set-based, joined in TypeScript:
 *
 *   groups   one row per shipment as the Shipments page shows it (one STO key), with the page's own stage - the SAME base the pipeline summary builds
 *            (buildShipmentDailyBaseCteSql) read with the page's expression (shipmentPageEffectiveStatusExpr), not a copy of the rule.
 *   primary  the vessel, ports and identifiers of each group's primary shipment, the one the Edit Shipment modal opens.
 *   legs     the planned port calls of those primary shipments.
 *   lines    one row per member shipment: contract, PO, product, quantity, price.
 *
 * Dates are formatted in SQL (to_char) so a DATE never passes through a JavaScript Date and its time zone.
 */

const D = (expr: string, alias: string) => `to_char(${expr}, 'YYYY-MM-DD') AS ${alias}`;

/** The group rows. No parameters: the full page scope, exactly as the pipeline summary reads it. */
export function buildPartnerGroupsSql(): string {
  const base = buildShipmentDailyBaseCteSql({
    ownSto: true,
    extraCoreSelect: 'ARRAY_AGG(s.id ORDER BY s.created_at, s.id) AS member_ids',
  });
  return `${base}
    SELECT
      TRIM(sb.sto_key::text) AS sto_key,
      sb.id::text AS primary_id,
      sb.member_ids::text[] AS member_ids,
      sb.master_vessel_id::text AS master_vessel_id,
      ${shipmentPageEffectiveStatusExpr('sb')} AS stage,
      ${D('sb.eta_arrival', 'eta_loading_arrival')},
      ${D('sb.eta_berthed', 'eta_loading_berthed')},
      ${D('sb.eta_loading_start', 'eta_loading_start')},
      ${D('sb.eta_loading_complete', 'eta_loading_end')},
      ${D('sb.eta_sailed', 'eta_sailed')},
      ${D('sb.eta_discharge_arrival', 'eta_discharge_arrival')},
      ${D('sb.eta_discharge_berthed', 'eta_discharge_berthed')},
      ${D('sb.eta_discharge_start', 'eta_discharge_start')},
      ${D('sb.eta_vessel_complete_discharge', 'eta_discharge_end')},
      ${D('sb.ata_vessel_arrival_at_loading_port', 'ata_loading_arrival')},
      ${D('sb.ata_vessel_berthed_at_loading_port', 'ata_loading_berthed')},
      ${D('sb.ata_vessel_start_loading', 'ata_loading_start')},
      ${D('sb.ata_vessel_completed_loading', 'ata_loading_end')},
      ${D('sb.ata_vessel_sailed_from_loading_port', 'ata_sailed')},
      ${D('sb.ata_vessel_arrive_at_discharge_port', 'ata_discharge_arrival')},
      ${D('sb.ata_vessel_berthed_at_discharge_port', 'ata_discharge_berthed')},
      ${D('sb.ata_vessel_start_discharging', 'ata_discharge_start')},
      ${D('sb.ata_vessel_complete_discharge', 'ata_discharge_end')}
    FROM shipment_base sb
    WHERE NULLIF(TRIM(sb.sto_key::text), '') IS NOT NULL`;
}

/**
 * Vessel, ports and identifiers of the primary shipments. $1 = primary shipment ids, $2 = group master vessel ids (same order, NULL where the group has none).
 *
 * The Master Vessel is the group's own pick, else the same resolution the page and JPS use (link, alias code, primary code, normalized name). The
 * ports follow jps/eligibility.ts: the shipment's own Master Port, else the active leg's. A port or vessel deleted in DHM gives no code.
 */
export const PARTNER_PRIMARY_SQL = `
  SELECT
    g.primary_id::text AS primary_id,
    s.shipment_id AS shipment_no,
    s.voyage_no,
    s.charter_type,
    s.vessel_name AS shipment_vessel_name,
    NULLIF(TRIM(s.vessel_code), '') AS shipment_vessel_code,
    mv.id::text AS mv_id,
    mv.vessel_name AS mv_name,
    CASE WHEN COALESCE(mv.dhm_is_deleted, FALSE) THEN NULL ELSE NULLIF(TRIM(mv.dhm_code), '') END AS vessel_dhm_code,
    mv.vessel_role AS mv_role,
    NULLIF(TRIM(mv.vessel_code), '') AS mv_vessel_code,
    (SELECT ARRAY_AGG(DISTINCT UPPER(TRIM(a.vessel_code)))
       FROM master_vessel_code_aliases a
      WHERE a.master_vessel_id = mv.id AND NULLIF(TRIM(a.vessel_code), '') IS NOT NULL) AS mv_alias_codes,
    lp.name AS loading_port_name,
    lp.code AS loading_port_code,
    dp.name AS discharge_port_name,
    dp.code AS discharge_port_code
  FROM unnest($1::uuid[], $2::uuid[]) AS g(primary_id, master_vessel_id)
  JOIN shipments s ON s.id = g.primary_id
  LEFT JOIN master_vessels mv ON mv.id = COALESCE(g.master_vessel_id, ${sqlResolveMasterVesselIdFromShipment('s')})
  LEFT JOIN LATERAL (
    SELECT m.port AS name, CASE WHEN COALESCE(m.dhm_is_deleted, FALSE) THEN NULL ELSE NULLIF(TRIM(m.code_dhm), '') END AS code
      FROM master_loading_ports m
     WHERE m.id = COALESCE(
             s.loading_master_port_id,
             (SELECT v.master_port_id FROM vessel_loading_ports v
               WHERE v.shipment_id = s.id AND COALESCE(v.is_discharge_port, FALSE) IS NOT TRUE
                 AND COALESCE(v.is_cancelled, FALSE) IS NOT TRUE AND v.master_port_id IS NOT NULL
               ORDER BY v.port_sequence ASC LIMIT 1))
  ) lp ON TRUE
  LEFT JOIN LATERAL (
    SELECT m.port AS name, CASE WHEN COALESCE(m.dhm_is_deleted, FALSE) THEN NULL ELSE NULLIF(TRIM(m.code_dhm), '') END AS code
      FROM master_loading_ports m
     WHERE m.id = COALESCE(
             s.discharge_master_port_id,
             (SELECT v.master_port_id FROM vessel_loading_ports v
               WHERE v.shipment_id = s.id AND COALESCE(v.is_discharge_port, FALSE) IS TRUE
                 AND COALESCE(v.is_cancelled, FALSE) IS NOT TRUE AND v.master_port_id IS NOT NULL
               ORDER BY v.port_sequence DESC LIMIT 1))
  ) dp ON TRUE`;

/**
 * The planned port calls of the primary shipments ($1 = primary ids), cancelled ones left out, in order. Times are TIMESTAMP without a zone, entered in WIB:
 * they are returned as text so the zone is added once, in TypeScript (partner/format.ts), never by the driver.
 */
export const PARTNER_LEGS_SQL = `
  SELECT
    v.shipment_id::text AS primary_id,
    v.port_sequence,
    COALESCE(v.is_discharge_port, FALSE) AS is_discharge,
    v.port_name,
    m.port AS master_port_name,
    CASE WHEN COALESCE(m.dhm_is_deleted, FALSE) THEN NULL ELSE NULLIF(TRIM(m.code_dhm), '') END AS port_code,
    to_char(
      CASE WHEN COALESCE(v.is_discharge_port, FALSE) THEN COALESCE(v.eta_vessel_arrive_at_discharge_port, v.eta_vessel_arrival) ELSE v.eta_vessel_arrival END,
      'YYYY-MM-DD"T"HH24:MI:SS'
    ) AS eta_local,
    to_char(v.ata_vessel_arrival, 'YYYY-MM-DD"T"HH24:MI:SS') AS ata_local
  FROM vessel_loading_ports v
  LEFT JOIN master_loading_ports m ON m.id = v.master_port_id
  WHERE v.shipment_id = ANY($1::uuid[])
    AND COALESCE(v.is_cancelled, FALSE) IS NOT TRUE
  ORDER BY v.shipment_id, v.port_sequence NULLS LAST, v.id`;

/**
 * One row per member shipment ($1 = member shipment ids, $2 = the STO key of the group each belongs to, same order). The STO quantity of a line is the
 * contract_stos row for that STO, else the contract quantity when the contract has no STO line at all (a manual shipment), as the JPS payload does.
 */
export const PARTNER_LINES_SQL = `
  SELECT
    g.sto_key,
    s.id::text AS shipment_uuid,
    s.contract_id::text AS contract_uuid,
    c.contract_id AS contract_no,
    c.po_number,
    c.product,
    c.supplier,
    UPPER(NULLIF(TRIM(c.transport_mode), '')) AS transport_mode,
    NULLIF(TRIM(c.sto_number), '') AS contract_sto_number,
    NULLIF(TRIM(c.plant_code), '') AS plant_code,
    UPPER(NULLIF(TRIM(c.unit), '')) AS unit,
    c.quantity_ordered,
    cs.sto_quantity,
    EXISTS (SELECT 1 FROM contract_stos any_cs WHERE any_cs.contract_id = c.id) AS contract_has_sto_line,
    s.quantity_delivered,
    c.unit_price,
    c.currency,
    c.contract_value,
    pc.code AS product_code,
    pc.name AS product_name,
    pl.code AS plant_dhm_code,
    pl.name AS plant_name
  FROM unnest($1::uuid[], $2::text[]) AS g(shipment_id, sto_key)
  JOIN shipments s ON s.id = g.shipment_id
  JOIN contracts c ON c.id = s.contract_id
  LEFT JOIN contract_stos cs ON cs.contract_id = c.id AND UPPER(TRIM(cs.sto_number)) = UPPER(g.sto_key)
  LEFT JOIN LATERAL (
    SELECT CASE WHEN COALESCE(p.dhm_is_deleted, FALSE) THEN NULL ELSE NULLIF(TRIM(p.code_dhm), '') END AS code, p.product_name AS name
      FROM products p
     WHERE UPPER(TRIM(p.product_name)) = UPPER(TRIM(c.product)) AND NULLIF(TRIM(p.code_dhm), '') IS NOT NULL
     ORDER BY COALESCE(p.dhm_is_deleted, FALSE), p.code_dhm
     LIMIT 1
  ) pc ON TRUE
  LEFT JOIN LATERAL (
    SELECT NULLIF(TRIM(m.code_dhm), '') AS code, COALESCE(m.plant_name, m.plant_code) AS name
      FROM master_plants m
     WHERE UPPER(TRIM(m.plant_code)) = UPPER(TRIM(c.plant_code)) AND NULLIF(TRIM(m.code_dhm), '') IS NOT NULL
     ORDER BY m.code_dhm
     LIMIT 1
  ) pl ON TRUE
  ORDER BY g.sto_key, c.contract_id, s.created_at, s.id`;

/** Every tug / barge pair with both vessels. Used for GET /vessel-pairs and for `vessel.pair` on a shipment. */
export const PARTNER_PAIRS_SQL = `
  SELECT
    p.pair_code,
    to_char(p.last_contract_date, 'YYYY-MM-DD') AS last_contract_date,
    bg.id::text AS bg_id,
    bg.vessel_name AS bg_name,
    CASE WHEN COALESCE(bg.dhm_is_deleted, FALSE) THEN NULL ELSE NULLIF(TRIM(bg.dhm_code), '') END AS bg_code,
    tb.id::text AS tb_id,
    tb.vessel_name AS tb_name,
    CASE WHEN COALESCE(tb.dhm_is_deleted, FALSE) THEN NULL ELSE NULLIF(TRIM(tb.dhm_code), '') END AS tb_code
  FROM vessel_pairs p
  JOIN master_vessels bg ON bg.id = p.bg_master_vessel_id
  JOIN master_vessels tb ON tb.id = p.tb_master_vessel_id
  ORDER BY p.pair_code`;
