/*
 * READ-ONLY: why does PUT /shipments/:id/po-klip-qty answer 400 "No sibling shipment found for contract X under this STO / operation"?
 *
 *   cd /opt/klip && cat docs/scripts/diag-edit-shipment-po-klip-qty.cjs | docker exec -i klip-backend node - --shipment=<anchor shipment uuid>
 *
 * Edit Shipment saves Delivered / Received / Shipment Plan Qty per PO. The API writes each PO's number onto that contract's own shipment row inside the
 * STO / operation group and refuses when it finds none (a CANCELLED shipment does not count). This resolves the group the way the API does, lists EVERY
 * shipment that carries the group key (any contract, any status), and for each contract involved says whether the sibling lookup finds a row.
 */
const path = require('path');
const fs = require('fs');
const DIST = ['/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].find((p) => fs.existsSync(p));
if (!DIST) {
  console.error('no backend build found');
  process.exit(1);
}
const load = (m) => require(path.join(DIST, m));
const connection = load('database/connection');
const { resolveShipmentEditContext } = load('services/shipmentEditContext.service');
const { sqlSiblingShipmentGroupMatchSql } = load('utils/contractDetailsForStoSql');

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : '';
};
const day = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '-');
const list = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim()).filter(Boolean);

(async () => {
  const anchor = arg('shipment');
  if (!anchor) throw new Error('--shipment=<uuid> is required');
  const ctx = await resolveShipmentEditContext(anchor);
  console.log('context          :', JSON.stringify(ctx));
  if (!ctx || !ctx.lookup_key) return;
  const key = ctx.lookup_key;

  const a = await connection.query(
    `SELECT s.id::text AS id, c.contract_id, c.po_number, s.status, s.shipment_id, s.operation_id, s.vessel_name FROM shipments s LEFT JOIN contracts c ON c.id = s.contract_id WHERE s.id = $1::uuid`,
    [anchor],
  );
  console.log('anchor shipment  :', JSON.stringify(a.rows[0]));

  const group = await connection.query(
    `SELECT s.id::text AS id, c.contract_id, c.po_number, s.status, s.shipment_id, s.operation_id, s.vessel_name, s.quantity_delivered_klip, s.quantity_shipment_plan, s.updated_at
     FROM shipments s LEFT JOIN contracts c ON c.id = s.contract_id
     WHERE TRIM(COALESCE(s.operation_id::text, '')) = TRIM($1) OR TRIM(COALESCE(s.shipment_id::text, '')) = TRIM($1) OR TRIM(COALESCE(s.shipment_id::text, '')) LIKE TRIM($1) || '-%'
     ORDER BY c.contract_id, s.created_at`,
    [key],
  );
  console.log('\nEvery shipment carrying the key ' + key + ':');
  for (const s of group.rows) {
    console.log('   ' + String(s.contract_id).padEnd(12) + String(s.status).padEnd(11) + ' shipment_id=' + s.shipment_id + '  operation_id=' + (s.operation_id || '-') + '  vessel=' + (s.vessel_name || '-') +
      '  delivered_klip=' + (s.quantity_delivered_klip ?? '-') + '  plan=' + (s.quantity_shipment_plan ?? '-') + '  updated=' + day(s.updated_at) + '  ' + s.id);
  }

  const contracts = [...new Set([...list(ctx.contract_numbers), ...group.rows.map((r) => String(r.contract_id || '').trim()).filter(Boolean)])];
  const groupMatch = sqlSiblingShipmentGroupMatchSql({ lookupKeySql: '$2::text', contractNumberSql: '$1::text', anchorShipmentIdSql: '$3::uuid' });
  console.log('\nSibling lookup per contract (what the API does):');
  for (const contract of contracts) {
    const sib = await connection.query(
      `SELECT s.id::text AS id FROM shipments s INNER JOIN contracts c ON c.id = s.contract_id
       WHERE COALESCE(s.status, '') <> 'CANCELLED' AND TRIM(c.contract_id) = TRIM($1::text) AND (${groupMatch})
       ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC NULLS LAST LIMIT 1`,
      [contract, key, anchor],
    );
    console.log('   ' + contract.padEnd(12) + (sib.rows[0] ? 'FOUND ' + sib.rows[0].id : '*** NOT FOUND -> the 400 for this contract ***'));
  }
})()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Failed:', e && e.message ? e.message : e);
    process.exit(1);
  });
