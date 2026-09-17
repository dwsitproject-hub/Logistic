/**
 * SAP UAT incoterm matrix — single source of truth for:
 * - Contract import status (GR PO vs GR STO)
 * - Quantity delivery (Trucking vs Vessel)
 * - Outstanding quantity (contract qty − incoterm delivery)
 */

import { sqlCoalesceSapRawQtyFields } from './sapQtyPlaceholderSql';
import {
  SAP_FIELD_ARMS,
  sapDataSource,
  sapRowSource,
  sqlSapCoalesceArms,
  sqlSapFields,
  type SapFieldSource,
} from './sapDerivedColumnSql';

export const INCOTERM_GR_PO_STATUS = ['FRC', 'CIF', 'CFR'] as const;
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

/** Parse SAP numeric text/JSON field to numeric SQL expression. Blank Excel cells stay NULL. */
export function sqlParseSapNumeric(coalesceExpr: string): string {
  return `NULLIF(REPLACE(REPLACE(NULLIF(TRIM(COALESCE(${coalesceExpr}, '')), ''), ',', ''), ' ', ''), '')::numeric`;
}

/**
 * Quantity Delivery Trucking / Vessel.
 *
 * These take a *source*, not an alias, and that is not pedantry: `shipmentListSapAggSql` calls
 * them with alias `sk`, which is the `spd_keyed` CTE. It carries `data` but none of migration
 * 162's columns, so an alias that silently meant "read the columns" would have produced SQL
 * naming columns that do not exist. The caller decides, where the FROM clause is known.
 *
 * Arms and their order come from SAP_FIELD_ARMS, shared with every other reader.
 */
function sqlSapQtyTrucking(source: SapFieldSource): string {
  return sqlParseSapNumeric(
    sqlCoalesceSapRawQtyFields(sqlSapFields(source, SAP_FIELD_ARMS.qtyTrucking)),
  );
}

function sqlSapQtyVessel(source: SapFieldSource): string {
  return sqlParseSapNumeric(
    sqlCoalesceSapRawQtyFields(sqlSapFields(source, SAP_FIELD_ARMS.qtyVessel)),
  );
}

/** Trucking quantity off a real sap_processed_data alias - reads the stored columns. */
export function sqlSapQtyTruckingFromSpd(spdAlias = 'spd'): string {
  return sqlSapQtyTrucking(sapRowSource(spdAlias));
}

/** Trucking quantity from anything that only carries `data` (a CTE, a snapshot). */
export function sqlSapQtyTruckingFromData(spdDataExpr: string): string {
  return sqlSapQtyTrucking(sapDataSource(spdDataExpr));
}

/** Vessel quantity off a real sap_processed_data alias. */
export function sqlSapQtyVesselFromSpd(spdAlias = 'spd'): string {
  return sqlSapQtyVessel(sapRowSource(spdAlias));
}

/** Vessel quantity from a `data` expression. */
export function sqlSapQtyVesselFromData(spdDataExpr: string): string {
  return sqlSapQtyVessel(sapDataSource(spdDataExpr));
}

import {
  sqlSpdHasDeletePoFlagExpr,
  sqlSpdHasDeletePoFlagFromRow,
  sqlSpdHasDeleteStoFlagExpr,
  sqlSpdHasDeleteStoFlagFromRow,
} from './sapMasterV2UatFormat';

/**
 * GR PO status fields from SAP JSON — GR PO only (not commercial Status).
 * Generic Status Open on blank-GR rows used to keep import status Open forever
 * and block Shipment Completed when GR PO was already Close.
 * Delete PO Status non-blank → Cancelled (SAP Data v3).
 */
function sqlSapGrPoStatus(source: SapFieldSource): string {
  const gr = `NULLIF(TRIM(COALESCE(
    ${sqlSapCoalesceArms(source, SAP_FIELD_ARMS.grPoStatus)}
  )), '')`;
  const deleted =
    source.kind === 'row'
      ? sqlSpdHasDeletePoFlagFromRow(source.alias)
      : sqlSpdHasDeletePoFlagExpr(source.dataExpr);
  return `CASE
    WHEN ${deleted} THEN 'Cancelled'
    ELSE ${gr}
  END`;
}

export function sqlSapGrPoStatusFromJson(spdDataExpr: string): string {
  return sqlSapGrPoStatus(sapDataSource(spdDataExpr));
}

/**
 * Same value, read from migration 162's stored columns instead of the jsonb blob.
 *
 * Only valid on a real `sap_processed_data` alias. Each jsonb arm re-detoasts the whole `data`
 * value, and this expression appears 36+ times per row inside the Shipments `sto_metrics` CTE.
 */
export function sqlSapGrPoStatusFromRow(alias = 'spd'): string {
  return sqlSapGrPoStatus(sapRowSource(alias));
}

