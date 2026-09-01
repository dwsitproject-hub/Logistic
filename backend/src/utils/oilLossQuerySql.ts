import {
  OIL_LOSS_ELIGIBILITY_WHERE_SQL,
  OIL_LOSS_TRANSPORTER_EXPR,
  OIL_LOSS_VESSEL_ELIGIBILITY_WHERE_SQL,
} from './oilLossEligibility';
import { sqlContractImportStatusIsClosedExpr } from './contractDeliveryStatus';
import { shipmentManualQtyResolveSql } from './shipmentManualQtyResolveSql';
import { sqlB2bOriginEndingChildLateralJoin } from './b2bOriginEndingSql';
import { buildShipmentPageSeaIncotermScopeSql } from './shipmentIncotermScope';
import { buildUnplannedContractBacklogLatestSpdCte } from './shipmentUnplannedHybridSql';
import {
  OIL_LOSS_SFAL_QTY_EXPR,
  OIL_LOSS_SFBD_QTY_EXPR,
  SAP_OIL_LOSS_IMPORT_STATUS_EXPR,
  SAP_OIL_LOSS_QTY_CONTRACT_NUMERIC,
  SAP_OIL_LOSS_QTY_DELIVERY_LEGACY_NUMERIC,
  SAP_OIL_LOSS_QTY_RECEIVE_NUMERIC,
  SAP_OIL_LOSS_QTY_TRUCKING_NUMERIC,
  SAP_OIL_LOSS_QTY_VESSEL_NUMERIC,
  SAP_OIL_LOSS_QTY_WHERE_CLAUSE,
  SAP_OIL_LOSS_TRUCK_TRANSPORTER_RAW,
  SAP_OIL_LOSS_VESSEL_NAME_RAW,
  SAP_SFAL_NUMERIC_EXPR,
  SAP_SFBD_NUMERIC_EXPR,
  sqlOilLossUatQtyDeliveryExpr,
} from './oilLossSapSql';
import { buildQtyMoveCte } from './contractGlobalOutstandingSql';
import { sqlQtyMoveJoinIncotermDelivery } from './sapIncotermMetrics';

/** Pre-aggregated lookups — avoids per-row LATERAL scans over full SAP dataset. */
export const OIL_LOSS_LOOKUP_CTES = `
  oil_loss_closed AS (
    SELECT *
    FROM parsed
    WHERE ${sqlContractImportStatusIsClosedExpr(
      'import_status',
      "LOWER(COALESCE(status, '')) IN ('close', 'closed', 'completed', 'complete')",
    )}
  ),
  contracts_latest AS (
    SELECT DISTINCT ON (contract_id)
      contract_id,
      quantity_ordered,
      incoterm,
      contract_date,
      plant_code,
      company_name
    FROM contracts
    WHERE NULLIF(TRIM(contract_id), '') IS NOT NULL
    ORDER BY contract_id, updated_at DESC NULLS LAST
  ),
  shipments_by_sto AS (
    SELECT DISTINCT ON (TRIM(shipment_id))
      TRIM(shipment_id) AS sto_key,
      sfal_qty,
      sfbd_qty,
      quantity_delivered,
      actual_vessel_qty_receive
    FROM shipments
    WHERE NULLIF(TRIM(shipment_id), '') IS NOT NULL
    ORDER BY TRIM(shipment_id), updated_at DESC NULLS LAST
  ),
  shipments_by_contract AS (
    SELECT DISTINCT ON (c.contract_id)
      c.contract_id,
      s.sfal_qty,
      s.sfbd_qty,
      s.quantity_delivered,
      s.actual_vessel_qty_receive
    FROM shipments s
    INNER JOIN contracts c ON c.id = s.contract_id
    WHERE NULLIF(TRIM(c.contract_id), '') IS NOT NULL
    ORDER BY c.contract_id, s.updated_at DESC NULLS LAST
  ),
  trucking_by_sto AS (
    SELECT DISTINCT ON (TRIM(operation_id))
      TRIM(operation_id) AS sto_key,
      trucking_owner,
      loading_location,
      unloading_location,
      sfal_qty,
      sfbd_qty
    FROM trucking_operations
    WHERE NULLIF(TRIM(operation_id), '') IS NOT NULL
    ORDER BY TRIM(operation_id), updated_at DESC NULLS LAST
  ),
  trucking_by_contract AS (
    SELECT DISTINCT ON (c.contract_id)
      c.contract_id,
      t.trucking_owner,
      t.loading_location,
      t.unloading_location,
      t.sfal_qty,
      t.sfbd_qty
    FROM trucking_operations t
    INNER JOIN contracts c ON c.id = t.contract_id
    WHERE NULLIF(TRIM(c.contract_id), '') IS NOT NULL
    ORDER BY c.contract_id, t.updated_at DESC NULLS LAST
  ),
  plants_by_code_company AS (
    SELECT DISTINCT ON (TRIM(UPPER(plant_code)), TRIM(UPPER(company_name)))
      TRIM(UPPER(plant_code)) AS plant_code_key,
      TRIM(UPPER(company_name)) AS company_name_key,
      group_plant
    FROM master_plants
    WHERE NULLIF(TRIM(plant_name), '') IS NOT NULL
      AND NULLIF(TRIM(company_name), '') IS NOT NULL
    ORDER BY TRIM(UPPER(plant_code)), TRIM(UPPER(company_name)), updated_at DESC NULLS LAST
  ),
  plants_by_code AS (
    SELECT DISTINCT ON (TRIM(UPPER(plant_code)))
      TRIM(UPPER(plant_code)) AS plant_code_key,
      group_plant
    FROM master_plants
    WHERE NULLIF(TRIM(plant_name), '') IS NOT NULL
    ORDER BY TRIM(UPPER(plant_code)), updated_at DESC NULLS LAST
  )
`;

