
import { sqlSapQtyDeliveredKgFromSpd, sqlStoLookupKeyMatchExpr } from './contractLogisticsStoDetailSql';
import {
  sqlNormalizeSapStoQtyToKgSql,
  sqlPoGlobalOutstandingPlanningKg,
  sqlPoOutstandingPlanningRowBudgetKgExpr,
  sqlPoStoAssignedKg,
  sqlPoStoSapQtyKg,
} from './contractPoGlobalMetricsSql';
import { shipmentOutstandingQtyExpr } from './shipmentOutstandingQtySql';

function spdPoNumber(alias: string): string {
  return `NULLIF(TRIM(COALESCE(
  ${alias}.po_number::text,
  ${alias}.data->'raw'->>'PO No.',
  ${alias}.data->'raw'->>'PO Number',
  ${alias}.data->'raw'->>'PO No',
  ${alias}.data->'contract'->>'po_number',
  ${alias}.data->>'PO No.'
)), '')`;
}

/** PO number from SAP JSON (raw / contract) — default spd alias. */
export const SPD_PO_NUMBER_SQL = spdPoNumber('spd');

const QTY_RECEIVE_NUM = `NULLIF(regexp_replace(COALESCE(
  NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive')), ''),
  ''
), '[^0-9\\.-]', '', 'g'), '')::numeric`;

function stoScopedDeliveredKgSql(
  contractNumberExpr: string,
  contractQtyExpr: string,
  stoMatch: (alias: string) => string,
  poMatch: (alias: string) => string,
): string {
  return `COALESCE((
          SELECT SUM(${sqlSapQtyDeliveredKgFromSpd('spd', contractQtyExpr)})
          FROM sap_processed_data spd
          WHERE spd.contract_number = ${contractNumberExpr}
            AND ${stoMatch('spd')}
            AND ${poMatch('spd')}
        ), 0)`;
}

function stoScopedReceiveKgSql(
  contractNumberExpr: string,
  contractQtyExpr: string,
  stoMatch: (alias: string) => string,
  poMatch: (alias: string) => string,
): string {
  return `COALESCE((
          SELECT SUM(${sqlNormalizeSapStoQtyToKgSql(QTY_RECEIVE_NUM, contractQtyExpr)})
          FROM sap_processed_data spd
          WHERE spd.contract_number = ${contractNumberExpr}
            AND ${stoMatch('spd')}
            AND NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive')), '') IS NOT NULL
            AND ${poMatch('spd')}
        ), 0)`;
}

/**
 * STO-scoped OS actual — contract qty minus STO-scoped fulfilled (incoterm-aware).
 * Matches Shipping Performance / shipments list: sqlShipmentListOutstandingKgExpr.
 */
function stoScopedOutstandingActualSql(opts: {
  contractQtyExpr: string;
  incotermExpr: string;
  contractNumberExpr: string;
  stoMatch: (alias: string) => string;
  poMatch: (alias: string) => string;
}): string {
  return shipmentOutstandingQtyExpr({
    stoQtyExpr: `COALESCE(${opts.contractQtyExpr}, 0)`,
    receiveExpr: stoScopedReceiveKgSql(
      opts.contractNumberExpr,
      opts.contractQtyExpr,
      opts.stoMatch,
      opts.poMatch,
    ),
    deliveryExpr: stoScopedDeliveredKgSql(
      opts.contractNumberExpr,
      opts.contractQtyExpr,
      opts.stoMatch,
      opts.poMatch,
    ),
    incotermExpr: opts.incotermExpr,
  });
}

