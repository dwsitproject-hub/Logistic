/*
 * READ-ONLY: measure every class of OS disagreement between Shipments and Contract Performance,
 * across all sea incoterms, contract by contract.
 *
 * The CPO/BONTANG/FOB slice closed exactly on three contracts with three different causes. Before
 * fixing any of them, this sizes each class over the whole dataset, so the order of work follows
 * the numbers rather than the one slice that happened to be looked at.
 *
 * Classes reported:
 *   A  Shipments counts it, Contract Performance says the GR is Close
 *   B  both count it, but the outstanding quantity differs
 *   C  Contract Performance counts it, Shipments has it in neither arm
 *   D  Shipments counts it and CP rejects it for some other gate (the gate is named)
 *
 * Issues the work of one page load. Avoid repeating it during business hours.
 *
 *   node /app/diag-os-gap-classes.js [FROM] [TO]
 */
const [, , DFROM = '2026-01-01', DTO = '2026-12-31'] = process.argv;

const connection = require('/app/dist/database/connection');
const original = connection.query;
const captured = [];
connection.query = async (text, params) => {
  if (typeof text === 'string' && text.includes('execution_os')) captured.push({ text, params: params || [] });
  return original(text, params);
};

const { getShipments } = require('/app/dist/controllers/shipment.controller');
const { buildShipmentOutstandingQtyBacklogAggregateQuery } = require('/app/dist/utils/shipmentOutstandingQtySummarySql');
const { buildUnplannedContractToolbarScope } = require('/app/dist/utils/shipmentUnplannedHybridSql');

const SEA = ['FOB', 'CIF', 'CFR'];
const mt = (kg) => Math.round(Number(kg || 0) / 1000).toLocaleString('en-US');

const CP_SQL = [
  'SELECT base.contract_id,',
  "       UPPER(TRIM(COALESCE(base.incoterm,''))) AS incoterm,",
  '       COALESCE(base.outstanding_quantity,0)   AS os_kg,',
  '       CASE',
  "         WHEN COALESCE(base.sap_presence,'PRESENT') = 'WITHDRAWN' THEN 'SAP withdrawn'",
  "         WHEN UPPER(TRIM(COALESCE(base.plant_site,''))) IN ('','BLANK') THEN 'blank Region/Site'",
  "         WHEN UPPER(TRIM(COALESCE(base.latest_spd_data->'contract'->>'contract_type', base.latest_spd_data->>'B2B Flag',''))) = 'B2B'",
  "              AND NULLIF(TRIM(COALESCE(base.latest_spd_data->'contract'->>'contract_reference_po', base.latest_spd_data->>'CONTRACT REFF PO', base.latest_spd_data->>'Contract Reff PO Ini', base.latest_spd_data->'raw'->>'Contract Reff PO Ini', base.latest_spd_data->'raw'->>'CONTRACT REFF PO')),'') IS NOT NULL",
  "           THEN 'B2B child'",
  "         WHEN COALESCE(base.outstanding_quantity,0) <= 499 THEN 'nothing outstanding'",
  "         WHEN UPPER(TRIM(COALESCE(base.import_status, base.status,''))) NOT IN ('OPEN','ACTIVE') THEN 'GR is Close'",
  "         WHEN base.last_ata_vessel_complete_discharge IS NOT NULL AND COALESCE(sa.sto_count,1) <= 1 THEN 'ATC on a single-STO PO'",
  "         ELSE 'OPEN'",
  '       END AS verdict',
  'FROM contract_performance_snapshot base',
  'LEFT JOIN contract_sto_agg_snapshot sa ON sa.contract_number = base.contract_id',
  'WHERE base.contract_date >= $1 AND base.contract_date <= $2',
  "  AND UPPER(TRIM(COALESCE(base.incoterm,''))) IN ('FOB','CIF','CFR')",
].join('\n');

