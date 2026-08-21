import { SPD_EFFECTIVE_STO_SQL } from './contractLogisticsStoDetailSql';
import { sqlPoGlobalSapStoQtyKg, sqlPoStoSapQtyKg } from './contractPoGlobalMetricsSql';
import { isContractDeliveryClosed, sqlIsContractSapClosedExpr } from './contractDeliveryStatus';
import { sqlCoalesceSapRawQtyFields } from './sapQtyPlaceholderSql';
import { sqlNormalizeSapQtyToKgWithUom } from './sapQtyUom';
import {
  sqlWbActualDeliverySumKg,
  sqlWbActualReceiveSumKg,
} from './truckingWbActualSumSql';

export { sqlWbActualDeliverySumKg, sqlWbActualReceiveSumKg } from './truckingWbActualSumSql';
export { sqlCoalesceSapRawQtyFields, sqlNullIfSapQtyPlaceholder } from './sapQtyPlaceholderSql';

const SPD_EFFECTIVE_STO = SPD_EFFECTIVE_STO_SQL;

/** Match SAP rows to a trucking PO (preferred) or to any STO line on the contract. */
export function sqlTruckingPoLevelSapRowMatch(
  contractUuidExpr = 'e.contract_id',
  poNumberExpr = 'e.po_number',
  spdAlias = 'spd',
): string {
  const poRaw = `TRIM(COALESCE(
    ${spdAlias}.po_number::text,
    ${spdAlias}.data->'raw'->>'PO No',
    ${spdAlias}.data->'raw'->>'PO No.',
    ${spdAlias}.data->'raw'->>'PO Number',
    ${spdAlias}.data->'contract'->>'po_number',
    ''
  ))`;
  return `(
    (
      NULLIF(TRIM(${poNumberExpr}::text), '') IS NOT NULL
      AND ${poRaw} = TRIM(${poNumberExpr}::text)
    )
    OR (
      NULLIF(TRIM(${poNumberExpr}::text), '') IS NULL
      AND (
        EXISTS (
          SELECT 1
          FROM contract_sto_lines csl_m
          WHERE csl_m.contract_uuid = ${contractUuidExpr}
            AND TRIM(csl_m.sto_line) = TRIM(${SPD_EFFECTIVE_STO})
        )
        OR NOT EXISTS (
          SELECT 1 FROM contract_sto_lines csl_any
          WHERE csl_any.contract_uuid = ${contractUuidExpr}
        )
      )
    )
  )`;
}

export const SAP_DELIVERY_RAW_FIELDS = [
  `spd.data->'raw'->>'Quantity Delivery Trucking'`,
  `spd.data->'raw'->>'Quantity Delivered Trucking'`,
  `spd.data->'raw'->>'Quantity Delivered via Trucking'`,
  `spd.data->>'quantity_delivered_via_trucking'`,
  `spd.data->'raw'->>'Quantity Delivered'`,
  `spd.data->'raw'->>'Quantity Delivery'`,
  `spd.data->'raw'->>'Qty Delivery'`,
  `spd.data->'shipment'->>'quantity_delivery'`,
  `spd.data->'contract'->>'quantity_delivery'`,
] as const;

export const SAP_RECEIVE_RAW_FIELDS = [
  `spd.data->'raw'->>'Quantity Receive'`,
  `spd.data->'raw'->>'Qty Receive'`,
  `spd.data->'shipment'->>'quantity_receive'`,
  `spd.data->'contract'->>'quantity_receive'`,
] as const;

/** UOM columns paired with delivery qty (SAP Data v3). */
export const SAP_DELIVERY_UOM_FIELDS = [
  `spd.data->'trucking'->0->'data'->>'quantity_delivery_trucking_uom'`,
  `spd.data->'shipment'->>'quantity_delivery_trucking_uom'`,
  `spd.data->'shipment'->>'quantity_delivery_uom'`,
  `spd.data->'raw'->>'Delivery Trucking UoM'`,
  `spd.data->'raw'->>'Delivery Vessel UoM'`,
] as const;

