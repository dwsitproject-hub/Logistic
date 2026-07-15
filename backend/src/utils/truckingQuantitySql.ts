import { sqlPoStoSapQtyKg } from './contractPoGlobalMetricsSql';
import { isContractDeliveryClosed, sqlIsContractSapClosedExpr } from './contractDeliveryStatus';

/** OS Qty within this band (kg) counts as fulfilled for trucking COMPLETED status. */
export const TRUCKING_OUTSTANDING_QTY_TOLERANCE_KG = 1;

/**
 * SAP trucking quantity fields are often exported in MT while contracts.quantity_ordered is kg.
 * When the SAP value is clearly MT-scale, normalize to kg for API consumers and UI MT formatting.
 */
export function sqlNormalizeSapTruckingQtyToKg(
  sapNumericExpr: string,
  contractQtyKgExpr = 'COALESCE(c.quantity_ordered, 0)',
): string {
  return `CASE
    WHEN (${sapNumericExpr}) IS NULL THEN NULL
    WHEN (${sapNumericExpr}) < (${contractQtyKgExpr}) / 10.0
         AND (${sapNumericExpr}) * 1000 <= (${contractQtyKgExpr}) * 1.05
      THEN (${sapNumericExpr}) * 1000
    ELSE (${sapNumericExpr})
  END`;
}

const SAP_QTY_CAST = `CAST(REPLACE(REPLACE(TRIM(q.val), ',', ''), ' ', '') AS NUMERIC)`;

function sqlSapNumericSubquery(fieldCoalesce: string): string {
  return `(
    SELECT ${sqlNormalizeSapTruckingQtyToKg(SAP_QTY_CAST)}
    FROM (
      SELECT COALESCE(${fieldCoalesce}) AS val
      FROM sap_processed_data spd
      WHERE spd.contract_number = c.contract_id
      ORDER BY spd.created_at DESC NULLS LAST
      LIMIT 1
    ) q
    WHERE q.val IS NOT NULL AND trim(q.val) ~ '^[0-9.,\\s]+$'
  )`;
}

/** Resolved quantity_sent with SAP fallback (kg). */
export function sqlTruckingQuantitySentCoalesce(tableCol = 't.quantity_sent'): string {
  return `COALESCE(
    ${tableCol},
    ${sqlSapNumericSubquery(`
      spd.data->'raw'->>'Quantity Sent via Trucking (Based on Surat Jalan)',
      spd.data->>'quantity_sent_via_trucking_based_on_surat_jalan',
      spd.data->'raw'->>'Quantity Sent via Trucking',
      spd.data->'raw'->>'Quantity Sent',
      spd.data->>'Quantity Sent'
    `)}
  )`;
}

/** Resolved quantity_delivered with SAP fallback (kg). */
export function sqlTruckingQuantityDeliveredCoalesce(tableCol = 't.quantity_delivered'): string {
  return `COALESCE(
    ${tableCol},
    ${sqlSapNumericSubquery(`
      spd.data->'raw'->>'Quantity Delivered via Trucking',
      spd.data->>'quantity_delivered_via_trucking',
      spd.data->'raw'->>'Qty Receive',
      spd.data->'raw'->>'Quantity Receive'
    `)}
  )`;
}

/** Resolved quantity_receive with SAP fallback (kg). */
export function sqlTruckingQuantityReceiveCoalesce(): string {
  return `COALESCE(
    t.quantity_delivered,
    ${sqlSapNumericSubquery(`
      spd.data->'raw'->>'Qty Receive',
      spd.data->'raw'->>'Quantity Receive',
      spd.data->>'quantity_delivered_via_trucking'
    `)}
  )`;
}

/**
 * SAP-only Qty Delivery (kg) — no coalesce with trucking_operations / WB.
 * Null when SAP has no matching numeric field.
 */
export function sqlSapQtyDeliveryOnly(): string {
  return sqlSapNumericSubquery(`
    spd.data->'raw'->>'Quantity Delivery Trucking',
    spd.data->'raw'->>'Quantity Delivered Trucking',
    spd.data->'raw'->>'Quantity Delivered via Trucking',
    spd.data->>'quantity_delivered_via_trucking',
    spd.data->'raw'->>'Quantity Delivered',
    spd.data->'raw'->>'Quantity Delivery',
    spd.data->'raw'->>'Qty Delivery'
  `);
}

/**
 * SAP-only Qty Receive (kg) — no coalesce with trucking_operations / WB.
 * Null when SAP has no matching numeric field.
 */
