/**
 * Read-only: every way KLIP links POs to one STO, to explain a Shipments row whose Contract Qty sums more POs than SAP lists.
 *
 *   git show origin/main:docs/scripts/diag-sto-po-links.cjs | docker exec -i klip-backend node - 1006019951
 *
 * Prints the SAP rows, contract_stos edges, contracts.sto_number, the shipment rows of every PO found, and the audit log of those
 * shipments/contracts (who linked what, when). Writes nothing.
 */
const path = require('path');
const pool = require(path.join(process.cwd(), 'dist', 'database', 'connection')).default;
const sto = String(process.argv[2] || '').trim();
if (!/^\d+$/.test(sto)) {
  console.error('usage: ... | docker exec -i klip-backend node - <STO number>');
  process.exit(1);
}
const show = async (label, sql, params) => {
  try {
    const r = await pool.query(sql, params);
    console.log(`\n== ${label} (${r.rows.length})`);
    if (r.rows.length) console.table(r.rows);
    return r.rows;
  } catch (e) {
    console.log(`\n== ${label}: ERROR ${e.message}`);
    return [];
  }
};
(async () => {
  const sap = await show(
    'SAP rows with this STO',
    `SELECT po_number, contract_number, sto_number, created_at::date AS imported, superseded_at::date AS superseded,
            data->'contract'->>'contract_quantity' AS contract_qty, data->'contract'->>'sto_quantity' AS sto_qty,
            raw_quantity_delivery_vessel AS deliv_vessel, raw_quantity_receive AS receive
       FROM sap_processed_data WHERE sto_number = $1 ORDER BY po_number, created_at`,
    [sto],
  );
  const edges = await show(
    'contract_stos edges',
    `SELECT c.po_number, c.contract_id, c.supplier, c.plant_code, c.quantity_ordered, cs.sto_quantity, cs.created_at
       FROM contract_stos cs JOIN contracts c ON c.id = cs.contract_id WHERE cs.sto_number = $1 ORDER BY c.po_number`,
    [sto],
  );
  const direct = await show(
    'contracts.sto_number = STO',
    `SELECT po_number, contract_id, supplier, plant_code, quantity_ordered, source_type, sap_presence, created_at
       FROM contracts WHERE sto_number = $1 ORDER BY po_number`,
    [sto],
  );
  const pos = [...new Set([...sap, ...edges, ...direct].map((r) => r.po_number).filter(Boolean))];
  const ships = await show(
    'shipment rows of those POs (and rows whose operation is shared with them)',
    `WITH base AS (SELECT s.* FROM shipments s JOIN contracts c ON c.id = s.contract_id WHERE c.po_number = ANY($1::text[]))
     SELECT s.id, s.shipment_id, s.operation_id, c.po_number, c.sto_number AS contract_sto, s.vessel_name, s.status,
            s.quantity_delivered, s.quantity_delivered_klip, s.actual_vessel_qty_receive, s.created_at, s.klip_edited_fields
       FROM shipments s JOIN contracts c ON c.id = s.contract_id
      WHERE s.id IN (SELECT id FROM base) OR s.operation_id IN (SELECT operation_id FROM base WHERE operation_id IS NOT NULL)
      ORDER BY s.operation_id, c.po_number`,
    [pos],
  );
  const ids = [...new Set([...ships.map((s) => String(s.id)), ...edges.map(() => null)].filter(Boolean))];
  const contractIds = (await pool.query(`SELECT id::text FROM contracts WHERE po_number = ANY($1::text[])`, [pos])).rows.map((r) => r.id);
  await show(
    'audit log of those shipments / contracts',
    `SELECT a.timestamp, a.action, a.entity_type, a.entity_id, u.email,
            left(COALESCE(a.after_data::text, ''), 160) AS after_data
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.entity_id::text = ANY($1::text[]) ORDER BY a.timestamp`,
    [[...ids, ...contractIds]],
  );
  console.log(`\nPOs found for STO ${sto}: ${pos.join(', ') || '(none)'}`);
  await pool.end();
})().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