/** UOM columns paired with receive qty (SAP Data v3). */
export const SAP_RECEIVE_UOM_FIELDS = [
  `spd.data->'trucking'->0->'data'->>'quantity_receive_uom'`,
  `spd.data->'shipment'->>'quantity_receive_uom'`,
  `spd.data->'contract'->>'quantity_receive_uom'`,
  `spd.data->'raw'->>'Receive UoM'`,
] as const;

/**
 * Exported (in addition to being used locally below) so
 * `truckingPoQtyResolutionCteSql.ts` can build the same raw-value matching
 * used by `sqlTruckingPoLevelSapQtyWithDedup`, but pre-aggregated via GROUP BY
 * across all contracts in one pass instead of once per outer row.
 */
export const SAP_DELIVERY_RAW_COALESCE = sqlCoalesceSapRawQtyFields(SAP_DELIVERY_RAW_FIELDS);

export const SAP_RECEIVE_RAW_COALESCE = sqlCoalesceSapRawQtyFields(SAP_RECEIVE_RAW_FIELDS);

export const SAP_DELIVERY_UOM_COALESCE = `COALESCE(${SAP_DELIVERY_UOM_FIELDS.join(', ')})`;
export const SAP_RECEIVE_UOM_COALESCE = `COALESCE(${SAP_RECEIVE_UOM_FIELDS.join(', ')})`;

/**
 * Latest-per-STO SAP qty (kg) with Contracts-style multi-STO PO-level dedup:
 * 1) Drop rows that look like full-PO qty repeated on each STO when Σ > 1.2× contract.
 * 2) If adjusted Σ still > 1.2× contract, use MAX (e.g. 2× ~1941 MT → ~1941, not 3882).
 */
function sqlTruckingPoLevelSapQtyWithDedup(
  rawQtyExpr: string,
  rawPresentCheck: string,
  contractNumberExpr: string,
  contractUuidExpr: string,
  poNumberExpr: string,
  contractQtyKgExpr: string,
  uomExpr = `''`,
): string {
  const match = sqlTruckingPoLevelSapRowMatch(contractUuidExpr, poNumberExpr);
  const stoKey = `TRIM(COALESCE(${SPD_EFFECTIVE_STO}, spd.sto_number::text, ''))`;
  const qtyKg = sqlNormalizeSapTruckingQtyToKg('x.qty', contractQtyKgExpr, 'x.uom');
  const cq = `(${contractQtyKgExpr})`;
  return `(
    WITH latest_per_sto AS (
      SELECT DISTINCT ON (spd.contract_number, ${stoKey})
        ${rawQtyExpr} AS qty,
        ${uomExpr} AS uom
      FROM sap_processed_data spd
      WHERE spd.contract_number = ${contractNumberExpr}
        AND ${match}
        AND ${rawPresentCheck}
      ORDER BY spd.contract_number, ${stoKey}, spd.created_at DESC NULLS LAST
    ),
    normalized AS (
      SELECT ${qtyKg} AS qty_kg
      FROM latest_per_sto x
      WHERE x.qty IS NOT NULL
    ),
    metrics AS (
      SELECT
        COUNT(*)::int AS sto_count,
        COALESCE(SUM(qty_kg), 0)::numeric AS sum_raw,
        COALESCE(MAX(qty_kg), 0)::numeric AS max_qty
      FROM normalized
    ),
    adj AS (
      SELECT
        m.sto_count,
        m.max_qty,
        COALESCE(SUM(n.qty_kg) FILTER (
          WHERE NOT (
            m.sto_count > 1
            AND m.sum_raw > ${cq} * 1.2
            AND n.qty_kg >= ${cq} * 0.95
          )
        ), 0)::numeric AS sum_adj
      FROM metrics m
      CROSS JOIN normalized n
      GROUP BY m.sto_count, m.max_qty, m.sum_raw
    )
    SELECT CASE
      WHEN a.sto_count > 1 AND a.sum_adj > ${cq} * 1.2 THEN a.max_qty
      ELSE a.sum_adj
    END
    FROM adj a
  )`;
}

/**
 * SAP Delivery Qty (kg) summed across STO rows for the PO (latest row per STO only).
 * Used for trucking PO-grain list when GR is Close: Contract Qty − Σ Delivery.
 * Applies Contracts multi-STO PO-level duplicate dedup when Σ is inflated.
 */