export function sqlSapQtyReceiveOnly(): string {
  return sqlSapNumericSubquery(`
    spd.data->'raw'->>'Quantity Receive',
    spd.data->'raw'->>'Qty Receive'
  `);
}

/** True when the trucking operation has at least one WB/daily actual row. */
export function sqlTruckingHasDailyActualsExpr(operationIdExpr = 't.id'): string {
  return `EXISTS (
    SELECT 1 FROM trucking_daily_actuals da
    WHERE da.trucking_operation_id = ${operationIdExpr}
  )`;
}

/**
 * Sum of WB Qty Delivery for an operation (Netto PKS).
 * Legacy rows without quantity_delivery_kg fall back to quantity_kg.
 */
export function sqlWbActualDeliverySumKg(operationIdExpr = 't.id'): string {
  return `(
    SELECT COALESCE(SUM(COALESCE(da.quantity_delivery_kg, da.quantity_kg)), 0)::numeric
    FROM trucking_daily_actuals da
    WHERE da.trucking_operation_id = ${operationIdExpr}
  )`;
}

/**
 * Sum of WB Qty Receive for an operation (Netto EUP).
 * Null receive columns count as 0.
 */
export function sqlWbActualReceiveSumKg(operationIdExpr = 't.id'): string {
  return `(
    SELECT COALESCE(SUM(COALESCE(da.quantity_receive_kg, 0)), 0)::numeric
    FROM trucking_daily_actuals da
    WHERE da.trucking_operation_id = ${operationIdExpr}
  )`;
}

/**
 * Delivery Qty for list/STO expand:
 * - Open + WB actuals → WB delivery sum (op-level; repeated on every STO child)
 * - Close → SAP (per-STO or contract-level expr)
 * - else → COALESCE(SAP, op/KLIP qty)
 */
export function sqlTruckingResolvedDeliveryQty(
  innerQtyExpr: string,
  sapQtyExpr: string,
  operationIdExpr = 't.id',
  contractAlias = 'c',
): string {
  const grClosed = sqlIsContractSapClosedExpr(contractAlias);
  const hasWb = sqlTruckingHasDailyActualsExpr(operationIdExpr);
  const wbDelivery = sqlWbActualDeliverySumKg(operationIdExpr);
  return `CASE
    WHEN (${hasWb}) AND NOT (${grClosed}) THEN ${wbDelivery}
    WHEN (${grClosed}) THEN COALESCE(${sapQtyExpr}, 0)
    ELSE COALESCE(${sapQtyExpr}, ${innerQtyExpr}, 0)
  END`;
}

/**
 * Receive Qty for list/STO expand — same Open/Close rules as Delivery, using WB receive sum.
 */
export function sqlTruckingResolvedReceiveQty(
  innerQtyExpr: string,
  sapQtyExpr: string,
  operationIdExpr = 't.id',
  contractAlias = 'c',
): string {
  const grClosed = sqlIsContractSapClosedExpr(contractAlias);
  const hasWb = sqlTruckingHasDailyActualsExpr(operationIdExpr);
  const wbReceive = sqlWbActualReceiveSumKg(operationIdExpr);
  return `CASE
    WHEN (${hasWb}) AND NOT (${grClosed}) THEN ${wbReceive}
    WHEN (${grClosed}) THEN COALESCE(${sapQtyExpr}, 0)
    ELSE COALESCE(${sapQtyExpr}, ${innerQtyExpr}, 0)
  END`;
}

/**
 * @deprecated Prefer sqlTruckingResolvedDeliveryQty / sqlTruckingResolvedReceiveQty.
 * Kept for callers that still pass a single qty series; Open+WB now uses WB delivery sum.
 */
export function sqlTruckingPreferWbResolvedQty(
  innerQtyExpr: string,
  sapPerStoQtyExpr: string,
  operationIdExpr = 'e.id',
  contractAlias = 'c',
): string {
  return sqlTruckingResolvedDeliveryQty(
    innerQtyExpr,
    sapPerStoQtyExpr,
    operationIdExpr,
    contractAlias,
  );
}

/**
 * Outstanding qty (kg) for trucking list — FRC: contract − receive; LCO: contract − delivered.
 * Other incoterms return NULL.
 */
export function sqlTruckingOutstandingQtyByIncoterm(
  qtyDeliveredExpr: string,
  qtyReceiveExpr: string,
  contractQtyExpr = 'COALESCE(c.quantity_ordered, 0)',
  incotermExpr = 'c.incoterm',
): string {
  return `(
    CASE
      WHEN UPPER(TRIM(COALESCE(${incotermExpr}, ''))) = 'FRC' THEN
        (${contractQtyExpr}) - COALESCE(${qtyReceiveExpr}, 0)
      WHEN UPPER(TRIM(COALESCE(${incotermExpr}, ''))) = 'LCO' THEN
        (${contractQtyExpr}) - COALESCE(${qtyDeliveredExpr}, 0)
      ELSE NULL
    END
  )`;
}