/** Shared Oil Loss CTE chain through `with_qty` (parsed → enriched → resolved qty). */
export function buildOilLossWithQtyCtes(): string {
  return `
    parsed AS MATERIALIZED (
      SELECT
        spd.id,
        COALESCE(NULLIF(TRIM(spd.sto_number::text), ''), NULLIF(TRIM(spd.data->'raw'->>'STO No'), '')) AS sto_key,
        COALESCE(spd.data->'raw'->>'SEA / LAND', 'LAND')          AS transport_mode,
        UPPER(TRIM(COALESCE(
          spd.data->'raw'->>'STO Type',
          spd.data->'raw'->>'STO Type ',
          spd.data->'contract'->>'sto_type',
          spd.data->'shipment'->>'sto_type',
          ''
        )))                                                       AS sto_type,
        COALESCE(spd.data->'raw'->>'Contract Ext No',
                 spd.data->'raw'->>'Contract No', '')              AS operation_id,
        COALESCE(
          NULLIF(TRIM(spd.contract_number), ''),
          NULLIF(TRIM(spd.data->'raw'->>'Contract No'), ''),
          ''
        )                                                         AS contract_number,
        COALESCE(spd.data->'raw'->>'Contract Ext No', '')          AS contract_ext_no,
        COALESCE(spd.data->'raw'->>'STO No', '')                   AS sto_number,
        COALESCE(spd.data->'raw'->>'PO No', '')                    AS po_number,
        COALESCE(spd.data->'raw'->>'Supplier', '')                 AS supplier,
        COALESCE(spd.data->'raw'->>'Buyer', '')                    AS buyer,
        COALESCE(spd.data->'raw'->>'Product', '')                  AS product,
        COALESCE(spd.data->'raw'->>'Vendor Group', '')             AS group_name,
        CASE
          WHEN COALESCE(spd.data->'raw'->>'SEA / LAND', 'LAND') = 'SEA'
          THEN COALESCE(spd.data->'raw'->>'Vessel Discharge Port', '')
          ELSE COALESCE(spd.data->'raw'->>'Truck Discharge Location', '')
        END                                                         AS plant_site,
        CASE
          WHEN spd.data->'raw'->>'Contract Date' ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$'
          THEN TO_CHAR(TO_DATE(spd.data->'raw'->>'Contract Date', 'MM/DD/YY'), 'YYYY-MM-DD')
          WHEN spd.data->'raw'->>'Contract Date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          THEN spd.data->'raw'->>'Contract Date'
          ELSE NULL
        END                                                         AS operation_date,
        COALESCE(spd.data->'raw'->>'Status', '')                   AS status,
        ${SAP_OIL_LOSS_IMPORT_STATUS_EXPR}                        AS import_status,
        COALESCE(NULLIF(TRIM(spd.data->'raw'->>'Incoterm'), ''), '') AS incoterm_raw,
        ${SAP_OIL_LOSS_QTY_CONTRACT_NUMERIC}                      AS qty_contract_raw,
        ${SAP_OIL_LOSS_QTY_TRUCKING_NUMERIC}                      AS qty_trucking,
        ${SAP_OIL_LOSS_QTY_VESSEL_NUMERIC}                        AS qty_vessel,
        ${SAP_OIL_LOSS_QTY_DELIVERY_LEGACY_NUMERIC}               AS qty_delivery_legacy,
        ${SAP_OIL_LOSS_QTY_RECEIVE_NUMERIC}                       AS qty_receive,
        ${SAP_SFAL_NUMERIC_EXPR}                                  AS qty_sfal_raw,
        ${SAP_SFBD_NUMERIC_EXPR}                                  AS qty_sfbd_raw,
        ${SAP_OIL_LOSS_TRUCK_TRANSPORTER_RAW}                     AS truck_transporter_raw,
        ${SAP_OIL_LOSS_VESSEL_NAME_RAW}                           AS vessel_name_raw,
        COALESCE(NULLIF(TRIM(spd.data->'raw'->>'Trucking Owner at Starting Location'), ''), '') AS transporter_raw,
        COALESCE(NULLIF(TRIM(spd.data->'raw'->>'Vessel Owner'), ''), '') AS vessel_owner_raw,
        COALESCE(NULLIF(TRIM(spd.data->'raw'->>'Truck Loading at Starting Location'), ''), '') AS loading_location_raw,
        COALESCE(NULLIF(TRIM(spd.data->'raw'->>'Truck Discharge Location'), ''), '') AS unloading_location_raw
      FROM sap_processed_data spd
      WHERE ${SAP_OIL_LOSS_QTY_WHERE_CLAUSE}
        -- Oil loss/gain on a PO that SAP cancelled or deleted is not a real loss, so it must not
        -- reach the table or the gain total. NOT EXISTS (rather than a join) keeps this a semi-join
        -- on the indexed TRIM(contract_id), leaves the MATERIALIZED plan intact, and treats rows
        -- with no matching contract as eligible exactly as before.
        AND NOT EXISTS (
          SELECT 1
          FROM contracts wc
          WHERE TRIM(wc.contract_id) = TRIM(spd.contract_number)
            AND wc.sap_presence = 'WITHDRAWN'
        )
    ),
    ${OIL_LOSS_LOOKUP_CTES},
    enriched AS (
      SELECT
        p.*,
        COALESCE(sh_sto.sfal_qty, sh_ct.sfal_qty) AS shipment_sfal_kg,
        COALESCE(sh_sto.sfbd_qty, sh_ct.sfbd_qty) AS shipment_sfbd_kg,
        ct.quantity_ordered AS contract_qty_kg,
        ct.incoterm AS contract_incoterm,
        ct.contract_date AS contract_date_db,
        ct.plant_code AS contract_plant_code,
        ct.company_name AS contract_company_name,
        b2b_end.unload_location AS b2b_ending_unload,
        b2b_end.buyer AS b2b_ending_buyer,
        COALESCE(tr_sto.trucking_owner, tr_ct.trucking_owner) AS trucking_owner_db,
        COALESCE(tr_sto.loading_location, tr_ct.loading_location) AS loading_location_db,
        COALESCE(
          NULLIF(TRIM(b2b_end.unload_location), ''),
          tr_sto.unloading_location,
          tr_ct.unloading_location
        ) AS unloading_location_db,
        COALESCE(tr_sto.sfal_qty, tr_ct.sfal_qty) AS trucking_sfal_kg,
        COALESCE(tr_sto.sfbd_qty, tr_ct.sfbd_qty) AS trucking_sfbd_kg,
        COALESCE(
          NULLIF(TRIM(pbc.group_plant), ''),
          NULLIF(TRIM(pbco.group_plant), ''),
          'Blank'
        ) AS group_plant_resolved,
        COALESCE(sh_sto.quantity_delivered, sh_ct.quantity_delivered) AS shipment_qty_delivered_kg,
        COALESCE(sh_sto.actual_vessel_qty_receive, sh_ct.actual_vessel_qty_receive) AS shipment_qty_receive_kg
      FROM oil_loss_closed p
      LEFT JOIN contracts_latest ct
        ON NULLIF(TRIM(p.contract_number), '') IS NOT NULL
       AND ct.contract_id = TRIM(p.contract_number)
      ${sqlB2bOriginEndingChildLateralJoin({ originPoExpr: "COALESCE(NULLIF(TRIM(p.po_number), ''), '')" })}
      LEFT JOIN shipments_by_sto sh_sto
        ON NULLIF(TRIM(p.sto_key), '') IS NOT NULL
       AND sh_sto.sto_key = TRIM(p.sto_key)
      LEFT JOIN shipments_by_contract sh_ct
        ON NULLIF(TRIM(p.contract_number), '') IS NOT NULL
       AND sh_ct.contract_id = TRIM(p.contract_number)
      LEFT JOIN trucking_by_sto tr_sto
        ON NULLIF(TRIM(p.sto_key), '') IS NOT NULL
       AND tr_sto.sto_key = TRIM(p.sto_key)
      LEFT JOIN trucking_by_contract tr_ct
        ON NULLIF(TRIM(p.contract_number), '') IS NOT NULL
       AND tr_ct.contract_id = TRIM(p.contract_number)
      LEFT JOIN plants_by_code_company pbc
        ON pbc.plant_code_key = TRIM(UPPER(COALESCE(b2b_end.plant_code, ct.plant_code, '')))
       AND pbc.company_name_key = TRIM(UPPER(COALESCE(b2b_end.company_name, ct.company_name, '')))
       AND NULLIF(TRIM(COALESCE(b2b_end.company_name, ct.company_name)), '') IS NOT NULL
      LEFT JOIN plants_by_code pbco
        ON pbco.plant_code_key = TRIM(UPPER(COALESCE(b2b_end.plant_code, ct.plant_code, '')))
    ),
    with_qty_base AS (
      SELECT
        e.*,
        ${sqlOilLossUatQtyDeliveryExpr({
          incotermExpr: `COALESCE(NULLIF(e.contract_incoterm, ''), NULLIF(e.incoterm_raw, ''), '')`,
          transportExpr: `UPPER(TRIM(COALESCE(NULLIF(e.transport_mode, ''), 'LAND')))`,
          truckingCol: 'e.qty_trucking',
          vesselCol: 'e.qty_vessel',
          legacyCol: 'e.qty_delivery_legacy',
        })} AS qty_delivery_sap
      FROM enriched e
    ),
    with_qty AS (
      SELECT
        b.*,
        ${shipmentManualQtyResolveSql('b.shipment_qty_delivered_kg', 'b.qty_delivery_sap')} AS qty_delivery_resolved,
        ${shipmentManualQtyResolveSql('b.shipment_qty_receive_kg', 'b.qty_receive')} AS qty_receive_resolved
      FROM with_qty_base b
    )`;
}

