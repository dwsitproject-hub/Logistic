
import {
  sqlSpdPoNumberExpr,
  sqlStoLookupKeyMatchExpr,
  sqlStoScopedDeliveredKgSql,
  sqlStoScopedReceiveKgSql,
} from './contractLogisticsStoDetailSql';
import {
  sqlPoGlobalOutstandingPlanningKg,
  sqlPoOutstandingPlanningRowBudgetKgExpr,
  sqlPoStoAssignedKg,
  sqlPoStoSapQtyKg,
} from './contractPoGlobalMetricsSql';
import { shipmentOutstandingQtyExpr } from './shipmentOutstandingQtySql';
import { LATEST_SPD_B2B_CTE, sqlB2bChildExcludeWhere } from './shippingPerformanceStoMetricsSql';

/** PO number from SAP JSON (raw / contract) — default spd alias. */
export const SPD_PO_NUMBER_SQL = sqlSpdPoNumberExpr('spd');

/** Latest SAP Vessel OA Budget per contract (+ optional PO / STO scope). */
function sqlVesselOaBudgetSapSubquery(
  contractNumberExpr: string,
  opts?: { poNumberExpr?: string; stoMatchExpr?: string },
): string {
  const poFilter = opts?.poNumberExpr
    ? `AND (
            ${opts.poNumberExpr} IS NULL
            OR TRIM(COALESCE(${opts.poNumberExpr}, '')) = ''
            OR ${sqlSpdPoNumberExpr('spd')} = ${opts.poNumberExpr}
          )`
    : '';
  const stoFilter = opts?.stoMatchExpr ? `AND ${opts.stoMatchExpr}` : '';
  return `(
          SELECT CAST(REPLACE(REPLACE(TRIM(COALESCE(
            spd.data->'raw'->>'Vessel OA Budget',
            spd.data->'raw'->>'Vessell OA Budget',
            spd.data->'raw'->>'vessel oa budget',
            spd.data->'shipment'->>'vessel_oa_budget'
          )), ',', ''), ' ', '') AS NUMERIC)
          FROM sap_processed_data spd
          WHERE spd.contract_number = ${contractNumberExpr}
            ${poFilter}
            ${stoFilter}
          ORDER BY spd.created_at DESC NULLS LAST
          LIMIT 1
        )`;
}

function stoScopedDeliveredKgSql(
  contractNumberExpr: string,
  contractQtyExpr: string,
  stoKeyExpr: string,
  poNumberExpr: string,
): string {
  return sqlStoScopedDeliveredKgSql({
    contractNumberExpr,
    contractQtyExpr,
    stoKeyExpr,
    poNumberExpr,
  });
}

function stoScopedReceiveKgSql(
  contractNumberExpr: string,
  contractQtyExpr: string,
  stoKeyExpr: string,
  poNumberExpr: string,
): string {
  return sqlStoScopedReceiveKgSql({
    contractNumberExpr,
    contractQtyExpr,
    stoKeyExpr,
    poNumberExpr,
  });
}

/**
 * STO-scoped OS actual — contract qty minus STO-scoped fulfilled (incoterm-aware).
 * Matches Shipping Performance / shipments list: sqlShipmentListOutstandingKgExpr.
 */
function stoScopedOutstandingActualSql(opts: {
  contractQtyExpr: string;
  incotermExpr: string;
  contractNumberExpr: string;
  stoKeyExpr: string;
  poNumberExpr: string;
}): string {
  return shipmentOutstandingQtyExpr({
    stoQtyExpr: `COALESCE(${opts.contractQtyExpr}, 0)`,
    receiveExpr: stoScopedReceiveKgSql(
      opts.contractNumberExpr,
      opts.contractQtyExpr,
      opts.stoKeyExpr,
      opts.poNumberExpr,
    ),
    deliveryExpr: stoScopedDeliveredKgSql(
      opts.contractNumberExpr,
      opts.contractQtyExpr,
      opts.stoKeyExpr,
      opts.poNumberExpr,
    ),
    incotermExpr: opts.incotermExpr,
  });
}

