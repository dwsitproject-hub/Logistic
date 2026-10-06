/**
 * READ-ONLY. Why do the Contract Performance cards and the view table disagree on Outstanding?
 *
 * Needs no deploy and no dump: it calls the code ALREADY inside the running backend image (dist/), so it can be piped into
 * production straight from a branch:
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-cp-os-discrepancy.cjs \
 *     | docker exec -i klip-backend node - --plant="TANJUNG PURA" --product=CPO --incoterm=FOB
 *
 * Options (all optional): --plant= --product= --incoterm= --from=YYYY-MM-DD --to=YYYY-MM-DD
 *
 * Prints, per PO the view table lists, the Outstanding and Open/Close the CARDS compute next to the table's, and for every PO
 * where they differ the raw facts both calculations start from (contract, STOs, shipments, ATC incl. KLIP override and the
 * JPS lane). Nothing is written.
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const mt = (kg) => {
  const n = Number(kg);
  return Number.isFinite(n) ? Math.round(n) / 1000 : '-';
};
const day = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '-');

(async () => {
  const pool = dist('database/connection').default;
  const { getContracts } = dist('controllers/contract.controller');
  const lp = dist('services/latePerformance.service');
  const { resolveContractEffectiveStatusText } = dist('utils/contractDeliveryStatus');

  const plant = arg('plant', 'TANJUNG PURA');
  const product = arg('product', 'CPO');
  const incoterm = arg('incoterm', 'FOB');
  const from = arg('from', `${new Date().getFullYear()}-01-01`);
  const to = arg('to', new Date().toISOString().slice(0, 10));
  const user = { id: 'diag', role: 'ADMIN', permissions: ['*'] };
  const common = { scope: 'filtered', dateFrom: from, dateTo: to, plant, product, incoterms: incoterm, status: 'Open' };

  // ---- cards / drilldown side
  const filters = lp.parseLatePerformanceFilters({ query: { ...common }, user }, 'all');
  const rows = await lp.loadLatePerformanceRows(filters);
  const cards = new Map();
  for (const row of rows) {
    const key = String(row.contract_id ?? '');
    cards.set(key, {
      effective: resolveContractEffectiveStatusText(row),
      importStatus: row.import_status,
      osRow: row.outstanding_quantity,
      osCard: lp.resolveOpenPerfOutstandingQtyKg(row),
      deliveryEnd: lp.resolveEffectiveDeliveryEnd(row),
      inTree: lp.isContractIncludedInPerfDrilldownTree(row),
      atc: row.last_ata_vessel_complete_discharge,
      stoCount: row.sto_count,
      allStosDischarged: row.all_stos_discharged,
      po: row.po_number,
    });
  }

  // ---- view table side: the params the page sends for the Open tab
  let body;
  const res = {
    statusCode: 200,
    status() { return res; },
    json(b) { body = b; return res; },
    setHeader() { return res; },
  };
  await getContracts(
    {
      query: {
        ...common,
        lateOnTimeFilter: 'ALL',
        excludeUnscheduled: 'false',
        requireRegionSite: 'true',
        compact: 'true',
        page: '1',
        limit: '300',
        sortKey: 'outstanding_qty_mt',
        sortDir: 'desc',
        _ts: String(Date.now()),
      },
      user,
    },
    res,
  );
  const table = (body && body.data && body.data.contracts) || [];

  console.log(`filters: ${plant} / ${product} / ${incoterm} / ${from}..${to} / Open`);
  console.log(`cards rows: ${rows.length}   table rows: ${table.length}\n`);
  console.log(['contract', 'PO', 'table_os_mt', 'card_os_mt', 'card_state', 'table_status', 'deliveryEnd', 'inTree', 'ATC', 'stos', 'allDisch'].join('\t'));

  let tableSum = 0;
  let cardSum = 0;
  const mismatched = [];
  for (const t of table) {
    const key = String(t.contract_id ?? t.contract_number ?? '');
    const tableOs = Number(t.outstanding_quantity ?? 0);
    const c = cards.get(key);
    tableSum += tableOs;
    const cardOpen = c && (c.effective === 'OPEN' || c.effective === 'ACTIVE');
    if (cardOpen) cardSum += Number(c.osCard) || 0;
    const differs = !c || !cardOpen || Math.round(Number(c.osCard) || 0) !== Math.round(tableOs);
    if (differs) mismatched.push(key);
    console.log(
      [
        key,
        t.po_number ?? (c && c.po) ?? '',
        mt(tableOs),
        c ? mt(c.osCard) : '(not in cards)',
        c ? `${c.effective}${c.importStatus ? ` gr=${c.importStatus}` : ''}` : '-',
        t.status ?? '',
        c ? day(c.deliveryEnd) : '-',
        c ? c.inTree : '-',
        c ? day(c.atc) : '-',
        c ? c.stoCount : '-',
        c ? c.allStosDischarged : '-',
        differs ? '  <== DIFFERS' : '',
      ].join('\t'),
    );
  }
  console.log(`\ntable OS total: ${mt(tableSum)} MT    cards (Open) OS total: ${mt(cardSum)} MT    difference: ${mt(tableSum - cardSum)} MT`);

  // ---- raw facts for every PO where the two disagree
  for (const key of mismatched) {
    console.log(`\n=== ${key}`);
    const k = await pool.query(
      `SELECT id::text, contract_id, po_number, status, incoterm, quantity_ordered, delivery_end_date::text FROM contracts WHERE contract_id = $1`,
      [key],
    );
    console.log('contract      ', JSON.stringify(k.rows));
    const cid = k.rows[0] && k.rows[0].id;
    if (!cid) continue;
    const stos = await pool.query(`SELECT sto_number, sto_quantity FROM contract_stos WHERE contract_id = $1::uuid`, [cid]);
    console.log('contract_stos ', JSON.stringify(stos.rows));
    const ships = await pool.query(
      `SELECT s.shipment_id, s.operation_id, s.status, s.quantity_delivered_klip, s.actual_vessel_qty_receive,
              s.ata_discharge_complete::text AS atc_shipment,
              sao.ata_discharge_complete::text AS atc_override,
              sao.jps_ata_discharge_complete::text AS atc_jps_lane
         FROM shipments s LEFT JOIN shipment_ata_overrides sao ON sao.shipment_id = s.id
        WHERE s.contract_id = $1::uuid ORDER BY s.created_at`,
      [cid],
    );
    console.log('shipments     ', JSON.stringify(ships.rows));
    const spd = await pool.query(
      `SELECT sto_number, data->'raw'->>'GR PO Status' AS gr_po, data->'raw'->>'GR STO Status' AS gr_sto,
              data->'raw'->>'Delete PO Status' AS del_po
         FROM sap_processed_data WHERE contract_number = $1 ORDER BY created_at DESC LIMIT 6`,
      [key],
    );
    console.log('sap rows      ', JSON.stringify(spd.rows));
  }
  await pool.end();
})().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