export function buildOilLossMainSql(): string {
  // Align Qty Delivery with Contracts View Table: qty_move + UAT Incoterm×Mode matrix.
  const contractsListDeliveryExpr = sqlQtyMoveJoinIncotermDelivery(
    `COALESCE(NULLIF(TRIM(oil_loss_eligible.incoterm), ''), '')`,
    'qm',
    `UPPER(TRIM(COALESCE(NULLIF(TRIM(oil_loss_eligible.transport_mode), ''), 'LAND')))`,
  );

  return `
    WITH ${buildOilLossWithQtyCtes()},
    oil_loss_eligible AS (
      SELECT
        id,
        transport_mode,
        sto_type,
        operation_id,
        contract_number,
        contract_ext_no,
        sto_number,
        po_number,
        supplier,
        COALESCE(NULLIF(TRIM(b2b_ending_buyer), ''), buyer) AS buyer,
        product,
        group_name,
        COALESCE(NULLIF(TRIM(b2b_ending_unload), ''), plant_site) AS plant_site,
        COALESCE(NULLIF(TRIM(vessel_name_raw), ''), '') AS vessel_name,
        COALESCE(
          TO_CHAR(contract_date_db, 'YYYY-MM-DD'),
          operation_date
        ) AS contract_date,
        operation_date,
        COALESCE(NULLIF(contract_incoterm, ''), NULLIF(incoterm_raw, ''), '') AS incoterm,
        group_plant_resolved AS group_plant,
        COALESCE(contract_qty_kg, qty_contract_raw) AS quantity_contract,
        ${OIL_LOSS_TRANSPORTER_EXPR} AS transporter,
        COALESCE(NULLIF(loading_location_db, ''), NULLIF(loading_location_raw, ''), '') AS loading_location,
        COALESCE(
          NULLIF(TRIM(b2b_ending_unload), ''),
          NULLIF(unloading_location_db, ''),
          NULLIF(unloading_location_raw, ''),
          plant_site,
          ''
        ) AS unloading_location,
        status,
        qty_delivery_resolved,
        qty_receive_resolved,
        ${OIL_LOSS_SFAL_QTY_EXPR} AS quantity_sfal,
        ${OIL_LOSS_SFBD_QTY_EXPR} AS quantity_sfbd
      FROM with_qty
      WHERE ${OIL_LOSS_ELIGIBILITY_WHERE_SQL}
        AND qty_receive_resolved < qty_delivery_resolved
    ),
    oil_loss_contract_scope AS (
      SELECT DISTINCT TRIM(contract_number) AS contract_id
      FROM oil_loss_eligible
      WHERE NULLIF(TRIM(contract_number), '') IS NOT NULL
    ),
    ${buildQtyMoveCte({ kind: 'join_scope', scopeCteName: 'oil_loss_contract_scope' })}
    SELECT
      id,
      transport_mode,
      sto_type,
      operation_id,
      contract_number,
      contract_ext_no,
      sto_number,
      po_number,
      supplier,
      buyer,
      product,
      group_name,
      plant_site,
      vessel_name,
      contract_date,
      operation_date,
      incoterm,
      group_plant,
      quantity_contract,
      transporter,
      loading_location,
      unloading_location,
      status,
      quantity_delivery,
      quantity_received,
      quantity_delivery AS quantity_sent,
      quantity_sfal,
      quantity_sfbd,
      (quantity_received - quantity_delivery) AS gain_loss_amount,
      CASE
        WHEN quantity_delivery > 0
        THEN ROUND((quantity_received - quantity_delivery) / quantity_delivery * 100, 4)
        ELSE 0
      END AS gain_loss_percentage
    FROM (
      SELECT
        oil_loss_eligible.id,
        oil_loss_eligible.transport_mode,
        oil_loss_eligible.sto_type,
        oil_loss_eligible.operation_id,
        oil_loss_eligible.contract_number,
        oil_loss_eligible.contract_ext_no,
        oil_loss_eligible.sto_number,
        oil_loss_eligible.po_number,
        oil_loss_eligible.supplier,
        oil_loss_eligible.buyer,
        oil_loss_eligible.product,
        oil_loss_eligible.group_name,
        oil_loss_eligible.plant_site,
        oil_loss_eligible.vessel_name,
        oil_loss_eligible.contract_date,
        oil_loss_eligible.operation_date,
        oil_loss_eligible.incoterm,
        oil_loss_eligible.group_plant,
        oil_loss_eligible.quantity_contract,
        oil_loss_eligible.transporter,
        oil_loss_eligible.loading_location,
        oil_loss_eligible.unloading_location,
        oil_loss_eligible.status,
        oil_loss_eligible.quantity_sfal,
        oil_loss_eligible.quantity_sfbd,
        CASE
          WHEN qm.contract_number IS NOT NULL THEN COALESCE((${contractsListDeliveryExpr}), 0)
          ELSE COALESCE(oil_loss_eligible.qty_delivery_resolved, 0)
        END AS quantity_delivery,
        CASE
          WHEN qm.contract_number IS NOT NULL THEN COALESCE(qm.quantity_receive, 0)
          ELSE COALESCE(oil_loss_eligible.qty_receive_resolved, 0)
        END AS quantity_received
      FROM oil_loss_eligible
      LEFT JOIN qty_move qm
        ON qm.contract_number = TRIM(oil_loss_eligible.contract_number)
    ) oil_loss_with_contracts_qty
    ORDER BY (quantity_received - quantity_delivery) ASC, id ASC
  `;
}