/** Business contract number for SAP joins — never the list STRING_AGG display. */
export function sqlTruckingSapContractNumberFromUuid(
  contractUuidExpr = 'e.contract_id',
): string {
  return `(SELECT cx.contract_id FROM contracts cx WHERE cx.id = ${contractUuidExpr})`;
}

export function sqlTruckingPoLevelSapDeliveryQty(
  contractNumberExpr = sqlTruckingSapContractNumberFromUuid(),
  contractUuidExpr = 'e.contract_id',
  poNumberExpr = 'e.po_number',
  contractQtyKgExpr = 'COALESCE(c.quantity_ordered, 0)',
): string {
  const rawQty = `NULLIF(regexp_replace(${SAP_DELIVERY_RAW_COALESCE}, '[^0-9\\.-]', '', 'g'), '')::numeric`;
  return sqlTruckingPoLevelSapQtyWithDedup(
    rawQty,
    `NULLIF(TRIM(${SAP_DELIVERY_RAW_COALESCE}), '') IS NOT NULL`,
    contractNumberExpr,
    contractUuidExpr,
    poNumberExpr,
    contractQtyKgExpr,
    SAP_DELIVERY_UOM_COALESCE,
  );
}

/**
 * SAP Receive Qty (kg) summed across STO rows for the PO (latest row per STO only).
 * Used for trucking PO-grain list when GR is Close: Contract Qty − Σ Receive.
 * Applies Contracts multi-STO PO-level duplicate dedup when Σ is inflated.
 */
export function sqlTruckingPoLevelSapReceiveQty(
  contractNumberExpr = sqlTruckingSapContractNumberFromUuid(),
  contractUuidExpr = 'e.contract_id',
  poNumberExpr = 'e.po_number',
  contractQtyKgExpr = 'COALESCE(c.quantity_ordered, 0)',
): string {
  const rawQty = `NULLIF(regexp_replace(${SAP_RECEIVE_RAW_COALESCE}, '[^0-9\\.-]', '', 'g'), '')::numeric`;
  return sqlTruckingPoLevelSapQtyWithDedup(
    rawQty,
    `NULLIF(TRIM(${SAP_RECEIVE_RAW_COALESCE}), '') IS NOT NULL`,
    contractNumberExpr,
    contractUuidExpr,
    poNumberExpr,
    contractQtyKgExpr,
    SAP_RECEIVE_UOM_COALESCE,
  );
}

/**
 * OS Qty at or below this band (kg) counts as fulfilled for trucking COMPLETED when GR is still Open.
 * Aligned with whole-MT table display (`maxFractionDigits: 0`): residual OS ≤ 499 kg → "0 MT".
 * Also treats over-delivery (negative OS / UI "+N MT") as fulfilled — any OS ≤ 499 kg qualifies.
 * Example: contract 225,000 kg − receive 224,714 kg = 286 kg OS → Completed despite GR Open.
 * Example: OS = −3,000 kg (UI +3 MT overdelivered) → Completed.
 */
export const TRUCKING_OUTSTANDING_QTY_TOLERANCE_KG = 499;

/**
 * SAP trucking quantity fields are often exported in MT while contracts.quantity_ordered is kg.
 * When an explicit UOM is present (SAP Data v3), convert by UOM; otherwise keep the scale heuristic.
 */
export function sqlNormalizeSapTruckingQtyToKg(
  sapNumericExpr: string,
  contractQtyKgExpr = 'COALESCE(c.quantity_ordered, 0)',
  uomExpr = `''`,
): string {
  return sqlNormalizeSapQtyToKgWithUom(sapNumericExpr, uomExpr, contractQtyKgExpr);
}

const SAP_QTY_CAST = `CAST(REPLACE(REPLACE(TRIM(q.val), ',', ''), ' ', '') AS NUMERIC)`;

