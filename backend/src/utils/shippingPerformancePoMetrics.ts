/**
 * TypeScript mirror of Shipping Performance PO / STO qty rollups (tests + merge fallback).
 */

export function isShippingPerfB2bChildRow(row: Record<string, unknown>): boolean {
  const b2b = String(row.b2b_flag ?? row.contract_type ?? '').trim().toUpperCase();
  const refPo = String(row.contract_reference_po ?? '').trim();
  return b2b === 'B2B' && refPo.length > 0;
}

export function resolvePoFulfilledKg(
  incoterm: unknown,
  receiveKg: unknown,
  deliveryKg: unknown,
): number {
  const inc = String(incoterm ?? '').trim().toUpperCase();
  const receive = Number(receiveKg) || 0;
  const delivery = Number(deliveryKg) || 0;
  if (['FRC', 'CIF', 'CFR'].includes(inc)) return receive;
  if (['LCO', 'FOB'].includes(inc)) return delivery;
  return receive || delivery;
}

export interface ShippingPerfPoLine {
  contractId: string;
  poNumber: string;
  contractQty: number;
  receiveKg: number;
  deliveryKg: number;
  stoQtyKg: number;
  planningKg: number;
  incoterm: string;
}

export function poOutstandingActualKg(line: ShippingPerfPoLine): number {
  const fulfilled = resolvePoFulfilledKg(line.incoterm, line.receiveKg, line.deliveryKg);
  return Math.max(line.contractQty - fulfilled, 0);
}

/** STO-level outstanding: sum(contract qty) − sum(fulfilled), floor 0 — over-delivery on one PO offsets another. */
export function stoAggregateOutstandingActualKg(lines: readonly ShippingPerfPoLine[]): number {
  let contractQty = 0;
  let fulfilledKg = 0;
  for (const line of lines) {
    contractQty += line.contractQty;
    fulfilledKg += resolvePoFulfilledKg(line.incoterm, line.receiveKg, line.deliveryKg);
  }
  return Math.max(contractQty - fulfilledKg, 0);
}

export function poOutstandingPlanningKg(line: ShippingPerfPoLine): number {
  return Math.max(line.contractQty - line.stoQtyKg - line.planningKg, 0);
}

/**
 * STO-level planning outstanding: sum(contract) − sum(SAP STO qty) − sum(KLIP shipment planning), floor 0.
 * SAP STO Qty = planning via SAP; KLIP planning = daily deliverables on shipments/trucking.
 */
export function stoAggregateOutstandingPlanningKg(lines: readonly ShippingPerfPoLine[]): number {
  let contractQty = 0;
  let stoQtyKg = 0;
  let planningKg = 0;
  for (const line of lines) {
    contractQty += line.contractQty;
    stoQtyKg += line.stoQtyKg;
    planningKg += line.planningKg;
  }
  return Math.max(contractQty - stoQtyKg - planningKg, 0);
}

export function aggregateShippingPerfPoLines(lines: ShippingPerfPoLine[]): {
  contractQty: number;
  stoQty: number;
  receivedQty: number;
  deliveredQty: number;
  planningQty: number;
  outstandingQtyActual: number;
  outstandingQtyPlanning: number;
} {
  let contractQty = 0;
  let stoQty = 0;
  let receivedQty = 0;
  let deliveredQty = 0;
  let planningQty = 0;

  for (const line of lines) {
    contractQty += line.contractQty;
    stoQty += line.stoQtyKg;
    receivedQty += line.receiveKg;
    deliveredQty += line.deliveryKg;
    planningQty += line.planningKg;
  }

  const outstandingQtyActual = stoAggregateOutstandingActualKg(lines);
  const outstandingQtyPlanning = stoAggregateOutstandingPlanningKg(lines);

  return {
    contractQty,
    stoQty,
    receivedQty,
    deliveredQty,
    planningQty,
    outstandingQtyActual,
    outstandingQtyPlanning,
  };
}

export function rowToPoLine(row: Record<string, unknown>): ShippingPerfPoLine | null {
  const contractId = String(row.contract_number ?? '').trim().split(',')[0]?.trim() ?? '';
  if (!contractId) return null;
  return {
    contractId,
    poNumber: String(row.po_number ?? '').trim(),
    contractQty: Number(row.contract_qty ?? 0),
    receiveKg: Number(row.sap_receive_qty ?? row.received_qty ?? 0),
    deliveryKg: Number(row.sap_delivery_qty ?? row.delivered_qty ?? 0),
    stoQtyKg: Number(row.po_sto_qty ?? row.sto_qty ?? 0),
    planningKg: Number(row.planning_qty ?? 0),
    incoterm: String(row.incoterm ?? ''),
  };
}

/** Merge fallback when sto_metrics join is absent (unit tests). */
export function mergePoMetricsFromRows(rows: Record<string, unknown>[]): {
  contractQty: number;
  stoQty: number;
  receivedQty: number;
  deliveredQty: number;
  planningQty: number;
  outstandingQtyActual: number;
  outstandingQtyPlanning: number;
} {
  const byContract = new Map<string, ShippingPerfPoLine>();
  for (const row of rows) {
    if (isShippingPerfB2bChildRow(row)) continue;
    const line = rowToPoLine(row);
    if (!line) continue;
    byContract.set(line.contractId, line);
  }
  return aggregateShippingPerfPoLines([...byContract.values()]);
}
