/**
 * SAP UAT incoterm matrix — single source of truth for:
 * - Contract import status (GR PO vs GR STO)
 * - Quantity delivery (Trucking vs Vessel)
 * - Outstanding quantity (contract qty − incoterm delivery)
 */

export const INCOTERM_GR_PO_STATUS = ['FRC', 'CIF'] as const;
export const INCOTERM_GR_STO_STATUS = ['LCO', 'FOB'] as const;
export const INCOTERM_QTY_TRUCKING = ['FRC', 'LCO'] as const;
export const INCOTERM_QTY_VESSEL = ['FOB', 'CIF'] as const;

function sqlList(codes: readonly string[]): string {
  return codes.map((c) => `'${c}'`).join(', ');
}

export function normalizeIncotermCode(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase();
}

export function usesGrPoStatus(incoterm: unknown): boolean {
  return (INCOTERM_GR_PO_STATUS as readonly string[]).includes(normalizeIncotermCode(incoterm));
}

export function usesGrStoStatus(incoterm: unknown): boolean {
  return (INCOTERM_GR_STO_STATUS as readonly string[]).includes(normalizeIncotermCode(incoterm));
}

export function usesTruckingQuantityDelivery(incoterm: unknown): boolean {
  return (INCOTERM_QTY_TRUCKING as readonly string[]).includes(normalizeIncotermCode(incoterm));
}

export function usesVesselQuantityDelivery(incoterm: unknown): boolean {
  return (INCOTERM_QTY_VESSEL as readonly string[]).includes(normalizeIncotermCode(incoterm));
}

/** Parse SAP numeric text/JSON field to numeric SQL expression. */
export function sqlParseSapNumeric(coalesceExpr: string): string {
  return `CAST(REPLACE(REPLACE(COALESCE(${coalesceExpr}), ',', ''), ' ', '') AS NUMERIC)`;
}

/** Quantity Delivery Trucking from sap_processed_data row. */
export function sqlSapQtyTruckingFromSpd(spdAlias = 'spd'): string {
  return sqlParseSapNumeric(`
    ${spdAlias}.data->'raw'->>'Quantity Delivery Trucking',
    ${spdAlias}.data->'raw'->>'Quantity Delivered Trucking',
    ${spdAlias}.data->'raw'->>'Quantity Delivered via Trucking',
    ${spdAlias}.data->>'quantity_delivered_via_trucking',
    ${spdAlias}.data->'shipment'->>'quantity_delivery_trucking',
    ${spdAlias}.data->'contract'->>'quantity_delivery_trucking'
  `);
}

/** Quantity Delivery Vessel from sap_processed_data row. */
export function sqlSapQtyVesselFromSpd(spdAlias = 'spd'): string {
  return sqlParseSapNumeric(`
    ${spdAlias}.data->'raw'->>'Quantity Delivery Vessel',
    ${spdAlias}.data->'raw'->>'Quantity Delivered',
    ${spdAlias}.data->'raw'->>'Quantity Delivery',
    ${spdAlias}.data->'shipment'->>'quantity_delivery',
    ${spdAlias}.data->'contract'->>'quantity_delivery'
  `);
}

/**
 * GR PO / GR STO status fields from SAP JSON.
 * Prefer raw Excel columns over normalized `contract.*` — stale Close in contract JSON
 * used to win over Open in raw and force Trucking list onto Σ SAP instead of WB.
 */
export function sqlSapGrPoStatusFromJson(spdDataExpr: string): string {
  return `NULLIF(TRIM(COALESCE(
    ${spdDataExpr}->'raw'->>'GR PO Status',
    ${spdDataExpr}->'raw'->>'Status',
    ${spdDataExpr}->'contract'->>'status',
    ${spdDataExpr}->>'status'
  )), '')`;
}