/**
 * GR STO status fields from SAP JSON.
 * Prefer raw Excel columns over normalized `contract.*` — stale Close in contract JSON
 * used to win over Open in raw and force Trucking list onto Σ SAP instead of WB.
 * Delete STO Status non-blank → Cancelled (SAP Data v3).
 */
function sqlSapGrStoStatus(source: SapFieldSource): string {
  const gr = `NULLIF(TRIM(COALESCE(
    ${sqlSapCoalesceArms(source, SAP_FIELD_ARMS.grStoStatus)}
  )), '')`;
  const deleted =
    source.kind === 'row'
      ? sqlSpdHasDeleteStoFlagFromRow(source.alias)
      : sqlSpdHasDeleteStoFlagExpr(source.dataExpr);
  return `CASE
    WHEN ${deleted} THEN 'Cancelled'
    ELSE ${gr}
  END`;
}

export function sqlSapGrStoStatusFromJson(spdDataExpr: string): string {
  return sqlSapGrStoStatus(sapDataSource(spdDataExpr));
}

/** Same value off a sap_processed_data alias - see sqlSapGrPoStatusFromRow. */
export function sqlSapGrStoStatusFromRow(alias = 'spd'): string {
  return sqlSapGrStoStatus(sapRowSource(alias));
}

/** Incoterm-based import status from latest SAP JSON + contracts.incoterm. */
function sqlIncotermImportStatus(
  source: SapFieldSource,
  incotermExpr: string,
  fallbackExpr?: string,
): string {
  const inc = `UPPER(TRIM(COALESCE(${incotermExpr}, '')))`;
  const fb = fallbackExpr ?? 'NULL';
  const grPo = sqlSapGrPoStatus(source);
  const grSto = sqlSapGrStoStatus(source);
  return `CASE
    WHEN ${inc} IN (${sqlList(INCOTERM_GR_PO_STATUS)}) THEN COALESCE(${grPo}, ${fb})
    WHEN ${inc} IN (${sqlList(INCOTERM_GR_STO_STATUS)}) THEN COALESCE(${grSto}, ${fb})
    ELSE COALESCE(${grPo}, ${grSto}, ${fb})
  END`;
}

export function sqlIncotermImportStatusFromJson(
  spdDataExpr: string,
  incotermExpr: string,
  fallbackExpr?: string,
): string {
  return sqlIncotermImportStatus(sapDataSource(spdDataExpr), incotermExpr, fallbackExpr);
}

/**
 * Same status off a sap_processed_data alias.
 *
 * This one is worth the most: it renders the GR PO *and* GR STO expressions, so on the jsonb path
 * it is up to six blob accesses every time it appears - and it appears throughout `sto_metrics`.
 */
export function sqlIncotermImportStatusFromRow(
  alias: string,
  incotermExpr: string,
  fallbackExpr?: string,
): string {
  return sqlIncotermImportStatus(sapRowSource(alias), incotermExpr, fallbackExpr);
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
 * FRC/LCO → trucking. FOB/CIF/CFR → vessel.
 * MIX + FOB/CIF: vessel if present, else trucking (Type T only). Do not add both —
 * trucking on a FOB MIX PO is the land leg of the same cargo (PO-level vessel qty
 * repeated on Type T rows), not a second delivery.
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
  const mixVesselThenTrucking = `COALESCE(NULLIF(${vessel}, 0), ${trucking})`;
  return `CASE
    WHEN ${inc} IN (${sqlList(INCOTERM_QTY_TRUCKING)}) AND ${tm} IN ('LAND', '') THEN ${trucking}
    WHEN ${inc} IN (${sqlList(INCOTERM_QTY_TRUCKING)}) THEN ${trucking}
    WHEN ${inc} IN (${sqlList(INCOTERM_QTY_VESSEL)}) AND ${tm} = 'SEA' THEN ${vessel}
    WHEN ${inc} IN (${sqlList(INCOTERM_QTY_VESSEL)}) AND ${tm} = 'MIX' THEN ${mixVesselThenTrucking}
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

/**
 * qty_move join delivery for LCO/FOB outstanding.
 * Use trucking vs vessel by incoterm — not `qm.quantity_delivery`
 * (vessel-first COALESCE), which hides a larger trucking total when any STO
 * has generic SAP "Quantity Delivery" parsed as vessel.
 */
export function sqlQtyMoveJoinIncotermDelivery(
  incotermExpr: string,
  qmAlias = 'qm',
  transportExpr?: string,
): string {
  return sqlIncotermQuantityDeliveryCase(
    incotermExpr,
    `${qmAlias}.quantity_delivery_trucking`,
    `${qmAlias}.quantity_delivery_vessel`,
    transportExpr,
  );
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
    if (tm === 'MIX') return vessel || trucking;
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
