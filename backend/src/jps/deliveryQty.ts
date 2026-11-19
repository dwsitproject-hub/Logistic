/**
 * The KLIP Delivery Qty of each PO of an STO (shipments.quantity_delivered_klip, kilograms, typed in Edit Shipment), for Submit to Jetty.
 *
 * Two things use it, so they cannot disagree:
 *  - the readiness check behind the Submit to Jetty button: every PO of the STO must have a Delivery Qty before the instruction is sent;
 *  - the email sent after a successful submission: its QTY and the Qty column of its PO table are these figures, NOT the contract or STO quantity.
 *
 * One shipment row belongs to one PO (contract), and an STO can have several; a PO with more than one row (a second voyage) counts the rows together. A cancelled
 * shipment does not count.
 */
import { query } from '../database/connection';
import { STO_KEY_SQL } from './eligibility';
import type { ReadinessCheck } from './readiness';

export interface PoDeliveryRow {
  /** contracts.contract_id */
  contract: string;
  /** contracts.po_number */
  po: string;
  /** Sum of the KLIP Delivery Qty over the PO's shipment rows of this STO, in kg; null when none of them has one. */
  qtyKg: number | null;
}

export async function loadPoDeliveryQty(stoKey: string): Promise<PoDeliveryRow[]> {
  const res = await query(
    `SELECT c.contract_id AS contract,
            COALESCE(NULLIF(TRIM(c.po_number::text), ''), '') AS po,
            SUM(s.quantity_delivered_klip) FILTER (WHERE s.quantity_delivered_klip IS NOT NULL) AS qty_kg
       FROM shipments s
       INNER JOIN contracts c ON c.id = s.contract_id
       LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
      WHERE ${STO_KEY_SQL} = $1
        AND UPPER(COALESCE(s.status, '')) <> 'CANCELLED'
      GROUP BY c.contract_id, c.po_number
      ORDER BY c.contract_id`,
    [stoKey],
  );
  return (res.rows as Array<{ contract: string; po: string; qty_kg: string | number | null }>).map((r) => ({
    contract: String(r.contract),
    po: String(r.po),
    qtyKg: r.qty_kg == null ? null : Number(r.qty_kg),
  }));
}

/** A PO has a Delivery Qty when it is above zero: 0 is what an untouched field holds. */
export function hasDeliveryQty(row: PoDeliveryRow): boolean {
  return row.qtyKg != null && Number.isFinite(row.qtyKg) && row.qtyKg > 0;
}

function formatKg(kg: number): string {
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(kg)} kg`;
}

/** The readiness check: every PO of the STO has a Delivery Qty. With no PO row at all there is nothing to judge (another check says the shipment is missing). */
export function deliveryQtyCheck(rows: PoDeliveryRow[]): ReadinessCheck | null {
  if (rows.length === 0) return null;
  const missing = rows.filter((r) => !hasDeliveryQty(r));
  const ok = missing.length === 0;
  const total = rows.reduce((sum, r) => sum + (hasDeliveryQty(r) ? (r.qtyKg as number) : 0), 0);
  return {
    key: 'delivery_qty',
    label: 'Delivery Qty (Klip) is filled for every PO',
    ok,
    value: ok
      ? `${rows.length} PO, total ${formatKg(total)}`
      : `missing on ${missing.length} of ${rows.length} PO: ${missing.map((r) => r.po || r.contract).join(', ')}`,
    fix: 'Fill Delivery Qty (Klip) of each PO in Edit Shipment (section 2. Shipment Detail) and save. This quantity is the one written in the email sent after Submit to Jetty.',
    fixAt: 'shipment',
  };
}