export function sqlSapGrStoStatusFromJson(spdDataExpr: string): string {
  return `NULLIF(TRIM(COALESCE(
    ${spdDataExpr}->'raw'->>'GR STO Status',
    ${spdDataExpr}->'contract'->>'gr_sto_status',
    ${spdDataExpr}->>'gr_sto_status'
  )), '')`;
}

/** Incoterm-based import status from latest SAP JSON + contracts.incoterm. */
export function sqlIncotermImportStatusFromJson(
  spdDataExpr: string,
  incotermExpr: string,
  fallbackExpr?: string,
): string {
  const inc = `UPPER(TRIM(COALESCE(${incotermExpr}, '')))`;
  const fb = fallbackExpr ?? 'NULL';
  return `CASE
    WHEN ${inc} IN (${sqlList(INCOTERM_GR_PO_STATUS)}) THEN COALESCE(${sqlSapGrPoStatusFromJson(spdDataExpr)}, ${fb})
    WHEN ${inc} IN (${sqlList(INCOTERM_GR_STO_STATUS)}) THEN COALESCE(${sqlSapGrStoStatusFromJson(spdDataExpr)}, ${fb})
    ELSE COALESCE(${sqlSapGrPoStatusFromJson(spdDataExpr)}, ${sqlSapGrStoStatusFromJson(spdDataExpr)}, ${fb})
  END`;
}

/** Resolved transport mode (LAND / SEA / MIX) from contracts + latest SAP JSON. */
export function sqlTransportModeFromContractAndJson(
  transportModeCol: string,
  spdDataExpr: string,
): string {
  return `UPPER(TRIM(COALESCE(
    NULLIF(TRIM(${transportModeCol}), ''),
    ${spdDataExpr}->'contract'->>'transport_mode',
    ${spdDataExpr}->'contract'->>'sea_land',
    ${spdDataExpr}->'raw'->>'Sea / Land',
    ${spdDataExpr}->'raw'->>'Sea_Land',
    ''
  )))`;
}

/**
 * SAP UAT quantity delivery matrix (transport + incoterm).
 * MIX: trucking sum covers STO Type T legs, vessel sum covers STO Type V legs.
 */
export function sqlUatQuantityDeliveryCase(opts: {
  incotermExpr: string;
  transportExpr: string;
  truckingQtyExpr: string;
  vesselQtyExpr: string;
}): string {
  const inc = `UPPER(TRIM(COALESCE(${opts.incotermExpr}, '')))`;
  const tm = `UPPER(TRIM(COALESCE(${opts.transportExpr}, '')))`;
  const trucking = `COALESCE(${opts.truckingQtyExpr}, 0)`;
  const vessel = `COALESCE(${opts.vesselQtyExpr}, 0)`;
  return `CASE
    WHEN ${inc} IN (${sqlList(INCOTERM_QTY_TRUCKING)}) AND ${tm} IN ('LAND', '') THEN ${trucking}
    WHEN ${inc} IN (${sqlList(INCOTERM_QTY_TRUCKING)}) THEN ${trucking}
    WHEN ${inc} IN (${sqlList(INCOTERM_QTY_VESSEL)}) AND ${tm} = 'SEA' THEN ${vessel}
    WHEN ${inc} IN (${sqlList(INCOTERM_QTY_VESSEL)}) AND ${tm} = 'MIX' THEN (${trucking} + ${vessel})
    WHEN ${inc} IN (${sqlList(INCOTERM_QTY_VESSEL)}) AND ${tm} = 'LAND' THEN ${vessel}
    WHEN ${inc} IN (${sqlList(INCOTERM_QTY_VESSEL)}) THEN ${vessel}
    ELSE COALESCE(NULLIF(${opts.vesselQtyExpr}, 0), NULLIF(${opts.truckingQtyExpr}, 0), 0)
  END`;
}