export function buildOilLossGainSql(): string {
  // MATERIALIZED for the same reason as buildOilLossMainSql (identical single-row result).
  return `
    WITH parsed AS MATERIALIZED (
      SELECT
        ${SAP_OIL_LOSS_QTY_TRUCKING_NUMERIC} AS qty_trucking,
        ${SAP_OIL_LOSS_QTY_VESSEL_NUMERIC} AS qty_vessel,
        ${SAP_OIL_LOSS_QTY_DELIVERY_LEGACY_NUMERIC} AS qty_delivery_legacy,
        ${SAP_OIL_LOSS_QTY_RECEIVE_NUMERIC} AS qty_receive,
        COALESCE(NULLIF(TRIM(spd.data->'raw'->>'Incoterm'), ''), '') AS incoterm_raw,
        COALESCE(spd.data->'raw'->>'SEA / LAND', 'LAND') AS transport_mode,
        ${SAP_OIL_LOSS_IMPORT_STATUS_EXPR} AS import_status,
        COALESCE(spd.data->'raw'->>'Status', '') AS status
      FROM sap_processed_data spd
      WHERE ${SAP_OIL_LOSS_QTY_WHERE_CLAUSE}
        -- Oil loss/gain on a PO that SAP cancelled or deleted is not a real loss, so it must not
        -- reach the table or the gain total. NOT EXISTS (rather than a join) keeps this a semi-join
        -- on the indexed TRIM(contract_id), leaves the MATERIALIZED plan intact, and treats rows
        -- with no matching contract as eligible exactly as before.
        AND NOT EXISTS (
          SELECT 1
          FROM contracts wc
          WHERE TRIM(wc.contract_id) = TRIM(spd.contract_number)
            AND wc.sap_presence = 'WITHDRAWN'
        )
    ),
    with_delivery AS (
      SELECT
        p.*,
        ${sqlOilLossUatQtyDeliveryExpr({
          incotermExpr: 'p.incoterm_raw',
          transportExpr: `UPPER(TRIM(COALESCE(NULLIF(p.transport_mode, ''), 'LAND')))`,
          truckingCol: 'p.qty_trucking',
          vesselCol: 'p.qty_vessel',
          legacyCol: 'p.qty_delivery_legacy',
        })} AS qty_delivery
      FROM parsed p
    )
    SELECT
      COALESCE(SUM(qty_receive - qty_delivery), 0) AS total_gain_kg,
      COUNT(*)::int                                 AS gain_count
    FROM with_delivery
    WHERE qty_receive > qty_delivery
      AND ${sqlContractImportStatusIsClosedExpr(
        'import_status',
        "LOWER(COALESCE(status, '')) IN ('close', 'closed', 'completed', 'complete')",
      )}
  `;
}

