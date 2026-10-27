/*
 * READ-ONLY: does the Contract Performance Discharge Port filter hold exactly the contracts it should?
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-cp-discharge-port.cjs | docker exec -i klip-backend node - "PORT BONTANG"
 *
 * The filter works per CONTRACT, on both Contract Performance read paths: the cards / tree row loader (loadLatePerformanceRows) and the table (GET /contracts, also the export).
 * A contract with a live (not cancelled) shipment is at the port its shipments discharge at; one with none is at the port SAP says (the B2B ending child's first). Same two arms the
 * Shipments page unions, so the two pages agree on which contracts a port holds. No Blank pick exists: a contract whose text has no Master Port is listed while the filter is
 * unused and is not found through it.
 *
 * This runs the real cards / tree loader without and with the pick, then rebuilds the answer from the master tables with plain SQL and lists every contract where they disagree. The
 * reference does NOT include the B2B ending-child port override, so a disagreement on a contract that has a child port is expected and is labelled; any other disagreement is a defect.
 * Also prints how long the pick costs, and writes nothing.
 */
const path = require('path');
const fs = require('fs');
const DIST = ['/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].find((p) => fs.existsSync(p));
if (!DIST) {
  console.error('no backend build found');
  process.exit(1);
}
const load = (m) => require(path.join(DIST, m));
const label = (process.argv[2] || 'PORT BONTANG').trim();

(async () => {
  const pool = load('database/connection').default;
  const { loadLatePerformanceRows, parseLatePerformanceFilters } = load('services/latePerformance.service');
  const mk = (query) => parseLatePerformanceFilters({ query }, 'all');
  const year = new Date().getFullYear();
  const range = { dateFrom: `${year}-01-01`, dateTo: `${year}-12-31`, scope: 'filtered' };

  const idRes = await pool.query(`SELECT klip_resolve_master_port_id($1::text) AS id`, [label]);
  const portId = idRes.rows[0] && idRes.rows[0].id;
  console.log(`pick: ${label}  -> Master Port id ${portId || 'NONE (a label with no Master Port matches nothing)'}`);

  let t = Date.now();
  const all = await loadLatePerformanceRows(mk(range));
  console.log(`unfiltered rows: ${all.length}   (${Date.now() - t} ms)`);
  t = Date.now();
  const hit = await loadLatePerformanceRows(mk({ ...range, dischargePort: label }));
  console.log(`with the pick:   ${hit.length}   (${Date.now() - t} ms)`);

  const allIds = all.map((r) => String(r.contract_id));
  const engine = new Set(hit.map((r) => String(r.contract_id)));
  console.log(`filtered is a subset of unfiltered: ${[...engine].every((id) => allIds.includes(id))}`);
  if (!portId) {
    console.log('no Master Port for this label: the filter must (and does) return nothing:', hit.length === 0);
    await pool.end();
    process.exit(0);
  }

  const ref = await pool.query(
    `WITH picked AS (SELECT $2::uuid AS id),
          c AS (SELECT cx.id, cx.contract_id, cx.po_number FROM contracts cx WHERE cx.contract_id = ANY($1::text[])),
          live AS (SELECT c.contract_id, s.id AS sid, s.discharge_master_port_id FROM c JOIN shipments s ON s.contract_id = c.id AND COALESCE(s.status, '') <> 'CANCELLED'),
          ship_hit AS (
            SELECT DISTINCT l.contract_id FROM live l, picked p
             WHERE EXISTS (SELECT 1 FROM vessel_loading_ports vd WHERE vd.shipment_id = l.sid AND COALESCE(vd.is_discharge_port, false) AND NOT COALESCE(vd.is_cancelled, false) AND vd.master_port_id = p.id)
                OR (NOT EXISTS (SELECT 1 FROM vessel_loading_ports vd WHERE vd.shipment_id = l.sid AND COALESCE(vd.is_discharge_port, false) AND NOT COALESCE(vd.is_cancelled, false)
                                   AND NULLIF(TRIM(vd.port_name), '') IS NOT NULL AND TRIM(vd.port_name) !~ '^[0-9 ]*$' AND UPPER(TRIM(vd.port_name)) NOT IN ('BLANK', 'DISCHARGE PORT'))
                    AND l.discharge_master_port_id = p.id)),
          no_ship AS (SELECT c.contract_id, c.po_number FROM c WHERE NOT EXISTS (SELECT 1 FROM live l WHERE l.contract_id = c.contract_id)),
          sap_hit AS (
            SELECT n.contract_id FROM no_ship n
              LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = n.contract_id, picked p
             WHERE klip_resolve_master_port_id(NULLIF(TRIM(COALESCE(l.data->'raw'->>'Vessel Discharge Port', l.data->'shipment'->>'vessel_discharge_port')), '')) = p.id)
     SELECT contract_id,
            EXISTS (SELECT 1 FROM ship_hit h WHERE h.contract_id = c.contract_id) OR EXISTS (SELECT 1 FROM sap_hit h WHERE h.contract_id = c.contract_id) AS in_ref,
            EXISTS (SELECT 1 FROM b2b_ending_child_snapshot b WHERE b.origin_po = c.po_number AND NULLIF(TRIM(b.discharge_port), '') IS NOT NULL) AS has_child_port
       FROM c`,
    [allIds, portId],
  );
  const rows = ref.rows;
  const refSet = new Set(rows.filter((r) => r.in_ref).map((r) => r.contract_id));
  const child = new Map(rows.map((r) => [r.contract_id, r.has_child_port]));
  const onlyEngine = [...engine].filter((id) => !refSet.has(id));
  const onlyRef = [...refSet].filter((id) => !engine.has(id));
  console.log(`engine ${engine.size}   reference ${refSet.size}`);
  console.log(`only in the filter:    ${onlyEngine.length}   (with a B2B child port, expected: ${onlyEngine.filter((id) => child.get(id)).length})`);
  console.log(`only in the reference: ${onlyRef.length}   (with a B2B child port, expected: ${onlyRef.filter((id) => child.get(id)).length})`);
  const defects = [...onlyEngine, ...onlyRef].filter((id) => !child.get(id));
  console.log(defects.length === 0 ? 'OK: every disagreement is a B2B child-port contract' : `DEFECT: ${defects.length} disagreement(s) with no B2B child port:`);
  for (const id of defects.slice(0, 15)) console.log('   ', id, engine.has(id) ? '(filter only)' : '(reference only)');
  await pool.end();
  process.exit(defects.length === 0 ? 0 : 2);
})().catch((e) => {
  console.error('ERR', String(e && e.stack ? e.stack : e).slice(0, 500));
  process.exit(1);
});