/**
 * Sibling shipment under the same lookup key (operation_id / shipment_id / STO)
 * for a contract_number — source of per-PO Delivered/Received Qty (KLIP).
 */
export function sqlSiblingShipmentKlipQtyExpr(
  contractNumberExpr: string,
  field: 'delivered' | 'receive',
): string {
  const valueExpr =
    field === 'delivered'
      ? `COALESCE(s.quantity_delivered_klip, s.quantity_delivered)`
      : `s.actual_vessel_qty_receive`;
  return `(
          SELECT ${valueExpr}
          FROM shipments s
          INNER JOIN contracts c ON c.id = s.contract_id
          WHERE COALESCE(s.status, '') <> 'CANCELLED'
            AND TRIM(c.contract_id) = TRIM(${contractNumberExpr})
            AND (
              TRIM(COALESCE(s.operation_id::text, '')) = TRIM($1::text)
              OR TRIM(COALESCE(s.shipment_id::text, '')) = TRIM($1::text)
            )
          ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC NULLS LAST
          LIMIT 1
        )`;
}

/** SQL for GET /shipments/contracts/details — one row per PO line on the STO. */
export function buildContractDetailsForStoSql(): string {
  /** Discovery only — never blank-STO fallback (would pull all empty-STO POs). */
  const stoMatchDiscover = (alias: string) => sqlStoLookupKeyMatchExpr('$1::text', alias);
  /** Qty / lock — blank STO allowed only for the row's contract. */
  const stoMatchForContract = (alias: string, contractNumberExpr: string) =>
    sqlStoLookupKeyMatchExpr('$1::text', alias, { contractNumberExpr });

  const plStoMatch = (alias: string) => stoMatchForContract(alias, 'pl.contract_number');

  const plSapStoQty = sqlPoStoSapQtyKg({
    contractNumberExpr: 'pl.contract_number',
    poNumberExpr: `COALESCE(pl.po_number, '')`,
    contractQtyExpr: 'pl.contract_qty',
    stoKeyExpr: '$1::text',
  });

  const plOutstandingActual = stoScopedOutstandingActualSql({
    contractQtyExpr: 'pl.contract_qty',
    incotermExpr: 'pl.incoterm',
    contractNumberExpr: 'pl.contract_number',
    stoKeyExpr: '$1::text',
    poNumberExpr: 'pl.po_number',
  });

  const plDeliveredKg = stoScopedDeliveredKgSql(
    'pl.contract_number',
    'pl.contract_qty',
    '$1::text',
    'pl.po_number',
  );

  const plReceiveKg = stoScopedReceiveKgSql(
    'pl.contract_number',
    'pl.contract_qty',
    '$1::text',
    'pl.po_number',
  );

  const socContractQtyExpr = `COALESCE((
          SELECT MAX(CAST(REPLACE(REPLACE(spd.data->'contract'->>'contract_quantity', ',', ''), ' ', '') AS NUMERIC))
          FROM sap_processed_data spd
          WHERE spd.contract_number = soc.contract_number
        ), 0)`;

  const socPoNumberExpr = `(SELECT ${sqlSpdPoNumberExpr('spd')}
         FROM sap_processed_data spd
         WHERE spd.contract_number = soc.contract_number
           AND ${stoMatchForContract('spd', 'soc.contract_number')}
         ORDER BY spd.created_at DESC NULLS LAST
         LIMIT 1)`;

  const socSapStoQty = sqlPoStoSapQtyKg({
    contractNumberExpr: 'soc.contract_number',
    poNumberExpr: socPoNumberExpr,
    contractQtyExpr: socContractQtyExpr,
    stoKeyExpr: '$1::text',
  });

  const socStoMatch = (alias: string) => stoMatchForContract(alias, 'soc.contract_number');

  const socOutstandingActual = stoScopedOutstandingActualSql({
    contractQtyExpr: socContractQtyExpr,
    incotermExpr: `(SELECT c.incoterm FROM contracts c WHERE c.contract_id = soc.contract_number LIMIT 1)`,
    contractNumberExpr: 'soc.contract_number',
    stoKeyExpr: '$1::text',
    poNumberExpr: socPoNumberExpr,
  });

  const socDeliveredKg = stoScopedDeliveredKgSql(
    'soc.contract_number',
    socContractQtyExpr,
    '$1::text',
    socPoNumberExpr,
  );

  const socReceiveKg = stoScopedReceiveKgSql(
    'soc.contract_number',
    socContractQtyExpr,
    '$1::text',
    socPoNumberExpr,
  );

  return `
      WITH ${LATEST_SPD_B2B_CTE.trim().replace(/^WITH\s+/i, '')},
      contract_candidates AS (
        SELECT DISTINCT contract_number
        FROM (
          SELECT unnest($2::text[]) AS contract_number
          UNION
          SELECT DISTINCT c.contract_id
          FROM contract_stos cs
          INNER JOIN contracts c ON c.id = cs.contract_id
          WHERE TRIM(cs.sto_number::text) = TRIM($1::text)
            AND c.contract_id IS NOT NULL
            AND TRIM(c.contract_id) != ''
          UNION
          SELECT DISTINCT c.contract_id
          FROM contracts c
          WHERE TRIM(COALESCE(c.sto_number::text, '')) = TRIM($1::text)
            AND c.contract_id IS NOT NULL
            AND TRIM(c.contract_id) != ''
          UNION
          SELECT DISTINCT c.contract_id
          FROM shipments s
          INNER JOIN contracts c ON c.id = s.contract_id
          WHERE TRIM(COALESCE(s.shipment_id::text, '')) = TRIM($1::text)
            AND c.contract_id IS NOT NULL
            AND TRIM(c.contract_id) != ''
          UNION
          SELECT DISTINCT c.contract_id
          FROM shipments s
          INNER JOIN contracts c ON c.id = s.contract_id
          WHERE TRIM(COALESCE(s.operation_id::text, '')) = TRIM($1::text)
            AND c.contract_id IS NOT NULL
            AND TRIM(c.contract_id) != ''
          UNION
          SELECT DISTINCT spd.contract_number
          FROM sap_processed_data spd
          WHERE spd.contract_number IS NOT NULL
            AND TRIM(spd.contract_number) != ''
            AND ${stoMatchDiscover('spd')}
        ) u
        WHERE contract_number IS NOT NULL AND TRIM(contract_number) != ''
      ),
      po_lines AS (
        SELECT
          c.contract_id AS contract_number,
          NULLIF(TRIM(c.po_number), '') AS po_number,
          c.quantity_ordered AS contract_qty,
          c.incoterm,
          c.supplier,
          c.product,
          c.transport_mode,
          c.delivery_start_date,
          c.delivery_end_date
        FROM contracts c
        INNER JOIN contract_candidates cc ON cc.contract_number = c.contract_id
        WHERE UPPER(COALESCE(NULLIF(TRIM(c.transport_mode), ''), 'SEA')) IN ('SEA', 'MIXED', 'MIX')
      ),
      sap_only_contracts AS (
        SELECT cc.contract_number
        FROM contract_candidates cc
        WHERE NOT EXISTS (
          SELECT 1 FROM contracts c
          WHERE c.contract_id = cc.contract_number
            AND UPPER(COALESCE(NULLIF(TRIM(c.transport_mode), ''), 'SEA')) IN ('SEA', 'MIXED', 'MIX')
        )
      )
      SELECT
        pl.contract_number,
        pl.po_number,
        pl.supplier,
        pl.product,
        COALESCE(pl.contract_qty, 0) AS contract_qty,
        ${plOutstandingActual} AS outstanding_qty_actual,
        ${plOutstandingActual} AS outstanding_qty,
        ${sqlPoGlobalOutstandingPlanningKg({
          contractQtyExpr: 'pl.contract_qty',
          contractNumberExpr: 'pl.contract_number',
          poNumberExpr: `COALESCE(pl.po_number, '')`,
        })} AS outstanding_qty_planning,
        ${sqlPoOutstandingPlanningRowBudgetKgExpr({
          contractQtyExpr: 'pl.contract_qty',
          contractNumberExpr: 'pl.contract_number',
          poNumberExpr: `COALESCE(pl.po_number, '')`,
          stoKeyExpr: '$1::text',
        })} AS outstanding_qty_planning_budget,
        ${plSapStoQty} AS sap_sto_qty,
        ${sqlPoStoAssignedKg({
          stoKeyExpr: '$1::text',
          contractNumberExpr: 'pl.contract_number',
          poNumberExpr: `COALESCE(pl.po_number, '')`,
          contractQtyExpr: 'pl.contract_qty',
        })} AS shipment_plan_qty,
        ${sqlPoStoAssignedKg({
          stoKeyExpr: '$1::text',
          contractNumberExpr: 'pl.contract_number',
          poNumberExpr: `COALESCE(pl.po_number, '')`,
          contractQtyExpr: 'pl.contract_qty',
        })} AS sto_qty_assigned,
        ${plDeliveredKg} AS quantity_delivered,
        ${plReceiveKg} AS quantity_receive,
        ${sqlSiblingShipmentKlipQtyExpr('pl.contract_number', 'delivered')} AS quantity_delivered_klip,
        ${sqlSiblingShipmentKlipQtyExpr('pl.contract_number', 'receive')} AS quantity_receive_klip,
        (SELECT COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No')
         FROM sap_processed_data spd
         WHERE spd.contract_number = pl.contract_number
         ORDER BY spd.created_at DESC NULLS LAST
         LIMIT 1) AS contract_ext_no,
        ${sqlVesselOaBudgetSapSubquery('pl.contract_number', { poNumberExpr: 'pl.po_number' })} AS vessel_oa_budget_sap,
        EXISTS (
          SELECT 1
          FROM sap_processed_data spd_lock
          WHERE spd_lock.contract_number = pl.contract_number
            AND ${plStoMatch('spd_lock')}
            AND spd_lock.data->'contract'->>'sto_quantity' IS NOT NULL
            AND (
              pl.po_number IS NULL
              OR ${sqlSpdPoNumberExpr('spd_lock')} = pl.po_number
            )
        ) AS locked_from_sap,
        pl.delivery_start_date,
        pl.delivery_end_date,
        pl.transport_mode
      FROM po_lines pl
      LEFT JOIN latest_spd_b2b b2b ON b2b.contract_number = pl.contract_number
      WHERE ${sqlB2bChildExcludeWhere('b2b')}

      UNION ALL

      SELECT
        soc.contract_number,
        (SELECT ${sqlSpdPoNumberExpr('spd')}
         FROM sap_processed_data spd
         WHERE spd.contract_number = soc.contract_number
           AND ${socStoMatch('spd')}
         ORDER BY spd.created_at DESC NULLS LAST
         LIMIT 1) AS po_number,
        (SELECT c.supplier FROM contracts c WHERE c.contract_id = soc.contract_number LIMIT 1) AS supplier,
        (SELECT c.product FROM contracts c WHERE c.contract_id = soc.contract_number LIMIT 1) AS product,
        ${socContractQtyExpr} AS contract_qty,
        ${socOutstandingActual} AS outstanding_qty_actual,
        ${socOutstandingActual} AS outstanding_qty,
        ${sqlPoGlobalOutstandingPlanningKg({
          contractQtyExpr: `COALESCE((
          SELECT MAX(CAST(REPLACE(REPLACE(spd.data->'contract'->>'contract_quantity', ',', ''), ' ', '') AS NUMERIC))
          FROM sap_processed_data spd
          WHERE spd.contract_number = soc.contract_number
        ), 0)`,
          contractNumberExpr: 'soc.contract_number',
          poNumberExpr: `(SELECT ${sqlSpdPoNumberExpr('spd')}
         FROM sap_processed_data spd
         WHERE spd.contract_number = soc.contract_number
           AND ${socStoMatch('spd')}
         ORDER BY spd.created_at DESC NULLS LAST
         LIMIT 1)`,
        })} AS outstanding_qty_planning,
        ${sqlPoOutstandingPlanningRowBudgetKgExpr({
          contractQtyExpr: `COALESCE((
          SELECT MAX(CAST(REPLACE(REPLACE(spd.data->'contract'->>'contract_quantity', ',', ''), ' ', '') AS NUMERIC))
          FROM sap_processed_data spd
          WHERE spd.contract_number = soc.contract_number
        ), 0)`,
          contractNumberExpr: 'soc.contract_number',
          poNumberExpr: `(SELECT ${sqlSpdPoNumberExpr('spd')}
         FROM sap_processed_data spd
         WHERE spd.contract_number = soc.contract_number
           AND ${socStoMatch('spd')}
         ORDER BY spd.created_at DESC NULLS LAST
         LIMIT 1)`,
          stoKeyExpr: '$1::text',
        })} AS outstanding_qty_planning_budget,
        ${socSapStoQty} AS sap_sto_qty,
        ${sqlPoStoAssignedKg({
          stoKeyExpr: '$1::text',
          contractNumberExpr: 'soc.contract_number',
          poNumberExpr: `(SELECT ${sqlSpdPoNumberExpr('spd')}
         FROM sap_processed_data spd
         WHERE spd.contract_number = soc.contract_number
           AND ${socStoMatch('spd')}
         ORDER BY spd.created_at DESC NULLS LAST
         LIMIT 1)`,
          contractQtyExpr: `COALESCE((
          SELECT MAX(CAST(REPLACE(REPLACE(spd.data->'contract'->>'contract_quantity', ',', ''), ' ', '') AS NUMERIC))
          FROM sap_processed_data spd
          WHERE spd.contract_number = soc.contract_number
        ), 0)`,
        })} AS shipment_plan_qty,
        ${sqlPoStoAssignedKg({
          stoKeyExpr: '$1::text',
          contractNumberExpr: 'soc.contract_number',
          poNumberExpr: `(SELECT ${sqlSpdPoNumberExpr('spd')}
         FROM sap_processed_data spd
         WHERE spd.contract_number = soc.contract_number
           AND ${socStoMatch('spd')}
         ORDER BY spd.created_at DESC NULLS LAST
         LIMIT 1)`,
          contractQtyExpr: `COALESCE((
          SELECT MAX(CAST(REPLACE(REPLACE(spd.data->'contract'->>'contract_quantity', ',', ''), ' ', '') AS NUMERIC))
          FROM sap_processed_data spd
          WHERE spd.contract_number = soc.contract_number
        ), 0)`,
        })} AS sto_qty_assigned,
        ${socDeliveredKg} AS quantity_delivered,
        ${socReceiveKg} AS quantity_receive,
        ${sqlSiblingShipmentKlipQtyExpr('soc.contract_number', 'delivered')} AS quantity_delivered_klip,
        ${sqlSiblingShipmentKlipQtyExpr('soc.contract_number', 'receive')} AS quantity_receive_klip,
        (SELECT COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No')
         FROM sap_processed_data spd
         WHERE spd.contract_number = soc.contract_number
         ORDER BY spd.created_at DESC NULLS LAST
         LIMIT 1) AS contract_ext_no,
        ${sqlVesselOaBudgetSapSubquery('soc.contract_number', {
          poNumberExpr: socPoNumberExpr,
          stoMatchExpr: socStoMatch('spd'),
        })} AS vessel_oa_budget_sap,
        EXISTS (
          SELECT 1 FROM sap_processed_data spd_lock
          WHERE spd_lock.contract_number = soc.contract_number
            AND ${socStoMatch('spd_lock')}
            AND spd_lock.data->'contract'->>'sto_quantity' IS NOT NULL
        ) AS locked_from_sap,
        NULL::date AS delivery_start_date,
        NULL::date AS delivery_end_date,
        (
          SELECT c.transport_mode FROM contracts c WHERE c.contract_id = soc.contract_number LIMIT 1
        ) AS transport_mode
      FROM sap_only_contracts soc
      LEFT JOIN latest_spd_b2b b2b ON b2b.contract_number = soc.contract_number
      WHERE ${sqlB2bChildExcludeWhere('b2b')}
      ORDER BY contract_number, po_number NULLS LAST`;
}