function sqlSapNumericSubquery(
  fields: readonly string[],
  uomFields: readonly string[] = [],
): string {
  const uomSelect =
    uomFields.length > 0 ? `COALESCE(${uomFields.join(', ')})` : `''`;
  return `(
    SELECT ${sqlNormalizeSapTruckingQtyToKg(SAP_QTY_CAST, 'COALESCE(c.quantity_ordered, 0)', 'q.uom')}
    FROM (
      SELECT ${sqlCoalesceSapRawQtyFields(fields)} AS val,
             ${uomSelect} AS uom
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
    NULLIF(${tableCol}, 0),
    ${sqlSapNumericSubquery([
      `spd.data->'raw'->>'Quantity Sent via Trucking (Based on Surat Jalan)'`,
      `spd.data->>'quantity_sent_via_trucking_based_on_surat_jalan'`,
      `spd.data->'raw'->>'Quantity Sent via Trucking'`,
      `spd.data->'raw'->>'Quantity Sent'`,
      `spd.data->>'Quantity Sent'`,
    ])}
  )`;
}

/** Resolved quantity_delivered with SAP fallback (kg). */
export function sqlTruckingQuantityDeliveredCoalesce(tableCol = 't.quantity_delivered'): string {
  return `COALESCE(
    NULLIF(${tableCol}, 0),
    ${sqlSapNumericSubquery(SAP_DELIVERY_RAW_FIELDS, SAP_DELIVERY_UOM_FIELDS)}
  )`;
}

/** Resolved quantity_receive with SAP fallback (kg). */
export function sqlTruckingQuantityReceiveCoalesce(): string {
  return `COALESCE(
    NULLIF(t.quantity_delivered, 0),
    ${sqlSapNumericSubquery(SAP_RECEIVE_RAW_FIELDS, SAP_RECEIVE_UOM_FIELDS)}
  )`;
}

/**
 * SAP-only Qty Delivery (kg) — no coalesce with trucking_operations / WB.
 * Null when SAP has no matching numeric field.
 */
export function sqlSapQtyDeliveryOnly(): string {
  return sqlSapNumericSubquery(SAP_DELIVERY_RAW_FIELDS, SAP_DELIVERY_UOM_FIELDS);
}

/**
 * SAP-only Qty Receive (kg) — no coalesce with trucking_operations / WB.
 * Null when SAP has no matching numeric field.
 */
export function sqlSapQtyReceiveOnly(): string {
  return sqlSapNumericSubquery(SAP_RECEIVE_RAW_FIELDS, SAP_RECEIVE_UOM_FIELDS);
}

/** True when the trucking operation has at least one WB/daily actual row. */
export function sqlTruckingHasDailyActualsExpr(operationIdExpr = 't.id'): string {
  return `EXISTS (
    SELECT 1 FROM trucking_daily_actuals da
    WHERE da.trucking_operation_id = ${operationIdExpr}
  )`;
}

/**
 * Optional pre-computed overrides for the GR-closed / WB-actuals pieces of the
 * resolved qty CASE below. When provided (e.g. plain column refs joined from a
 * pre-aggregated CTE — see `truckingPoQtyResolutionCteSql.ts`), the caller
 * avoids re-embedding the underlying `sap_processed_data` / `trucking_daily_actuals`
 * subqueries inline; when omitted, behavior is unchanged from before.
 */
export interface TruckingResolvedQtyOverrides {
  grClosedExpr?: string;
  hasWbExpr?: string;
  wbQtyExpr?: string;
}

/**
 * Delivery Qty for list/STO expand:
 * - GR Open (LCO: GR STO / FRC: GR PO) + WB delivery kg > 0 → WB delivery sum
 * - GR Close → SAP (PO-level sum, latest row per STO)
 * - else → COALESCE(SAP, op/KLIP qty)
 *
 * WB delivery is used only when the Netto PKS sum is actually > 0. A daily-actuals
 * row with null/0 delivery (e.g. receive-only upload) must not hide SAP.
 */