(async () => {
  const req = {
    query: { compact: 'true', outstandingQtyOnly: 'true', limit: '1', page: '1', dateFrom: DFROM, dateTo: DTO },
    user: { id: 'diag', role: 'ADMIN', permissions: ['*'] },
  };
  await getShipments(req, { json: () => undefined, status: () => ({ json: () => undefined }) });

  const ship = new Map();
  const add = (r, arm) => {
    const inc = String(r.incoterm || '').trim().toUpperCase();
    if (!SEA.includes(inc)) return;
    const id = String(r.contract_number);
    const kg = Number(r.outstanding_quantity || 0);
    const prev = ship.get(id);
    if (prev) {
      prev.kg += kg;
      prev.arm += '+' + arm;
    } else {
      ship.set(id, { kg: kg, arm: arm, inc: inc, status: r.effective_status || '-' });
    }
  };

  if (captured.length) {
    const c = captured[0];
    const f = c.text.lastIndexOf('FROM execution_os');
    const s = c.text.lastIndexOf('SELECT', f);
    const q = c.text.slice(0, s) + 'SELECT contract_number, incoterm, effective_status, outstanding_quantity FROM execution_os';
    for (const r of (await original(q, c.params)).rows) add(r, 'execution');
  } else {
    console.log('(no execution_os query captured - a cached summary may have served the page)');
  }

  const scope = buildUnplannedContractToolbarScope({ dateFrom: DFROM, dateTo: DTO, contract: undefined, plants: [] });
  const bt = await buildShipmentOutstandingQtyBacklogAggregateQuery(scope.sql, '');
  const bf = bt.lastIndexOf('FROM backlog_rows');
  const bs = bt.lastIndexOf('SELECT', bf);
  const bq = bt.slice(0, bs) + 'SELECT contract_number, incoterm, NULL AS effective_status, outstanding_quantity FROM backlog_rows';
  for (const r of (await original(bq, scope.params)).rows) add(r, 'backlog');

  const cp = new Map();
  for (const r of (await original(CP_SQL, [DFROM, DTO])).rows) {
    cp.set(String(r.contract_id), { kg: Number(r.os_kg || 0), verdict: r.verdict, inc: r.incoterm });
  }

  const classes = { A: [], B: [], C: [], D: [] };
  for (const entry of ship) {
    const id = entry[0];
    const s = entry[1];
    const c = cp.get(id);
    if (!c || c.verdict !== 'OPEN') {
      const why = c ? c.verdict : 'not in the CP snapshot';
      const bucket = why === 'GR is Close' ? classes.A : classes.D;
      bucket.push({ id: id, kg: s.kg, arm: s.arm, why: why, inc: s.inc });
    } else if (Math.abs(c.kg - s.kg) > 499) {
      classes.B.push({
        id: id,
        kg: s.kg - c.kg,
        arm: s.arm,
        why: 'CP ' + mt(c.kg) + ' vs Shipments ' + mt(s.kg),
        inc: s.inc,
      });
    }
  }
  for (const entry of cp) {
    const id = entry[0];
    const c = entry[1];
    if (c.verdict === 'OPEN' && !ship.has(id)) {
      classes.C.push({ id: id, kg: -c.kg, arm: 'neither', why: 'in no Shipments arm', inc: c.inc });
    }
  }

  const label = {
    A: 'A  Shipments counts it, CP says the GR is Close',
    B: 'B  both count it, the quantity differs',
    C: 'C  CP counts it, Shipments has it in neither arm',
    D: 'D  Shipments counts it, CP rejects it for another reason',
  };
  let net = 0;
  for (const k of ['A', 'B', 'C', 'D']) {
    const rows = classes[k].sort((x, y) => Math.abs(y.kg) - Math.abs(x.kg));
    let sum = 0;
    for (const r of rows) sum += r.kg;
    net += sum;
    console.log('\n' + label[k] + '  -  ' + rows.length + ' contracts, ' + mt(sum) + ' MT');
    for (const r of rows.slice(0, 12)) {
      console.log(
        '   ' + String(r.id).padEnd(12) + ' ' + String(r.inc).padEnd(4) + ' ' +
        mt(r.kg).padStart(8) + ' MT  ' + String(r.arm).padEnd(18) + ' ' + r.why,
      );
    }
    if (rows.length > 12) console.log('   ... and ' + (rows.length - 12) + ' more');
  }
  console.log('\nnet Shipments minus Contract Performance: ' + mt(net) + ' MT');
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e && e.stack ? e.stack : e);
  process.exit(1);
});
