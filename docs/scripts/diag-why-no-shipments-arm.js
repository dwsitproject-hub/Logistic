/*
 * READ-ONLY: for named contracts, say which Shipments gate keeps them out of BOTH OS arms.
 *
 * The Shipments OS is a union of two arms that must stay disjoint, so a contract belongs to exactly
 * one - or, when something is wrong, to neither, and its quantity is counted nowhere while Contract
 * Performance still shows it Open. Three such contracts remain in production (110 MT).
 *
 * Rather than infer which rule rejects them - inference produced several wrong answers in this
 * investigation - this renders each backlog gate from the deployed code and evaluates them one by
 * one, then reports the contract's shipments and whether the execution arm holds it.
 *
 *   node /app/diag-why-no-shipments-arm.js 1004030633 1004031792 1004031937
 */
const ids = process.argv.slice(2);
if (!ids.length) {
  console.error('usage: node diag-why-no-shipments-arm.js <contract_id> [contract_id ...]');
  process.exit(1);
}

const connection = require('/app/dist/database/connection');
const query = connection.query;

const pipeline = require('/app/dist/utils/shipmentPagePipelineSql');
const sibling = require('/app/dist/utils/seaStoSiblingSql');
const b2bOrigin = require('/app/dist/utils/shipmentB2bOriginSql');
const status = require('/app/dist/utils/contractDeliveryStatus');
const scopeSql = require('/app/dist/utils/shipmentIncotermScope');

/* Each entry is [label, SQL predicate]. TRUE means the gate is satisfied (the contract may pass). */
const gates = [];
const add = (label, fn) => {
  try {
    const sql = fn();
    if (sql) gates.push([label, sql]);
  } catch (e) {
    console.log('   (could not render gate "' + label + '": ' + e.message + ')');
  }
};

add('sea incoterm scope', () => scopeSql.buildShipmentPageSeaIncotermScopeSql('c'));
add('not SAP-inactive', () => 'NOT (' + status.sqlIsContractSapInactiveForShipmentBacklogExpr('c') + ')');
add('not a B2B child', () => pipeline.shipmentPageExcludeB2bChildCond('l'));
add('no registered ETA', () => pipeline.sqlContractHasNoRegisteredEtaExpr('c'));
add('no live shipment of its own', () =>
  "NOT EXISTS (SELECT 1 FROM shipments s_ns WHERE s_ns.contract_id = c.id" +
  " AND UPPER(TRIM(COALESCE(s_ns.status, ''))) <> 'CANCELLED')");
add('no active sea shipment on a shared STO', () =>
  'NOT (' + sibling.sqlContractSharesNumericStoWithActiveSeaShipmentExpr('c.id') + ')');
add('not a B2B origin whose child shipped', () =>
  'NOT (' + b2bOrigin.sqlContractIsB2bOriginOfShippedChildExpr('c') + ')');

const LATEST_SPD_CTE = [
  'WITH latest_spd_contract AS (',
  '  SELECT lss.contract_number, lss.effective_sto, lss.b2b_flag_raw, lss.contract_reference_po_raw,',
  '         lss.contract_ext_no_raw, lss.discharge_destination, lss.source_type_raw,',
  '         lss.spd_created_at AS created_at',
  '  FROM contract_latest_spd_snapshot lss',
  "  WHERE lss.contract_number IS NOT NULL AND TRIM(lss.contract_number) != ''",
  ')',
].join('\n');

(async () => {
  const selects = gates.map((g, i) => '(' + g[1] + ') AS g' + i).join(',\n       ');
  const sql = LATEST_SPD_CTE + '\n' +
    'SELECT c.contract_id,\n       ' + selects + '\n' +
    'FROM contracts c\n' +
    'LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id\n' +
    'WHERE c.contract_id = ANY($1)';
  const res = await query(sql, [ids]);

  for (const row of res.rows) {
    console.log('\n' + row.contract_id);
    const failed = [];
    gates.forEach((g, i) => {
      const ok = row['g' + i];
      console.log('   ' + (ok ? 'pass' : 'FAIL') + '  ' + g[0]);
      if (!ok) failed.push(g[0]);
    });
    console.log(failed.length
      ? '   -> kept out of the backlog by: ' + failed.join(', ')
      : '   -> passes every backlog gate; if it is in neither arm the cause is the unplanned/'
        + 'preplanned split, the OS-still-active test, or the Region/Site exclusion');
  }

  const ships = await query(
    'SELECT c.contract_id, s.shipment_id AS sto, s.status,' +
    ' (s.ata_discharge_complete IS NOT NULL) AS has_own_atc' +
    ' FROM contracts c LEFT JOIN shipments s ON s.contract_id = c.id' +
    ' WHERE c.contract_id = ANY($1) ORDER BY 1, 2', [ids]);
  console.log('\nshipments attached to these contracts:');
  if (!ships.rows.length) console.log('   (none)');
  for (const r of ships.rows) {
    console.log('   ' + String(r.contract_id).padEnd(12) + ' sto=' + String(r.sto || '-').padEnd(12) +
      ' status=' + String(r.status || '-').padEnd(12) + ' own_atc=' + r.has_own_atc);
  }
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e && e.stack ? e.stack : e);
  process.exit(1);
});
