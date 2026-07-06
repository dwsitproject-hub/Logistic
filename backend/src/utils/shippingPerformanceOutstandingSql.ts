import { sqlSumDailyDeliverablesKg } from './dailyDeliverablesSql';

/** STO-level outstanding (kg) after actual receive/delivery fulfillment. */
export function sqlShippingPerfOutstandingActualExpr(opts: {
  stoQtyExpr: string;
  fulfilledExpr: string;
}): string {
  return `GREATEST(
    COALESCE(${opts.stoQtyExpr}, 0)::numeric
    - COALESCE(${opts.fulfilledExpr}, 0)::numeric,
    0
  )`;
}

/** KLIP planning qty (kg) = shipment daily deliverables + linked trucking daily deliverables. */
export function sqlShippingPerfPlanningQtyExpr(opts: {
  shipmentAlias?: string;
  contractAlias?: string;
}): string {
  const s = opts.shipmentAlias ?? 's';
  const c = opts.contractAlias ?? 'c';
  const stoKeyExpr = `TRIM(COALESCE(
    NULLIF(TRIM(${s}.shipment_id), ''),
    NULLIF(TRIM(${s}.operation_id), ''),
    NULLIF(TRIM(${c}.sto_number::text), ''),
    ${s}.id::text
  ))`;
  const shipmentPlanning = sqlSumDailyDeliverablesKg(`${s}.daily_deliverables`);
  const truckingPlanning = `(
    SELECT COALESCE(SUM((${sqlSumDailyDeliverablesKg('t.daily_deliverables')})::numeric), 0)
    FROM trucking_operations t
    WHERE t.contract_id = ${c}.id
      AND (
        t.shipment_id = ${s}.id
        OR TRIM(COALESCE(t.operation_id::text, '')) = ${stoKeyExpr}
        OR EXISTS (
          SELECT 1 FROM contract_stos cs
          WHERE cs.contract_id = ${c}.id
            AND TRIM(cs.sto_number::text) = ${stoKeyExpr}
        )
      )
  )`;
  return `(${shipmentPlanning}::numeric + ${truckingPlanning}::numeric)`;
}

/** STO-level outstanding (kg) after SAP STO qty + KLIP shipment planning qty. */
export function sqlShippingPerfOutstandingPlanningExpr(opts: {
  contractQtyExpr: string;
  stoQtyExpr: string;
  shipmentPlanningQtyExpr: string;
}): string {
  return `GREATEST(
    COALESCE(${opts.contractQtyExpr}, 0)::numeric
    - COALESCE(${opts.stoQtyExpr}, 0)::numeric
    - COALESCE(${opts.shipmentPlanningQtyExpr}, 0)::numeric,
    0
  )`;
}