export function isTruckingOutstandingWithinToleranceKg(
  outstandingKg: number | null | undefined,
  toleranceKg = TRUCKING_OUTSTANDING_QTY_TOLERANCE_KG,
): boolean {
  if (outstandingKg === null || outstandingKg === undefined || !Number.isFinite(outstandingKg)) {
    return false;
  }
  return Math.abs(outstandingKg) <= toleranceKg;
}

/**
 * COMPLETED when GR PO/STO Close (incoterm), OR GR Open and |OS Qty| within tolerance (kg).
 */
export function isTruckingPipelineCompleted(
  contractImportStatus: unknown,
  outstandingQtyKg: number | null | undefined,
): boolean {
  return (
    isContractDeliveryClosed(contractImportStatus) ||
    isTruckingOutstandingWithinToleranceKg(outstandingQtyKg)
  );
}

/** @deprecated Use isTruckingPipelineCompleted */
export const isTruckingCompletedByGrAndOs = isTruckingPipelineCompleted;

/** True when |outstanding qty| is within tolerance (kg); NULL outstanding does not qualify. */
export function sqlTruckingOutstandingWithinToleranceExpr(
  outstandingExpr: string,
  toleranceKg = TRUCKING_OUTSTANDING_QTY_TOLERANCE_KG,
): string {
  return `(
    ${outstandingExpr} IS NOT NULL
    AND ABS((${outstandingExpr})::numeric) <= ${toleranceKg}
  )`;
}

/** Pipeline COMPLETED: GR PO/STO Close (incoterm) OR GR Open with OS Qty within tolerance. */
export function sqlTruckingPipelineIsCompletedExpr(
  contractAlias = 'c',
  outstandingQtyExpr?: string,
): string {
  const outstanding =
    outstandingQtyExpr ?? sqlTruckingListBaseOutstandingQtyExpr(contractAlias);
  return `(
    ${sqlIsContractSapClosedExpr(contractAlias)}
    OR ${sqlTruckingOutstandingWithinToleranceExpr(outstanding)}
  )`;
}

/** Trucking list (non-STO-expand) resolved Delivery Qty (Open→WB / Close→SAP). */
export function sqlTruckingListResolvedDeliveryQtyExpr(
  operationIdExpr = 't.id',
  contractAlias = 'c',
): string {
  return sqlTruckingResolvedDeliveryQty(
    'COALESCE(t.quantity_delivered, 0)',
    sqlSapQtyDeliveryOnly(),
    operationIdExpr,
    contractAlias,
  );
}

/** Trucking list (non-STO-expand) resolved Receive Qty (Open→WB / Close→SAP). */
export function sqlTruckingListResolvedReceiveQtyExpr(
  operationIdExpr = 't.id',
  contractAlias = 'c',
): string {
  return sqlTruckingResolvedReceiveQty(
    'COALESCE(t.quantity_delivered, 0)',
    sqlSapQtyReceiveOnly(),
    operationIdExpr,
    contractAlias,
  );
}

/** Trucking list (non-STO-expand) OS Qty using Open→WB / Close→SAP Delivery & Receive. */
export function sqlTruckingListBaseOutstandingQtyExpr(contractAlias = 'c'): string {
  return sqlTruckingOutstandingQtyByIncoterm(
    sqlTruckingListResolvedDeliveryQtyExpr('t.id', contractAlias),
    sqlTruckingListResolvedReceiveQtyExpr('t.id', contractAlias),
    `COALESCE(${contractAlias}.quantity_ordered, 0)`,
    `${contractAlias}.incoterm`,
  );
}

/** Per-STO SAP qty (kg) for STO-expanded trucking rows; falls back to full contract qty. */
export function sqlTruckingExpandedStoLineQtyKgExpr(
  contractNumberExpr = 'e.contract_number',
  poNumberExpr = 'e.po_number',
  contractQtyExpr = 'e.contract_qty',
  stoKeyExpr = 'e.sto_line_resolved',
): string {
  const stoQty = sqlPoStoSapQtyKg({
    contractNumberExpr,
    poNumberExpr,
    contractQtyExpr,
    stoKeyExpr,
  });
  return `COALESCE(NULLIF((${stoQty}), 0), ${contractQtyExpr})`;
}