/** SQL for GET /shipments/contracts/details — one row per PO line on the STO. */
export function buildContractDetailsForStoSql(): string {
  const stoMatch = (alias: string) => sqlStoLookupKeyMatchExpr('$1::text', alias);
  const poMatch = (alias: string) => `(
              pl.po_number IS NULL
              OR ${spdPoNumber(alias)} = pl.po_number
            )`;

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
    stoMatch,
    poMatch,
  });

  const plDeliveredKg = stoScopedDeliveredKgSql(
    'pl.contract_number',
    'pl.contract_qty',
    stoMatch,
    poMatch,
  );

  const plReceiveKg = stoScopedReceiveKgSql(
    'pl.contract_number',
    'pl.contract_qty',
    stoMatch,
    poMatch,
  );

  const socContractQtyExpr = `COALESCE((
          SELECT MAX(CAST(REPLACE(REPLACE(spd.data->'contract'->>'contract_quantity', ',', ''), ' ', '') AS NUMERIC))
          FROM sap_processed_data spd
          WHERE spd.contract_number = soc.contract_number
        ), 0)`;

  const socPoNumberExpr = `(SELECT ${spdPoNumber('spd')}
         FROM sap_processed_data spd
         WHERE spd.contract_number = soc.contract_number
           AND ${stoMatch('spd')}
         ORDER BY spd.created_at DESC NULLS LAST
         LIMIT 1)`;

  const sapOnlyPoMatch = (alias: string) => `(
              ${socPoNumberExpr} IS NULL
              OR ${spdPoNumber(alias)} = ${socPoNumberExpr}
            )`;

  const socSapStoQty = sqlPoStoSapQtyKg({
    contractNumberExpr: 'soc.contract_number',
    poNumberExpr: socPoNumberExpr,
    contractQtyExpr: socContractQtyExpr,
    stoKeyExpr: '$1::text',
  });

  const socOutstandingActual = stoScopedOutstandingActualSql({
    contractQtyExpr: socContractQtyExpr,
    incotermExpr: `(SELECT c.incoterm FROM contracts c WHERE c.contract_id = soc.contract_number LIMIT 1)`,
    contractNumberExpr: 'soc.contract_number',
    stoMatch,
    poMatch: sapOnlyPoMatch,
  });

  const socDeliveredKg = stoScopedDeliveredKgSql(
    'soc.contract_number',
    socContractQtyExpr,
    stoMatch,
    sapOnlyPoMatch,
  );

  const socReceiveKg = stoScopedReceiveKgSql(
    'soc.contract_number',
    socContractQtyExpr,
    stoMatch,
    sapOnlyPoMatch,
  );

  return `
      WITH contract_candidates AS (
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
            AND ${stoMatch('spd')}
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
        (SELECT COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No')
         FROM sap_processed_data spd
         WHERE spd.contract_number = pl.contract_number
         ORDER BY spd.created_at DESC NULLS LAST
         LIMIT 1) AS contract_ext_no,
        EXISTS (
          SELECT 1
          FROM sap_processed_data spd_lock
          WHERE spd_lock.contract_number = pl.contract_number
            AND ${stoMatch('spd_lock')}
            AND spd_lock.data->'contract'->>'sto_quantity' IS NOT NULL
            AND (
              pl.po_number IS NULL
              OR ${spdPoNumber('spd_lock')} = pl.po_number
            )
        ) AS locked_from_sap,
        pl.delivery_start_date,
        pl.delivery_end_date
      FROM po_lines pl

      UNION ALL

      SELECT
        soc.contract_number,
        (SELECT ${spdPoNumber('spd')}
         FROM sap_processed_data spd
         WHERE spd.contract_number = soc.contract_number
           AND ${stoMatch('spd')}
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
          poNumberExpr: `(SELECT ${spdPoNumber('spd')}
         FROM sap_processed_data spd
         WHERE spd.contract_number = soc.contract_number
           AND ${stoMatch('spd')}
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
          poNumberExpr: `(SELECT ${spdPoNumber('spd')}
         FROM sap_processed_data spd
         WHERE spd.contract_number = soc.contract_number
           AND ${stoMatch('spd')}
         ORDER BY spd.created_at DESC NULLS LAST
         LIMIT 1)`,
          stoKeyExpr: '$1::text',
        })} AS outstanding_qty_planning_budget,
        ${socSapStoQty} AS sap_sto_qty,
        ${sqlPoStoAssignedKg({
          stoKeyExpr: '$1::text',
          contractNumberExpr: 'soc.contract_number',
          poNumberExpr: `(SELECT ${spdPoNumber('spd')}
         FROM sap_processed_data spd
         WHERE spd.contract_number = soc.contract_number
           AND ${stoMatch('spd')}
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
          poNumberExpr: `(SELECT ${spdPoNumber('spd')}
         FROM sap_processed_data spd
         WHERE spd.contract_number = soc.contract_number
           AND ${stoMatch('spd')}
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
        (SELECT COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No')
         FROM sap_processed_data spd
         WHERE spd.contract_number = soc.contract_number
         ORDER BY spd.created_at DESC NULLS LAST
         LIMIT 1) AS contract_ext_no,
        EXISTS (
          SELECT 1 FROM sap_processed_data spd_lock
          WHERE spd_lock.contract_number = soc.contract_number
            AND ${stoMatch('spd_lock')}
            AND spd_lock.data->'contract'->>'sto_quantity' IS NOT NULL
        ) AS locked_from_sap,
        NULL::date AS delivery_start_date,
        NULL::date AS delivery_end_date
      FROM sap_only_contracts soc
      ORDER BY contract_number, po_number NULLS LAST`;
}