export function sqlTruckingResolvedDeliveryQty(
  innerQtyExpr: string,
  sapQtyExpr: string,
  operationIdExpr = 't.id',
  contractAlias = 'c',
  overrides?: TruckingResolvedQtyOverrides,
): string {
  const grClosed = overrides?.grClosedExpr ?? sqlIsContractSapClosedExpr(contractAlias);
  const hasWb = overrides?.hasWbExpr ?? sqlTruckingHasDailyActualsExpr(operationIdExpr);
  const wbDelivery = overrides?.wbQtyExpr ?? sqlWbActualDeliverySumKg(operationIdExpr);
  return `CASE
    WHEN (${hasWb}) AND NOT (${grClosed}) AND (${wbDelivery}) > 0 THEN ${wbDelivery}
    WHEN (${grClosed}) THEN COALESCE(${sapQtyExpr}, 0)
    ELSE COALESCE(${sapQtyExpr}, ${innerQtyExpr}, 0)
  END`;
}

/**
 * Receive Qty for list/STO expand — same Open/Close rules as Delivery, using WB receive sum.
 *
 * WB receive is used only when Netto EUP sum is actually > 0. A daily-actuals row with
 * null/0 receive (delivery uploaded, EUP still empty) must fall back to SAP Quantity Receive
 * — otherwise the view table shows 0 while Edit Trucking still shows the SAP value.
 */
export function sqlTruckingResolvedReceiveQty(
  innerQtyExpr: string,
  sapQtyExpr: string,
  operationIdExpr = 't.id',
  contractAlias = 'c',
  overrides?: TruckingResolvedQtyOverrides,
): string {
  const grClosed = overrides?.grClosedExpr ?? sqlIsContractSapClosedExpr(contractAlias);
  const hasWb = overrides?.hasWbExpr ?? sqlTruckingHasDailyActualsExpr(operationIdExpr);
  const wbReceive = overrides?.wbQtyExpr ?? sqlWbActualReceiveSumKg(operationIdExpr);
  return `CASE
    WHEN (${hasWb}) AND NOT (${grClosed}) AND (${wbReceive}) > 0 THEN ${wbReceive}
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
  // Residual under-delivery within 0 MT band, or any over-delivery (negative OS).
  return outstandingKg <= toleranceKg;
}

/**
 * COMPLETED when GR PO/STO Close (incoterm), OR OS Qty ≤ 499 kg
 * (0 MT residual band or over-delivery) even while GR is still Open.
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

/** True when outstanding qty ≤ tolerance (kg), including over-delivery; NULL does not qualify. */
export function sqlTruckingOutstandingWithinToleranceExpr(
  outstandingExpr: string,
  toleranceKg = TRUCKING_OUTSTANDING_QTY_TOLERANCE_KG,
): string {
  return `(
    ${outstandingExpr} IS NOT NULL
    AND (${outstandingExpr})::numeric <= ${toleranceKg}
  )`;
}

/** Pipeline COMPLETED: GR PO/STO Close (incoterm) OR OS ≤ 499 kg (incl. over-delivery). */
export function sqlTruckingPipelineIsCompletedExpr(
  contractAlias = 'c',
  outstandingQtyExpr?: string,
  /** Optional precomputed GR-close column (see sqlIsContractSapClosedExpr). */
  grClosedExpr?: string,
): string {
  const outstanding =
    outstandingQtyExpr ?? sqlTruckingListBaseOutstandingQtyExpr(contractAlias);
  return `(
    ${sqlIsContractSapClosedExpr(contractAlias, grClosedExpr)}
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

/**
 * PO-level SAP STO qty (kg) summed across all STOs on the PO; falls back to contract qty.
 * (Legacy name kept — list is now PO-grain, not per-STO-line.)
 */
export function sqlTruckingExpandedStoLineQtyKgExpr(
  contractNumberExpr = sqlTruckingSapContractNumberFromUuid(),
  poNumberExpr = 'e.po_number',
  contractQtyExpr = 'e.contract_qty',
  _stoKeyExpr = 'e.sto_line_resolved',
): string {
  const stoQty = sqlPoGlobalSapStoQtyKg({
    contractNumberExpr,
    poNumberExpr,
  });
  return `COALESCE(NULLIF((${stoQty}), 0), ${contractQtyExpr})`;
}

/** @deprecated Prefer sqlTruckingExpandedStoLineQtyKgExpr (PO-grain). */
export function sqlTruckingExpandedPerStoLineQtyKgExpr(
  contractNumberExpr = sqlTruckingSapContractNumberFromUuid(),
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