/** Step A — quantity delivery by incoterm; pass transportExpr for full UAT matrix. */
export function sqlIncotermQuantityDeliveryCase(
  incotermExpr: string,
  truckingQtyExpr: string,
  vesselQtyExpr: string,
  transportExpr?: string,
): string {
  if (transportExpr) {
    return sqlUatQuantityDeliveryCase({
      incotermExpr,
      transportExpr,
      truckingQtyExpr,
      vesselQtyExpr,
    });
  }
  const inc = `UPPER(TRIM(COALESCE(${incotermExpr}, '')))`;
  return `CASE
    WHEN ${inc} IN (${sqlList(INCOTERM_QTY_TRUCKING)}) THEN COALESCE(${truckingQtyExpr}, 0)
    WHEN ${inc} IN (${sqlList(INCOTERM_QTY_VESSEL)}) THEN COALESCE(${vesselQtyExpr}, 0)
    ELSE COALESCE(NULLIF(${vesselQtyExpr}, 0), NULLIF(${truckingQtyExpr}, 0), 0)
  END`;
}

/**
 * Actual delivered/received qty (kg) subtracted from contract qty for outstanding.
 * FRC/CIF/CFR → Quantity Receive; LCO/FOB → Quantity Delivery; others → receive or delivery (no STO fallback).
 */
export function sqlContractActualQtySubtractedCase(opts: {
  incotermExpr: string;
  receiveExpr: string;
  deliveryExpr: string;
}): string {
  const inc = `UPPER(TRIM(COALESCE(${opts.incotermExpr}, '')))`;
  return `COALESCE(
    CASE
      WHEN ${inc} IN ('FRC', 'CIF', 'CFR') THEN ${opts.receiveExpr}
      WHEN ${inc} IN ('LCO', 'FOB') THEN ${opts.deliveryExpr}
      ELSE COALESCE(NULLIF(${opts.receiveExpr}, 0), ${opts.deliveryExpr})
    END,
    0
  )`;
}

/** PO fulfilled kg — Shipments / Shipping Performance / Contracts (FRC/CIF/CFR receive; LCO/FOB delivery). */
export function sqlPoFulfilledKgCase(
  incotermExpr: string,
  receiveExpr: string,
  deliveryExpr: string,
): string {
  return sqlContractActualQtySubtractedCase({ incotermExpr, receiveExpr, deliveryExpr });
}

/**
 * Signed outstanding (kg): contract qty − PO fulfilled SAP qty.
 * Positive = sisa belum terkirim/terima; negative = over-delivery (tampil + hijau di UI).
 */
export function sqlContractOutstandingSignedExpr(opts: {
  contractQtyExpr: string;
  incotermExpr: string;
  receiveExpr: string;
  deliveryExpr: string;
}): string {
  return sqlContractOutstandingFromFields({ ...opts, clampAtZero: false });
}

/** TypeScript mirror of {@link sqlContractActualQtySubtractedCase}. */
export function resolveContractActualQtySubtractedTs(
  incoterm: unknown,
  receiveQty: unknown,
  deliveryQty: unknown,
): number {
  const inc = String(incoterm ?? '').trim().toUpperCase();
  const receive = Number(receiveQty) || 0;
  const delivery = Number(deliveryQty) || 0;
  if (['FRC', 'CIF', 'CFR'].includes(inc)) return receive;
  if (['LCO', 'FOB'].includes(inc)) return delivery;
  return receive || delivery;
}

/**
 * Contract-level outstanding (kg) for Contracts / Contract Performance list.
 * Uses actual receive/delivery only (no STO quantity fallback when actual is 0).
 * Allows negative values (over delivery) unless clampAtZero is true.
 */
export function sqlContractOutstandingFromFields(opts: {
  contractQtyExpr: string;
  incotermExpr: string;
  receiveExpr: string;
  deliveryExpr: string;
  clampAtZero?: boolean;
}): string {
  const subtracted = sqlContractActualQtySubtractedCase({
    incotermExpr: opts.incotermExpr,
    receiveExpr: opts.receiveExpr,
    deliveryExpr: opts.deliveryExpr,
  });
  const diff = `(COALESCE(${opts.contractQtyExpr}, 0)::numeric - ${subtracted}::numeric)`;
  return opts.clampAtZero ? `GREATEST(0, ${diff})` : diff;
}

