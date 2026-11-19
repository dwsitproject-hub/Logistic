/**
 * B2B chains in the Edit / View Shipment PO table: the PARENT (origin) PO is shown, the CHILD never is.
 *
 * SAP books a chain's STO on the CHILD only (measured 2026-11-19 on 455 closed pairs: Delivery on the child in 226, on the origin in 0, on both in 0; the origin never carries
 * the STO), and the only shipment row is the child's. KLIP knows the chain by its PARENT (the Shipments list shows the origin in place of the child). The PO table query hides the
 * child and lists the origin only when something else links the origin to the STO, so for an STO whose only SAP carrier is the child (production STO 1006021152, origin 9144101942,
 * child 1004033142) it came back EMPTY, and the modal then built one row from each contract number it had (parent from the list, child from the shipment): two rows for one cargo,
 * both editable, and two typed quantities fought for the one shipment.
 *
 * Here the rows are put right after the query: for every live shipment in the group whose contract is a B2B child, the PARENT row is listed (made from the contract when the query
 * did not return it) carrying the child's KLIP quantities, and a row of the child is dropped. Saving a quantity on the parent row lands on the child's shipment
 * (shipmentPoAssignment.service.ts batchSaveShipmentPoKlipQty, b2bChildShipmentsForOrigins).
 */
import { query } from '../database/connection';
import { sqlSiblingShipmentGroupMatchSql } from '../utils/contractDetailsForStoSql';

export interface B2bChain {
  /** The shipment row of the chain (the child's). */
  shipmentId: string;
  child: string;
  origin: string;
  originPo: string;
  originSupplier: string;
  originProduct: string;
  /** contracts.quantity_ordered of the origin, kg. */
  originQtyKg: number | null;
  originIncoterm: string;
  /** The KLIP quantities saved on the child's shipment, kg. */
  deliveredKlipKg: number | null;
  receiveKlipKg: number | null;
  planKg: number | null;
}

type Row = Record<string, unknown>;

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const text = (v: unknown): string => String(v ?? '').trim();

/** The live shipments of the group whose contract is a B2B child, with the parent each belongs to. */
export async function loadB2bChainsForGroup(lookupKey: string, anchorShipmentUuid: string): Promise<B2bChain[]> {
  if (!lookupKey) return [];
  const groupMatch = sqlSiblingShipmentGroupMatchSql({
    lookupKeySql: '$1::text',
    contractNumberSql: 'c.contract_id',
    anchorShipmentIdSql: '$2::uuid',
  });
  const res = await query(
    `
    SELECT s.id::text AS shipment_id, c.contract_id AS child,
           oc.contract_id AS origin, NULLIF(TRIM(oc.po_number::text), '') AS origin_po,
           oc.supplier AS origin_supplier, oc.product AS origin_product, oc.quantity_ordered AS origin_qty, oc.incoterm AS origin_incoterm,
           s.quantity_delivered_klip, s.actual_vessel_qty_receive, s.quantity_shipment_plan
      FROM shipments s
      INNER JOIN contracts c ON c.id = s.contract_id
      INNER JOIN contract_latest_spd_snapshot chb
              ON chb.contract_number = c.contract_id
             AND UPPER(COALESCE(chb.b2b_flag_raw, '')) = 'B2B'
             AND NULLIF(TRIM(chb.contract_reference_po_raw), '') IS NOT NULL
      INNER JOIN contracts oc
              ON TRIM(oc.po_number::text) = TRIM(chb.contract_reference_po_raw) AND oc.contract_id <> c.contract_id
     WHERE COALESCE(s.status, '') <> 'CANCELLED'
       AND (
         ${groupMatch}
       )
     ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC NULLS LAST
    `,
    [lookupKey, anchorShipmentUuid],
  );
  return (res.rows as Row[]).map((r) => ({
    shipmentId: text(r.shipment_id),
    child: text(r.child),
    origin: text(r.origin),
    originPo: text(r.origin_po),
    originSupplier: text(r.origin_supplier),
    originProduct: text(r.origin_product),
    originQtyKg: num(r.origin_qty),
    originIncoterm: text(r.origin_incoterm),
    deliveredKlipKg: num(r.quantity_delivered_klip),
    receiveKlipKg: num(r.actual_vessel_qty_receive),
    planKg: num(r.quantity_shipment_plan),
  }));
}

/**
 * The PO table rows with every chain shown as its PARENT. Pure: it takes the rows the query returned and the chains, and returns the rows to send.
 *  - a row of a CHILD is dropped (the query already hides them; this keeps the rule in one place);
 *  - the parent's row is added when missing, made from the contract, with the child's KLIP quantities;
 *  - a parent row that exists but has no KLIP quantity of its own takes the child's (one shipment, one figure);
 *  - a parent with several child shipments in the group keeps what its row has: which child a figure belongs to is not known.
 */
export function applyB2bChainsToDetails(details: Row[], chains: B2bChain[]): Row[] {
  if (chains.length === 0) return details;
  const children = new Set(chains.map((c) => c.child));
  const byOrigin = new Map<string, B2bChain[]>();
  for (const chain of chains) byOrigin.set(chain.origin, [...(byOrigin.get(chain.origin) ?? []), chain]);

  const rows: Row[] = details.filter((d) => !children.has(text(d.contract_number)));
  for (const [origin, group] of byOrigin) {
    const single = new Set(group.map((g) => g.shipmentId)).size === 1 ? group[0] : null;
    const existing = rows.find((d) => text(d.contract_number) === origin);
    if (existing) {
      if (single) {
        if (existing.quantity_delivered_klip == null) existing.quantity_delivered_klip = single.deliveredKlipKg;
        if (existing.quantity_receive_klip == null) existing.quantity_receive_klip = single.receiveKlipKg;
        if (existing.quantity_shipment_plan == null) existing.quantity_shipment_plan = single.planKg;
      }
      continue;
    }
    const first = group[0];
    rows.push({
      contract_number: first.origin,
      po_number: first.originPo,
      supplier: first.originSupplier,
      product: first.originProduct,
      contract_qty: first.originQtyKg ?? 0,
      // Nothing delivered yet on SAP's side: the whole contract is outstanding. The modal shows the figure; it is not used to decide anything.
      outstanding_qty_actual: first.originQtyKg ?? 0,
      outstanding_qty: first.originQtyKg ?? 0,
      quantity_delivered: null,
      quantity_receive: null,
      quantity_shipment_plan: single ? single.planKg : null,
      quantity_delivered_klip: single ? single.deliveredKlipKg : null,
      quantity_receive_klip: single ? single.receiveKlipKg : null,
      vessel_oa_budget_sap: null,
      po_sto_count: 1,
      // No contract row id: Revert PO takes a PO out of an operation, and a parent that has no shipment of its own is not one that can be taken out.
      contract_row_id: null,
      revert_block: null,
      incoterm: first.originIncoterm,
    });
  }
  return rows;
}

/** The PO table rows of a group with its B2B chains shown as parents. Never throws: a problem leaves the rows as the query returned them. */
export async function withB2bParentRows(lookupKey: string, anchorShipmentUuid: string, details: Row[]): Promise<Row[]> {
  try {
    return applyB2bChainsToDetails(details, await loadB2bChainsForGroup(lookupKey, anchorShipmentUuid));
  } catch {
    return details;
  }
}
