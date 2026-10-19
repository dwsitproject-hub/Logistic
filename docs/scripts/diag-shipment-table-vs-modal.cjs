/*
 * READ-ONLY: why does the Shipments View Table row differ from the Edit Shipment modal for one operation / STO group?
 *
 *   cd /opt/klip && cat docs/scripts/diag-shipment-table-vs-modal.cjs | docker exec -i klip-backend node - --key=OP-1004031313-76403194
 *
 * The table builds a row in two passes: the fast pass lists the group's POs from the contracts linked to the key (contractsOnStoSubquery), and the
 * SAP hydrate then REPLACES po_numbers with the POs of the SAP rows keyed to the group (po_numbers_agg: sto match, or - for an OP- key - contract
 * match, B2B children excluded). When those two sets differ the PO column changes a moment after the page loads. This prints both sets, the member
 * shipments (status / ATA), and the per-contract flags that decide the status the table derives.
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
const { contractsOnStoSubquery } = load('utils/stoLinkedContractSql');
const { sapStoNumberKeyExpr } = load('utils/shipmentStoTypeSql');
const { sqlB2bChildSpdDataExcludeWhere } = load('utils/b2bChildSql');
const { sqlIsContractSapClosedForStoExpr } = load('utils/contractDeliveryStatus');
const { sqlShipmentListPrimaryOrderBy } = load('utils/shipmentListPrimaryShipmentSql');
const { shipmentListContractOsWithinBandExpr } = load('utils/shipmentListFilters');

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : '';
};
const q = (sql, params) => connection.query(sql, params).then((r) => r.rows);
const day = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '-');

(async () => {
  const key = arg('key');
  if (!key) throw new Error('--key=<operation id or STO key> is required');
  console.log('group key:', key, '\n');

  console.log('1. Member shipments (operation_id or shipment_id = key)');
  const members = await q(
    `SELECT s.id::text AS id, c.contract_id, c.po_number, s.status, s.vessel_name, s.shipment_id, s.operation_id,
            s.ata_arrival, s.ata_loading_complete, s.ata_sailed, s.ata_discharge_complete, s.created_at
       FROM shipments s LEFT JOIN contracts c ON c.id = s.contract_id
      WHERE TRIM(COALESCE(s.operation_id, '')) = $1 OR TRIM(COALESCE(s.shipment_id::text, '')) = $1
      ORDER BY s.created_at`,
    [key],
  );
  for (const m of members) {
    console.log(
      `   ${m.id}  contract=${m.contract_id} po=${m.po_number} status=${m.status} vessel=${m.vessel_name || '-'} ` +
        `ATA arr/loadcomp/sailed/dischcomp=${day(m.ata_arrival)}/${day(m.ata_loading_complete)}/${day(m.ata_sailed)}/${day(m.ata_discharge_complete)} created=${day(m.created_at)}`,
    );
  }
  if (!members.length) console.log('   (none)');

  console.log('\n2. FAST PASS po_numbers - contracts linked to the key (contractsOnStoSubquery)');
  const linked = await q(
    `SELECT c.contract_id, c.po_number, c.status, c.incoterm
       FROM contracts c
      WHERE c.contract_id IN (${contractsOnStoSubquery('$1::text')})
      ORDER BY c.po_number`,
    [key],
  );
  for (const r of linked) console.log(`   contract=${r.contract_id} po=${r.po_number} status=${r.status} incoterm=${r.incoterm}`);
  const fastPos = [...new Set(linked.map((r) => r.po_number).filter(Boolean))].sort();
  console.log('   -> ', fastPos.join(', ') || '(none)');

  console.log('\n3. HYDRATE po_numbers - SAP rows keyed to the group (spd_keyed branch 1: sto match; branch 2: contract match for an OP- key)');
  const linkedContracts = linked.map((r) => r.contract_id);
  const spd = await q(
    `WITH keyed AS (
       SELECT 'sto' AS branch, spd.contract_number, spd.po_number, spd.data
         FROM sap_processed_data spd
        WHERE ${sapStoNumberKeyExpr('spd')} = TRIM($1::text)
       UNION ALL
       SELECT 'contract' AS branch, spd.contract_number, spd.po_number, spd.data
         FROM sap_processed_data spd
        WHERE TRIM(spd.contract_number::text) = ANY($2::text[])
          AND (${sapStoNumberKeyExpr('spd')} = TRIM($1::text)) IS NOT TRUE
          AND (TRIM($1::text) ~ '^OP-' OR ${sapStoNumberKeyExpr('spd')} IS NULL)
     )
     SELECT sk.branch, sk.contract_number,
            NULLIF(TRIM(COALESCE(sk.data->'raw'->>'PO No', sk.data->'raw'->>'PO Number', sk.data->'raw'->>'PO No.', sk.data->'contract'->>'po_number', sk.data->>'PO No')), '') AS po,
            (${sqlB2bChildSpdDataExcludeWhere('sk.data')}) AS kept_after_b2b_exclude,
            sk.data->'raw'->>'STO No.' AS sto_no
       FROM keyed sk
      ORDER BY 3, 1`,
    [key, linkedContracts],
  );
  for (const r of spd) {
    console.log(`   branch=${r.branch} contract=${r.contract_number} po=${r.po} sto=${r.sto_no || '-'} kept=${r.kept_after_b2b_exclude}`);
  }
  const hydratedPos = [...new Set(spd.filter((r) => r.kept_after_b2b_exclude && r.po).map((r) => r.po))].sort();
  console.log('   -> ', hydratedPos.join(', ') || '(none)');

  if (fastPos.some((p) => !hydratedPos.includes(p))) {
    console.log("\n3b. Every SAP row of the PO(s) the hydrate lost, whatever its contract / STO (why were they not keyed to the group?)");
    const lostPos = fastPos.filter((p) => !hydratedPos.includes(p));
    const raw = await q(
      `SELECT spd.id::text AS id, spd.created_at, spd.contract_number, spd.po_number, spd.sto_number,
              spd.data->'raw'->>'Contract No' AS raw_contract_no, spd.data->'raw'->>'STO No.' AS raw_sto,
              spd.data->'raw'->>'Delete PO Status' AS delete_status,
              (${sapStoNumberKeyExpr('spd')}) AS sto_key_expr
         FROM sap_processed_data spd
        WHERE TRIM(COALESCE(spd.po_number, '')) = ANY($1::text[])
           OR TRIM(COALESCE(spd.data->'raw'->>'PO No', '')) = ANY($1::text[])
        ORDER BY spd.created_at DESC LIMIT 20`,
      [lostPos],
    );
    for (const r of raw) {
      console.log(`   spd=${r.id.slice(0, 8)} created=${day(r.created_at)} po=${r.po_number} contract_number=${r.contract_number || '(blank)'} raw_contract_no=${r.raw_contract_no || '(blank)'} sto=${r.sto_key_expr || '-'} delete_status=${r.delete_status || '-'}`);
    }
    if (!raw.length) console.log("   (no SAP row carries this PO at all)");
  }

  const mergedPos = [...new Set([...fastPos, ...hydratedPos])].sort();
  console.log('   -> with the merged rule (contracts + SAP, distinct): ' + mergedPos.join(', '));
  const missing = fastPos.filter((p) => !hydratedPos.includes(p));
  console.log(
    '\n=> PO column: fast pass [' + fastPos.join(', ') + '], hydrate [' + hydratedPos.join(', ') + ']' +
      (missing.length ? `  -> after hydrate the row LOSES: ${missing.join(', ')}` : '  -> same set, no flip from this cause'),
  );

  console.log('\n4. Per-contract flags that decide the table status (GR closed for this key)');
  const flags = await q(
    `SELECT c.contract_id, c.po_number,
            (${sqlIsContractSapClosedForStoExpr('c', '$1::text')}) AS gr_closed
       FROM contracts c WHERE c.contract_id = ANY($2::text[]) ORDER BY c.contract_id`,
    [key, linkedContracts],
  );
  for (const f of flags) console.log(`   contract=${f.contract_id} po=${f.po_number} gr_closed_for_key=${f.gr_closed}`);

  console.log('\n5. ATA that the table reads beyond shipments.*: overrides, loading/discharge port rows, JPS (any of these makes the group Completed)');
  for (const m of members) {
    const sao = await q('SELECT * FROM shipment_ata_overrides WHERE shipment_id = $1::uuid', [m.id]);
    const vlp = await q(
      `SELECT port_sequence, is_discharge_port, ata_vessel_arrival, ata_loading_completed, ata_vessel_sailed
         FROM vessel_loading_ports WHERE shipment_id = $1::uuid ORDER BY port_sequence NULLS LAST`,
      [m.id],
    );
    console.log(`   shipment ${m.id.slice(0, 8)} (po ${m.po_number}): overrides=${sao.length ? JSON.stringify(sao[0]) : '-'}`);
    for (const v of vlp) {
      console.log(`      port seq=${v.port_sequence} discharge=${v.is_discharge_port} ata_arrival=${day(v.ata_vessel_arrival)} ata_loading_completed=${day(v.ata_loading_completed)} ata_sailed=${day(v.ata_vessel_sailed)}`);
    }
    if (!vlp.length) console.log('      (no port rows)');
  }

  console.log('\n6. Snapshot behind "nothing left outstanding" (is_contract_os_within_band decides Completed for the whole group, BOOL_AND over its contracts)');
  const snap = await q(
    `SELECT c.contract_id, c.po_number, c.quantity_ordered, (qms.contract_number IS NOT NULL) AS has_snapshot,
            (${shipmentListContractOsWithinBandExpr('c', 'qms')}) AS within_band
       FROM contracts c LEFT JOIN contract_qty_move_snapshot qms ON qms.contract_number = c.contract_id
      WHERE c.contract_id = ANY($1::text[]) ORDER BY c.contract_id`,
    [linkedContracts],
  );
  for (const r of snap) {
    console.log(`   contract=${r.contract_id} po=${r.po_number} qty=${r.quantity_ordered} snapshot=${r.has_snapshot} os_within_band=${r.within_band}`);
  }

  console.log('\n7. Which member the table row opens in Edit Shipment (primary row of the group)');
  const keyExpr = "$1::text";
  // The container may run a build from before the override-aware rule existed (no 6th argument): then add the same OR clauses to rule 4 here,
  // so this section shows what the new rule would choose without deploying it.
  const orderSql = (overrideAlias) => {
    const base = sqlShipmentListPrimaryOrderBy(keyExpr, 'c', 'l', 's', undefined, overrideAlias);
    if (!overrideAlias || base.includes(overrideAlias + '.')) return base;
    const anchor = 'OR s.ata_discharge_complete IS NOT NULL';
    if (!base.includes(anchor)) throw new Error('primary-row ORDER BY has an unexpected shape');
    const o = overrideAlias;
    return base.replace(anchor, anchor + ' OR ' + o + '.ata_arrival IS NOT NULL OR ' + o + '.ata_loading_complete IS NOT NULL OR ' + o + '.ata_sailed IS NOT NULL OR ' + o + '.ata_discharge_start IS NOT NULL OR ' + o + '.ata_discharge_complete IS NOT NULL');
  };
  const pick = async (label, overrideAlias) => {
    const rows = await q(
      `SELECT s.id::text AS id, c.po_number, s.shipment_id, s.status, (sao.ata_discharge_complete IS NOT NULL) AS has_override_atc
         FROM shipments s
         LEFT JOIN contracts c ON c.id = s.contract_id
         LEFT JOIN shipment_ata_overrides sao ON sao.shipment_id = s.id
        WHERE TRIM(COALESCE(s.operation_id, '')) = $1 OR TRIM(COALESCE(s.shipment_id::text, '')) = $1
        ORDER BY ${orderSql(overrideAlias)}`,
      [key],
    );
    const first = rows[0];
    console.log(`   ${label}: ${first ? first.id.slice(0, 8) + ' (po ' + first.po_number + ', status ' + first.status + ', override ATC ' + first.has_override_atc + ')' : '(none)'}`);
    return rows;
  };
  const before = await pick('rule as deployed (raw shipments.ata_* only)', undefined);
  await pick('rule with override ATA counted       ', 'sao');
  for (const r of before) console.log(`      member ${r.id.slice(0, 8)} po=${r.po_number} shipment_id=${r.shipment_id}`);

  await connection.end?.();
})().catch((e) => {
  console.error('diag failed:', e);
  process.exit(1);
});