/**
 * Shipments Attention — top loss rows aligned with Oil Loss (SAP receive < delivery, vessel CIF/FOB).
 * Toolbar-scoped via contract filters (date / plant / contract / search / column filters).
 */
export function buildShipmentAttentionOilLossQuery(
  contractScopeSql: string,
  toolbarSql: string,
  limit = 10,
): string {
  const safeLimit = Math.max(1, Math.min(limit, 10));
  return `
    WITH ${buildOilLossWithQtyCtes()},
    ${buildUnplannedContractBacklogLatestSpdCte()},
    scoped AS (
      SELECT w.*
      FROM with_qty w
      INNER JOIN contracts c ON TRIM(c.contract_id) = TRIM(w.contract_number)
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${buildShipmentPageSeaIncotermScopeSql('c')}
        ${contractScopeSql}
        ${toolbarSql}
    )
    SELECT
      NULLIF(TRIM(supplier), '') AS supplier,
      CASE
        WHEN qty_delivery_resolved > 0
        THEN ROUND((qty_receive_resolved - qty_delivery_resolved) / qty_delivery_resolved * 100, 4)
        ELSE 0
      END AS gain_loss_pct
    FROM scoped
    WHERE ${OIL_LOSS_VESSEL_ELIGIBILITY_WHERE_SQL}
      AND qty_receive_resolved < qty_delivery_resolved
      AND NULLIF(TRIM(supplier), '') IS NOT NULL
    ORDER BY gain_loss_pct ASC, id ASC
    LIMIT ${safeLimit}`;
}
