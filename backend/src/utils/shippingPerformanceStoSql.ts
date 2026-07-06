/**
 * Shipping Performance — STO-group totals (all related POs / contracts on one STO).
 */

import { sqlSumDailyDeliverablesKg } from './dailyDeliverablesSql';
import { buildStoLinkedPoNumbersSql, contractsOnStoSubquery } from './stoLinkedContractSql';

/** True when users planned via Add Shipment / Edit Shipment (operation, calendar, or manual id). */
export function shippingPerfHasKlipPlanningSql(shipmentAlias = 's'): string {
  return `(
    NULLIF(TRIM(COALESCE(${shipmentAlias}.operation_id::text, '')), '') IS NOT NULL
    OR (${sqlSumDailyDeliverablesKg(`${shipmentAlias}.daily_deliverables`)}) > 0
    OR TRIM(COALESCE(${shipmentAlias}.shipment_id::text, '')) LIKE 'MNL-%'
    OR TRIM(COALESCE(${shipmentAlias}.shipment_id::text, '')) LIKE 'MSEA-%'
  )`;
}

/**
 * Operational STO key for Shipping Performance.
 * Unplanned: SAP STO on contract / contract_stos — not shipment_id from SAP/KLIP insert when it
 * disagrees with contract.sto_number. Planned: operation_id then shipment_id.
 */
export function shippingPerfOperationalStoKeyExpr(
  contractAlias = 'c',
  shipmentAlias = 's',
): string {
  const planned = shippingPerfHasKlipPlanningSql(shipmentAlias);
  const skipMismatchedShipId = `(
    NOT (${planned})
    AND NULLIF(TRIM(${shipmentAlias}.shipment_id::text), '') ~ '^[0-9]+$'
    AND NULLIF(TRIM(${contractAlias}.sto_number::text), '') IS NOT NULL
    AND TRIM(${shipmentAlias}.shipment_id::text) <> TRIM(${contractAlias}.sto_number::text)
  )`;

  return `NULLIF(TRIM(COALESCE(
    CASE WHEN ${planned} THEN NULLIF(TRIM(${shipmentAlias}.operation_id::text), '') ELSE NULL END,
    CASE WHEN ${planned} THEN NULLIF(TRIM(${shipmentAlias}.shipment_id::text), '') ELSE NULL END,
    NULLIF(TRIM(${contractAlias}.sto_number::text), ''),
    (
      SELECT NULLIF(TRIM(cs.sto_number::text), '')
      FROM contract_stos cs
      WHERE cs.contract_id = ${contractAlias}.id
        AND NULLIF(TRIM(cs.sto_number::text), '') IS NOT NULL
      ORDER BY cs.updated_at DESC NULLS LAST
      LIMIT 1
    ),
    CASE WHEN ${skipMismatchedShipId} THEN NULL ELSE NULLIF(TRIM(${shipmentAlias}.shipment_id::text), '') END,
    NULLIF(TRIM(${shipmentAlias}.operation_id::text), ''),
    ${shipmentAlias}.id::text
  )), '')`;
}

/** @deprecated Use shippingPerfOperationalStoKeyExpr — kept as alias for imports. */
export const SHIPPING_PERF_STO_GROUP_KEY_EXPR = shippingPerfOperationalStoKeyExpr('c', 's');

function isSyntheticStoKey(value: string): boolean {
  const v = value.trim().toUpperCase();
  return v.startsWith('MNL-') || v.startsWith('MSEA-') || v.startsWith('OP-');
}

/** TypeScript mirror of shippingPerfHasKlipPlanningSql for row aggregation tests. */
export function hasKlipShipmentPlanning(row: Record<string, unknown>): boolean {
  const operationId = String(row.operation_id ?? '').trim();
  if (operationId) return true;

  const shipmentId = String(row.shipment_id ?? '').trim();
  if (shipmentId.startsWith('MNL-') || shipmentId.startsWith('MSEA-')) return true;

  const daily = row.daily_deliverables;
  if (!Array.isArray(daily)) return false;
  return daily.some((item) => {
    if (!item || typeof item !== 'object') return false;
    const qty = Number((item as { quantity_delivered?: unknown }).quantity_delivered ?? 0);
    const date = String((item as { date?: unknown }).date ?? '').trim();
    return date.length > 0 && Number.isFinite(qty) && qty > 0;
  });
}

