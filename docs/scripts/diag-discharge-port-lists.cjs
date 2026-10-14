/*
 * READ-ONLY: why the Discharge Port dropdown of Shipments and of Shipping Performance (SP) list different ports.
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-discharge-port-lists.cjs | docker exec -i klip-backend node -
 *
 * Nothing is written. It builds the two lists the way the pages do and compares them by PORT IDENTITY (the rule the filter itself uses: "PORT BONTANG", "Port of
 * Bontang" and "BONTANG" are one port, after the Master Port mapping when that is on).
 *
 *   Shipments  the server list (GET /contracts/filter-options/discharge-ports): the page's whole scope, no date, no other filter, backlog included. Each port is
 *              listed with the source(s) that carry it.
 *   SP         the ports of the SP rows the browser holds, picked by the page's own rule (resolveShippingPerfDischargePort: ending B2B child, then SAP vessel
 *              discharge port, then the shipment's port, then the leg's). Measured twice: with the page's DEFAULT date scope (this year, what the dropdown offers
 *              when the page opens) and over ALL time.
 *
 * Output: A counts; B ports only SP offers (all time) with what kind of row carries them; C ports only Shipments offers with the source that carries them; D what the
 * default date scope alone removes from SP.
 */
const path = require('path');
const fs = require('fs');

const DIST = [process.env.KLIP_DIST, '/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].filter(Boolean).find((p) => fs.existsSync(p));
if (!DIST) {
  console.error('no backend build found (looked in /app/dist and ../../backend/dist)');
  process.exit(1);
}
const load = (p) => require(path.join(DIST, p));
const pool = load('database/connection').default;
const { buildShipmentDischargePortOptionsSql, normalizeDischargePortIdentity } = load('utils/shipmentDischargePortSql');
const { shipmentPageOptionsScopeSql } = load('utils/shipmentProductOptionsSql');
const { canonicalDischargePort } = load('utils/dischargePortMap');
const { loadDischargePortMap } = load('services/dischargePortMap.service');
const sp = load('services/shippingPerformance.service');

const INVALID = new Set(['', 'blank', '0.00', '-', '—']);
const isCodeLike = (v) => /^\d+(\.\d+)?$/.test(String(v ?? '').trim());
const isGeneric = (v) => /^Loading Port \d+$/i.test(String(v ?? '').trim()) || /^Discharge Port$/i.test(String(v ?? '').trim());
const usable = (v) => {
  const t = String(v ?? '').trim();
  return t && !INVALID.has(t.toLowerCase()) && !isCodeLike(t) && !isGeneric(t);
};
// Same order as frontend resolveShippingPerfDischargePort.
const FIELDS = ['discharge_port_b2b_child', 'sap_vessel_discharge_port', 'port_of_discharge', 'vlp_discharge_port_name', 'discharge_port'];
function pickPort(row) {
  for (const f of FIELDS) if (usable(row[f])) return { label: String(row[f]).trim(), field: f };
  return null;
}

const label = (map, text) => canonicalDischargePort(map, String(text).toUpperCase().replace(/\s+/g, ' ').trim());
const ident = (map, text) => normalizeDischargePortIdentity(label(map, text));

async function spPorts(map, query) {
  const { rows } = await sp.runShippingPerformance({ query, user: {} }, 'rows');
  const byIdentity = new Map();
  for (const row of rows) {
    const p = pickPort(row);
    if (!p) continue;
    const id = ident(map, p.label);
    if (!id) continue;
    const e = byIdentity.get(id) ?? { example: label(map, p.label), rows: 0, fields: {}, kinds: {}, contracts: new Set() };
    e.rows += 1;
    e.fields[p.field] = (e.fields[p.field] ?? 0) + 1;
    const isB2b = String(row.b2b_flag ?? row.contract_type ?? '').trim().toUpperCase() === 'B2B';
    const hasRef = Boolean(String(row.contract_reference_po ?? '').trim());
    const kind = isB2b ? (hasRef ? 'B2B child/middle (has Reff PO)' : 'B2B origin') : 'not B2B';
    e.kinds[kind] = (e.kinds[kind] ?? 0) + 1;
    if (e.contracts.size < 3) e.contracts.add(String(row.contract_number ?? row.contract_id ?? row.po_number ?? '?'));
    byIdentity.set(id, e);
  }
  return { byIdentity, rowCount: rows.length };
}

const fmt = (o) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join(', ');

(async () => {
  try {
    const map = await loadDischargePortMap();

    // Shipments: label + source, read in a read-only transaction.
    const client = await pool.connect();
    let shipRows;
    try {
      await client.query('BEGIN READ ONLY');
      await client.query("SET LOCAL statement_timeout = '120s'");
      shipRows = (await client.query(buildShipmentDischargePortOptionsSql(shipmentPageOptionsScopeSql(), { withSource: true }))).rows;
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
    const ship = new Map();
    for (const r of shipRows) {
      const id = ident(map, r.label);
      if (!id) continue;
      const e = ship.get(id) ?? { example: label(map, r.label), sources: new Set() };
      e.sources.add(r.src);
      ship.set(id, e);
    }

    const spDefault = await spPorts(map, {});
    const spAll = await spPorts(map, { dateFrom: '1900-01-01', dateTo: '2999-12-31' });

    const only = (a, b) => [...a.keys()].filter((k) => !b.has(k));
    const onlySpAll = only(spAll.byIdentity, ship);
    const onlyShip = only(ship, spAll.byIdentity);
    const onlySpDefault = only(spDefault.byIdentity, ship);
    const onlyShipVsDefault = only(ship, spDefault.byIdentity);
    const lostByDate = only(spAll.byIdentity, spDefault.byIdentity);

    console.log('\n== A  counts (ports by identity) ==');
    console.log(`Shipments server list              ${ship.size}`);
    console.log(`SP, default date scope             ${spDefault.byIdentity.size}   (${spDefault.rowCount} rows)`);
    console.log(`SP, all time                       ${spAll.byIdentity.size}   (${spAll.rowCount} rows)`);
    console.log(`only in SP (default) / only in Shipments (vs default)   ${onlySpDefault.length} / ${onlyShipVsDefault.length}`);
    console.log(`only in SP (all time) / only in Shipments (vs all time) ${onlySpAll.length} / ${onlyShip.length}`);
    console.log(`SP ports the default date scope alone removes            ${lostByDate.length}`);

    console.log('\n== B  ports only SP offers (all time): rows | the field that carried it | kind of row | sample contracts ==');
    for (const id of onlySpAll.sort((a, b) => spAll.byIdentity.get(b).rows - spAll.byIdentity.get(a).rows)) {
      const e = spAll.byIdentity.get(id);
      console.log(`${e.example} | ${e.rows} | ${fmt(e.fields)} | ${fmt(e.kinds)} | ${[...e.contracts].join(' ')}`);
    }

    console.log('\n== C  ports only Shipments offers: the source(s) that carry it ==');
    for (const id of onlyShip.sort()) {
      const e = ship.get(id);
      console.log(`${e.example} | ${[...e.sources].join(' + ')}`);
    }

    console.log('\n== D  what the default date scope alone removes from SP (first 30) ==');
    for (const id of lostByDate.slice(0, 30)) console.log(spAll.byIdentity.get(id).example);
  } finally {
    await pool.end();
  }
})().catch((e) => {
  console.error('failed:', e.message);
  process.exit(1);
});