/** Step B — outstanding = contract qty − incoterm delivery (Step A). */
export function sqlIncotermOutstandingCase(opts: {
  contractQtyExpr: string;
  incotermExpr: string;
  truckingQtyExpr: string;
  vesselQtyExpr: string;
  transportExpr?: string;
}): string {
  const delivery = sqlIncotermQuantityDeliveryCase(
    opts.incotermExpr,
    opts.truckingQtyExpr,
    opts.vesselQtyExpr,
    opts.transportExpr,
  );
  return `GREATEST(
    0,
    COALESCE(${opts.contractQtyExpr}, 0)::numeric
    - COALESCE((${delivery}), 0)::numeric
  )`;
}

/** qty_move subquery delivery for a contract number expression. */
export function sqlQtyMoveIncotermDelivery(
  incotermExpr: string,
  contractNumberExpr: string,
  transportExpr?: string,
): string {
  const transport =
    transportExpr ??
    `(SELECT ${sqlTransportModeFromContractAndJson('c.transport_mode', 'spd.data')}
      FROM contracts c
      LEFT JOIN LATERAL (
        SELECT spd.data FROM sap_processed_data spd
        WHERE spd.contract_number = c.contract_id
        ORDER BY spd.created_at DESC NULLS LAST LIMIT 1
      ) spd ON true
      WHERE c.contract_id = ${contractNumberExpr}
      LIMIT 1)`;
  return sqlIncotermQuantityDeliveryCase(
    incotermExpr,
    `(SELECT qm.quantity_delivery_trucking FROM qty_move qm WHERE qm.contract_number = ${contractNumberExpr})`,
    `(SELECT qm.quantity_delivery_vessel FROM qty_move qm WHERE qm.contract_number = ${contractNumberExpr})`,
    transport,
  );
}

export function resolveUatQuantityDeliveryTs(
  incoterm: unknown,
  transport: unknown,
  truckingQty: unknown,
  vesselQty: unknown,
): number {
  const inc = normalizeIncotermCode(incoterm);
  const tm = normalizeIncotermCode(transport);
  const trucking = Number(truckingQty) || 0;
  const vessel = Number(vesselQty) || 0;
  if ((INCOTERM_QTY_TRUCKING as readonly string[]).includes(inc)) {
    if (tm === 'LAND' || tm === '') return trucking;
    return trucking;
  }
  if ((INCOTERM_QTY_VESSEL as readonly string[]).includes(inc)) {
    if (tm === 'SEA') return vessel;
    if (tm === 'MIX') return trucking + vessel;
    if (tm === 'LAND') return vessel;
    return vessel;
  }
  return vessel || trucking || 0;
}

export function resolveIncotermQuantityDeliveryTs(
  incoterm: unknown,
  truckingQty: unknown,
  vesselQty: unknown,
): number {
  return resolveUatQuantityDeliveryTs(incoterm, '', truckingQty, vesselQty);
}

export function resolveIncotermOutstandingTs(
  contractQty: unknown,
  incoterm: unknown,
  truckingQty: unknown,
  vesselQty: unknown,
): number {
  const ordered = Number(contractQty) || 0;
  const delivered = resolveIncotermQuantityDeliveryTs(incoterm, truckingQty, vesselQty);
  return Math.max(0, ordered - delivered);
}

export function resolveIncotermImportStatusTs(
  incoterm: unknown,
  grPoStatus: unknown,
  grStoStatus: unknown,
  fallback?: unknown,
): string {
  const fb = String(fallback ?? '').trim();
  if (usesGrPoStatus(incoterm)) return String(grPoStatus ?? fb).trim();
  if (usesGrStoStatus(incoterm)) return String(grStoStatus ?? fb).trim();
  return String(grPoStatus ?? grStoStatus ?? fb).trim();
}