/** Group key for aggregateShippingPerformanceRowsBySto — prefers SQL sto_key when present. */
export function shippingPerfStoGroupKeyFromRow(row: Record<string, unknown>): string {
  const sqlKey = String(row.sto_key ?? '').trim();
  if (sqlKey && !isSyntheticStoKey(sqlKey)) {
    if (/^\d+$/.test(sqlKey)) return `sto:${sqlKey}`;
    return `op:${sqlKey}`;
  }

  const planned = hasKlipShipmentPlanning(row);
  if (planned) {
    const op = String(row.operation_id ?? '').trim();
    if (op) return `op:${op}`;
    const ship = String(row.shipment_id ?? '').trim();
    if (ship && /^\d+$/.test(ship)) return `sto:${ship}`;
    if (ship) return `ship:${ship}`;
  }

  const contractSto = String(row.sto_number ?? '').trim();
  if (contractSto && /^\d+$/.test(contractSto)) return `sto:${contractSto}`;

  for (const raw of [row.sto_number, row.shipment_id]) {
    const sto = String(raw ?? '').trim();
    if (!sto || isSyntheticStoKey(sto)) continue;
    if (/^\d+$/.test(sto)) return `sto:${sto}`;
  }

  const shipmentId = String(row.shipment_id ?? '').trim();
  if (shipmentId && !isSyntheticStoKey(shipmentId)) return `ship:${shipmentId}`;
  const operationId = String(row.operation_id ?? '').trim();
  if (operationId) return `op:${operationId}`;
  return `id:${String(row.id ?? '')}`;
}

const SPD_STO_MATCH_EXPR = (stoKeyExpr: string, spdAlias = 'spd') => `NULLIF(TRIM(COALESCE(
  ${spdAlias}.sto_number::text,
  ${spdAlias}.data->'raw'->>'STO No.',
  ${spdAlias}.data->'raw'->>'STO Number',
  ${spdAlias}.data->'shipment'->>'sto_no',
  ${spdAlias}.data->'contract'->>'sto_no'
)), '') = TRIM(${stoKeyExpr})`;

const SPD_RECEIVE_KG_EXPR = `NULLIF(regexp_replace(COALESCE(
  NULLIF(TRIM(spd.data->'raw'->>'Quantity Receive'), ''),
  NULLIF(TRIM(spd.data->'raw'->>'Qty Receive'), ''),
  ''
), '[^0-9\\.-]', '', 'g'), '')::numeric`;

const SPD_DELIVER_KG_EXPR = `NULLIF(regexp_replace(COALESCE(
  NULLIF(TRIM(spd.data->'raw'->>'Quantity Delivered'), ''),
  NULLIF(TRIM(spd.data->'raw'->>'Quantity Delivery'), ''),
  ''
), '[^0-9\\.-]', '', 'g'), '')::numeric`;

const SPD_STO_QTY_KG_EXPR = `NULLIF(regexp_replace(COALESCE(
  NULLIF(TRIM(spd.data->'contract'->>'sto_quantity'), ''),
  NULLIF(TRIM(spd.data->'shipment'->>'sto_quantity'), ''),
  NULLIF(TRIM(spd.data->'raw'->>'STO Quantity'), ''),
  NULLIF(TRIM(spd.data->'raw'->>'sto quantity'), ''),
  ''
), '[^0-9\\.-]', '', 'g'), '')::numeric`;

/** Sum of contract quantity (kg) for every contract linked to the STO group. */
export function sqlShippingPerfStoLinkedContractQty(stoKeyExpr: string): string {
  return `(
    SELECT COALESCE(SUM(cc.quantity_ordered::numeric), 0)
    FROM contracts cc
    WHERE cc.contract_id IN (${contractsOnStoSubquery(stoKeyExpr)})
  )`;
}

/** SAP STO quantity (kg) for the STO group — max across linked SAP rows / contracts. */
export function sqlShippingPerfStoLevelStoQtyKg(stoKeyExpr: string): string {
  return `(
    SELECT COALESCE(
      MAX(${SPD_STO_QTY_KG_EXPR}),
      MAX(cc.sto_quantity::numeric),
      0
    )
    FROM contracts cc
    LEFT JOIN sap_processed_data spd ON TRIM(spd.contract_number) = TRIM(cc.contract_id)
      AND ${SPD_STO_MATCH_EXPR(stoKeyExpr)}
    WHERE cc.contract_id IN (${contractsOnStoSubquery(stoKeyExpr)})
  )`;
}

/** Incoterm-aware fulfilled qty (kg) summed across all contracts / POs on the STO. */
export function sqlShippingPerfStoLevelFulfilledKg(stoKeyExpr: string): string {
  const inc = `UPPER(TRIM(COALESCE(cc.incoterm, '')))`;
  return `(
    SELECT COALESCE(SUM(
      CASE
        WHEN ${inc} IN ('FRC', 'CIF', 'CFR') THEN COALESCE(${SPD_RECEIVE_KG_EXPR}, 0)
        WHEN ${inc} IN ('LCO', 'FOB') THEN COALESCE(${SPD_DELIVER_KG_EXPR}, 0)
        ELSE COALESCE(${SPD_RECEIVE_KG_EXPR}, ${SPD_DELIVER_KG_EXPR}, 0)
      END
    ), 0)
    FROM contracts cc
    INNER JOIN sap_processed_data spd ON TRIM(spd.contract_number) = TRIM(cc.contract_id)
      AND ${SPD_STO_MATCH_EXPR(stoKeyExpr)}
    WHERE cc.contract_id IN (${contractsOnStoSubquery(stoKeyExpr)})
  )`;
}

export function sqlShippingPerfStoLinkedPoNumbers(
  stoKeyExpr: string,
  contractAlias = 'c',
): string {
  return buildStoLinkedPoNumbersSql(stoKeyExpr, contractAlias);
}
