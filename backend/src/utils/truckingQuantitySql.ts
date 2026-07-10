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
 * Prefer KLIP-resolved qty (WB daily actuals synced to trucking_operations) over SAP per-STO
 * when trucking_daily_actuals exist for the operation.
 */
export function sqlTruckingPreferWbResolvedQty(
  innerQtyExpr: string,
  sapPerStoQtyExpr: string,
  operationIdExpr = 'e.id',
): string {
  return `CASE
    WHEN EXISTS (
      SELECT 1 FROM trucking_daily_actuals da
      WHERE da.trucking_operation_id = ${operationIdExpr}
    ) THEN COALESCE(${innerQtyExpr}, 0)
    ELSE COALESCE(${sapPerStoQtyExpr}, ${innerQtyExpr}, 0)
  END`;
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

/** Trucking list (non-STO-expand) OS Qty — WB sync updates t.quantity_delivered before SAP fallback. */
export function sqlTruckingListBaseOutstandingQtyExpr(contractAlias = 'c'): string {
  return sqlTruckingOutstandingQtyByIncoterm(
    sqlTruckingQuantityDeliveredCoalesce(),
    sqlTruckingQuantityReceiveCoalesce(),
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
