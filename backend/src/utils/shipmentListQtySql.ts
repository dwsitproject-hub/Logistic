/**
 * Shipments list — quantity SQL helpers.
 * Missing SAP / contract qty stays NULL (UI shows "-"), not coerced to 0.
 */

/** Sum contract qty (kg) for contracts linked on a grouped shipment row. */
export function shipmentListRowContractQtySql(spAlias = 'sp'): string {
  const groupedSto = `NULLIF(TRIM(${spAlias}.sto_key::text), '')`;
  return `(
    SELECT SUM(c.quantity_ordered::numeric)
    FROM contracts c
    WHERE c.contract_id IS NOT NULL
      AND TRIM(c.contract_id) <> ''
      AND (
        (
          ${spAlias}.contract_numbers IS NOT NULL
          AND TRIM(${spAlias}.contract_numbers) <> ''
          AND EXISTS (
            SELECT 1
            FROM unnest(regexp_split_to_array(${spAlias}.contract_numbers, E'\\\\s*,\\\\s*')) AS cn
            WHERE TRIM(cn) = TRIM(c.contract_id)
          )
        )
        OR (
          ${groupedSto} IS NOT NULL
          AND (
            EXISTS (
              SELECT 1 FROM contract_stos cs
              WHERE cs.contract_id = c.id
                AND TRIM(cs.sto_number::text) = ${groupedSto}
            )
            OR TRIM(COALESCE(c.sto_number::text, '')) = ${groupedSto}
            OR EXISTS (
              SELECT 1 FROM shipments sh
              WHERE sh.contract_id = c.id
                AND COALESCE(sh.status, '') <> 'CANCELLED'
                AND (
                  NULLIF(TRIM(sh.operation_id::text), '') = ${groupedSto}
                  OR NULLIF(TRIM(sh.shipment_id::text), '') = ${groupedSto}
                )
            )
          )
        )
      )
  )`;
}

/** Incoterm fulfilled kg for list metrics — NULL when the chosen SAP field is NULL. */
export function sqlShipmentListFulfilledKgCase(
  incotermExpr: string,
  receiveExpr: string,
  deliveryExpr: string,
): string {
  const inc = `UPPER(TRIM(COALESCE(${incotermExpr}, '')))`;
  return `CASE
    WHEN ${inc} IN ('FRC', 'CIF', 'CFR') THEN ${receiveExpr}
    WHEN ${inc} IN ('LCO', 'FOB') THEN ${deliveryExpr}
    ELSE COALESCE(${receiveExpr}, ${deliveryExpr})
  END`;
}

/** Outstanding (kg) = contract qty − fulfilled; NULL when either side is unknown. */
export function sqlShipmentListOutstandingKgExpr(opts: {
  contractQtyExpr: string;
  incotermExpr: string;
  receiveExpr: string;
  deliveryExpr: string;
  clampAtZero?: boolean;
}): string {
  const fulfilled = sqlShipmentListFulfilledKgCase(
    opts.incotermExpr,
    opts.receiveExpr,
    opts.deliveryExpr,
  );
  const diff = `(${opts.contractQtyExpr}::numeric - (${fulfilled})::numeric)`;
  const body = opts.clampAtZero ? `GREATEST(0, ${diff})` : diff;
  return `CASE
    WHEN ${opts.contractQtyExpr} IS NULL THEN NULL
    WHEN (${fulfilled}) IS NULL THEN NULL
    ELSE ${body}
  END`;
}

/** SELECT list fragment for shipments page qty columns (null-safe). */
export function shipmentListPageQtySelectSql(spAlias = 'sp'): string {
  const contractQtyFallback = shipmentListRowContractQtySql(spAlias);
  const globalOutstanding = `(SELECT SUM(
    CASE
      WHEN c.quantity_ordered IS NULL THEN NULL
      ELSE (${sqlShipmentListOutstandingKgExpr({
        contractQtyExpr: 'c.quantity_ordered',
        incotermExpr: 'c.incoterm',
        receiveExpr: `(SELECT qm.quantity_receive FROM qty_move qm WHERE qm.contract_number = c.contract_id)`,
        deliveryExpr: `(SELECT COALESCE(qm.quantity_delivery_vessel, qm.quantity_delivery_trucking) FROM qty_move qm WHERE qm.contract_number = c.contract_id)`,
        clampAtZero: false,
      })})
    END
  )
  FROM contracts c
  WHERE c.contract_id IS NOT NULL
    AND ${spAlias}.contract_numbers IS NOT NULL
    AND TRIM(${spAlias}.contract_numbers) <> ''
    AND EXISTS (
      SELECT 1
      FROM unnest(regexp_split_to_array(${spAlias}.contract_numbers, E'\\\\s*,\\\\s*')) AS cn
      WHERE TRIM(cn) = TRIM(c.contract_id)
    ))`;

  return `
        COALESCE(sm.contract_qty, ${contractQtyFallback}) AS contract_qty,
        COALESCE(sm.sto_qty, sa.sto_quantity) AS sto_quantity,
        COALESCE(sm.received_qty, sa.quantity_receive) AS quantity_receive,
        COALESCE(sm.delivered_qty, sa.quantity_delivered_sap) AS quantity_delivered_sap,
        sm.planning_qty AS planning_qty,
        sm.outstanding_qty_planning AS outstanding_qty_planning,
        COALESCE(sm.outstanding_qty_actual, ${globalOutstanding}) AS outstanding_quantity`.trim();
}
