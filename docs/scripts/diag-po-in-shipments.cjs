/*
 * READ-ONLY: why does a PO not turn up when it is searched on the Shipments page?
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-po-in-shipments.cjs | docker exec -i klip-backend node - --po=1011003245
 *
 * The page's search matches the row's merged `po_numbers`, `contract_numbers`, STO, shipment id, operation id and vessel (appendShipmentGlobalSearch) - on the GROUPED row, after a
 * B2B child has been relabeled to its origin, so a PO that exists only on a child can be on no row under its own number. This prints what KLIP holds for the PO and then asks the
 * page itself (getShipments, the route handler) with the PO, the contract, the STO and the origin, so the answer is the page's and not a reconstruction.
 *
 *   1. the contract(s) of the PO: status, incoterm, source, SAP presence, and the B2B origin it points to
 *   2. the stored SAP lines: STO, import, flags, GR statuses, vessel
 *   3. the shipments on those contracts
 *   4. the page, searched four ways, with the date range of the toolbar default (this year) and with none
 *
 * Writes nothing.
 */
const path = require('path');
const fs = require('fs');
const DIST = ['/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].find((p) => fs.existsSync(p));
if (!DIST) {
  console.error('no backend build found');
  process.exit(1);
}
const load = (m) => require(path.join(DIST, m));

(async () => {
  const pool = load('database/connection').default;
  const { getShipments } = load('controllers/shipment.controller');
  const { sqlSpdHasDeletePoFlagFromRow, sqlSpdHasDeleteStoFlagFromRow } = load('utils/sapMasterV2UatFormat');
  const { sqlContractImportStatusExpr } = load('utils/contractDeliveryStatus');

  const arg = process.argv.find((a) => a.startsWith('--po='));
  const po = (arg ? arg.slice('--po='.length) : '').trim();
  if (!po) {
    console.error('Needs --po=<PO number>');
    process.exit(1);
  }
  const day = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '-');
  const mt = (kg) => (Number(kg || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 });

  console.log(`PO ${po}\n`);
  console.log('[1] contracts');
  const contracts = (
    await pool.query(
      `SELECT c.id::text AS id, c.contract_id, c.po_number, c.status, c.incoterm, c.source_type, c.sap_presence, c.contract_date::date AS contract_date, c.sto_number, c.quantity_ordered,
              ${sqlContractImportStatusExpr('c')} AS import_status,
              l.b2b_flag_raw, l.contract_reference_po_raw,
              (SELECT o.contract_id FROM contracts o WHERE NULLIF(TRIM(o.po_number::text), '') = NULLIF(TRIM(l.contract_reference_po_raw), '') LIMIT 1) AS b2b_origin_contract,
              snap.plant_site, snap.outstanding_quantity
         FROM contracts c
         LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
         LEFT JOIN contract_performance_snapshot snap ON snap.contract_id = c.contract_id
        WHERE TRIM(c.po_number::text) = $1 OR c.contract_id = $1`,
      [po],
    )
  ).rows;
  if (contracts.length === 0) console.log('   no contract holds this PO number (nor a contract of that number)');
  for (const c of contracts) {
    console.log(
      `   contract ${c.contract_id}  PO ${c.po_number}  status=${c.status}  import_status=${c.import_status || '-'}  ${c.incoterm || '-'}  ${c.plant_site || '-'}  date ${day(c.contract_date)}  qty ${mt(c.quantity_ordered)} MT  OS ${mt(c.outstanding_quantity)} MT\n` +
        `      SAP presence ${c.sap_presence || '-'}   B2B flag '${c.b2b_flag_raw || ''}'   reference PO '${c.contract_reference_po_raw || ''}'   origin contract ${c.b2b_origin_contract || '-'}`,
    );
  }

  console.log('\n[2] stored SAP lines');
  const spd = (
    await pool.query(
      `SELECT spd.contract_number, TRIM(spd.sto_number::text) AS sto, spd.import_id::text AS import_id, spd.last_seen_at::date AS seen,
              (${sqlSpdHasDeletePoFlagFromRow('spd')}) AS del_po, (${sqlSpdHasDeleteStoFlagFromRow('spd')}) AS del_sto,
              spd.data->'raw'->>'GR PO Status' AS gr_po, spd.data->'raw'->>'GR STO Status' AS gr_sto, spd.data->'raw'->>'Vessel Name' AS vessel
         FROM sap_processed_data spd WHERE TRIM(spd.po_number::text) = $1 ORDER BY sto NULLS FIRST`,
      [po],
    )
  ).rows;
  if (spd.length === 0) console.log('   no SAP line stored for this PO');
  for (const x of spd) {
    console.log(`   contract ${x.contract_number || '-'}  STO ${String(x.sto || '-').padEnd(12)} import ${String(x.import_id || '-').slice(0, 8)} seen ${day(x.seen)}  GR PO ${x.gr_po || '-'} GR STO ${x.gr_sto || '-'}  Delete PO ${x.del_po} Delete STO ${x.del_sto}  vessel ${x.vessel || '-'}`);
  }

  console.log('\n[3] shipments on those contracts');
  const ships = (
    await pool.query(
      `SELECT c.contract_id, s.shipment_id, s.operation_id, s.status, s.vessel_name, s.created_at::date AS created
         FROM shipments s JOIN contracts c ON c.id = s.contract_id
        WHERE TRIM(c.po_number::text) = $1 OR c.contract_id = $1 ORDER BY s.created_at`,
      [po],
    )
  ).rows;
  if (ships.length === 0) console.log('   none (a PO without a shipment is a backlog row, not a shipment row)');
  for (const s of ships) console.log(`   ${s.contract_id}  shipment_id ${s.shipment_id || '-'}  ${s.operation_id || '-'}  ${s.status}  ${s.vessel_name || '-'}  created ${day(s.created)}`);

  async function call(query) {
    let payload = null;
    const res = { status() { return this; }, json(p) { payload = p; return this; }, setHeader() { return this; }, send(p) { payload = p; return this; } };
    await getShipments({ query, headers: {}, user: undefined }, res);
    const rows = (payload && payload.data && (Array.isArray(payload.data) ? payload.data : payload.data.shipments || payload.data.items)) || [];
    return rows;
  }
  const year = new Date().getFullYear();
  const ranges = [
    ['this year', { dateFrom: `${year}-01-01`, dateTo: `${year}-12-31` }],
    ['no date range', {}],
  ];
  const origin = contracts.map((c) => c.b2b_origin_contract).find(Boolean);
  const terms = [
    ['the PO', po, {}],
    ...contracts.map((c) => [`its contract ${c.contract_id}`, c.contract_id, {}]),
    ...[...new Set(spd.map((x) => x.sto).filter(Boolean))].slice(0, 3).map((sto) => [`STO ${sto}`, sto, {}]),
    ...(origin ? [[`the origin contract ${origin}`, origin, {}]] : []),
  ];
  console.log('\n[4] the Shipments page, searched');
  for (const [rangeLabel, range] of ranges) {
    for (const [label, term] of terms) {
      let rows = [];
      try {
        rows = await call({ ...range, search: term, page: '1', limit: '50' });
      } catch (e) {
        console.log(`   ${rangeLabel.padEnd(14)} ${label.padEnd(34)} FAILED ${String(e.message).slice(0, 80)}`);
        continue;
      }
      const holdsPo = rows.filter((r) => String(r.po_numbers || '').includes(po));
      console.log(`   ${rangeLabel.padEnd(14)} search "${term}" (${label}): ${rows.length} row(s); ${holdsPo.length} carry the PO in po_numbers`);
      for (const r of rows.slice(0, 3)) {
        console.log(`        ${String(r.sto_key || r.sto_number || '-').padEnd(26)} ${String(r.status || '-').padEnd(10)} ${String(r.vessel_name || '-').padEnd(22)} POs ${String(r.po_numbers || '-').slice(0, 70)}`);
      }
    }
  }
  await pool.end();
  process.exit(0);
})().catch((e) => {
  console.error('Failed:', e && e.message ? e.message : e);
  process.exit(1);
});
