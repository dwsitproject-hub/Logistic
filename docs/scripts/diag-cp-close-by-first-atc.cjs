/*
 * READ-ONLY measurement for a candidate change to Contract Performance's "effectively done" rule.
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-cp-close-by-first-atc.cjs | docker exec -i klip-backend node - | tail -80
 *
 * The case (PO 1001032275): the contract's first voyage has an ATC, a SECOND live shipment (no ATC yet) is planned for the rest, outstanding is still 622 MT, and
 * Contract Performance files it under Close because one ATC is enough (sto_count empty counts as one STO). The candidate rule: the ATC arm only closes a contract when
 * NO live (not cancelled) shipment of it is still without an ATC.
 *
 * This script changes nothing. It asks the Contract Performance list (the handler the page calls: YTD, requireRegionSite, status Close) for every contract CP calls Close,
 * keeps the ones SAP still calls Open (so CP closed them on its own rule) with outstanding above the zero band, and for those counts:
 *   - how many are Close ONLY through the ATC arm while a live shipment has no ATC  -> these would move back to Open under the candidate rule,
 *   - how many are unaffected (OS inside the band, every vessel STO finished, or every live shipment has its ATC).
 * Then it lists the ones that would move, with their outstanding, so they can be judged one by one.
 */
const path = require('path');
const fs = require('fs');
const DIST = ['/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].find((p) => fs.existsSync(p));
if (!DIST) {
  console.error('no backend build found');
  process.exit(1);
}
const load = (m) => require(path.join(DIST, m));
const WATCH_PO = String(process.env.PO || '1001032275').trim();

function ask(getContracts, query) {
  return new Promise((resolve, reject) => {
    const res = {
      status() { return res; },
      json(body) { resolve(body); return res; },
      send(body) { resolve(body); return res; },
      set() { return res; },
      setHeader() { return res; },
      headersSent: false,
    };
    Promise.resolve(getContracts({ query, headers: {} }, res)).catch(reject);
  });
}

(async () => {
  const pool = load('database/connection').default;
  const { getContracts } = load('controllers/contract.controller');
  const cyc = load('utils/contractsListCycleSql');
  const { sqlJpsAtaWhileOpen } = load('utils/shipmentAtaOverrideSql');
  const tol = Number(load('utils/qtyZeroTolerance').OUTSTANDING_QTY_ZERO_TOLERANCE_KG);

  const year = new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10);

  // 1. Every contract Contract Performance files under Close (YTD, the page's own list rules).
  const closed = [];
  for (let page = 1; page <= 80; page++) {
    const body = await ask(getContracts, {
      page: String(page), limit: '200', scope: 'filtered', dateFrom: `${year}-01-01`, dateTo: today,
      requireRegionSite: 'true', compact: 'true', status: 'Close',
    });
    const data = (body && body.data) || {};
    const list = data.contracts || [];
    closed.push(...list);
    const totalPages = (data.pagination && data.pagination.totalPages) || 1;
    if (page >= totalPages || list.length === 0) break;
  }
  console.log(`Contracts that Contract Performance files under Close (YTD ${year}): ${closed.length}`);

  // 2. The ones SAP still calls Open, with outstanding above the zero band: CP closed these on its own rule.
  const isSapClosed = (r) => ['CLOSE', 'CLOSED', 'COMPLETED'].includes(String(r.import_status || '').trim().toUpperCase());
  const sapOpenCpClose = closed.filter((r) => !isSapClosed(r));
  const outOfBand = sapOpenCpClose.filter((r) => Number(r.outstanding_quantity) > tol);
  console.log(`  of them SAP still Open (closed by CP's own rule): ${sapOpenCpClose.length}`);
  console.log(`  of those with outstanding above the zero band (> ${tol} kg): ${outOfBand.length}  <- the ones the ATC / vessel-finished arms hold in Close\n`);
  if (outOfBand.length === 0) process.exit(0);

  // 3. Per contract: live shipments, how many have no ATC (same ATC resolution as the list: JPS lane, KLIP override, shipment column, discharge leg).
  const ids = outOfBand.map((r) => String(r.contract_id));
  const ship = await pool.query(
    `WITH newest AS (
       SELECT DISTINCT ON (c.contract_id) c.contract_id, c.id
         FROM contracts c WHERE c.contract_id = ANY($1::text[]) ORDER BY c.contract_id, c.created_at DESC
     )
     SELECT x.contract_id,
            COUNT(*) FILTER (WHERE x.live)::int AS live_shipments,
            COUNT(*) FILTER (WHERE x.live AND x.atc IS NULL)::int AS live_without_atc,
            MAX(x.atc) FILTER (WHERE x.live) AS last_atc,
            STRING_AGG(x.status || CASE WHEN x.atc IS NULL THEN ' (no ATC)' ELSE ' (ATC ' || x.atc::text || ')' END, ' | ' ORDER BY x.created) FILTER (WHERE x.live) AS shipments
       FROM (
         SELECT n.contract_id, s_atc.created_at AS created, COALESCE(s_atc.status, '') AS status,
                (UPPER(COALESCE(s_atc.status, '')) NOT IN ('CANCELLED', 'CANCELED')) AS live,
                COALESCE(
                  ${sqlJpsAtaWhileOpen('jps_ata_discharge_complete', 'sao_atc', 's_atc')}::date,
                  sao_atc.ata_discharge_complete::date,
                  s_atc.ata_discharge_complete::date,
                  vlp_atc.ata_loading_completed::date
                ) AS atc
           FROM newest n
           JOIN shipments s_atc ON s_atc.contract_id = n.id
           LEFT JOIN shipment_ata_overrides sao_atc ON sao_atc.shipment_id = s_atc.id
           LEFT JOIN LATERAL (
             SELECT v_atc.ata_loading_completed FROM vessel_loading_ports v_atc
              WHERE v_atc.shipment_id = s_atc.id AND COALESCE(v_atc.is_discharge_port, FALSE) = TRUE AND v_atc.ata_loading_completed IS NOT NULL
              ORDER BY v_atc.ata_loading_completed DESC LIMIT 1
           ) vlp_atc ON TRUE
       ) x
      GROUP BY x.contract_id`,
    [ids],
  );
  const byId = new Map(ship.rows.map((r) => [String(r.contract_id), r]));

  // 4. The vessel-STOs-finished arm only for the candidates (it is the heavier one).
  const candidates = outOfBand.filter((r) => (byId.get(String(r.contract_id)) || {}).live_without_atc > 0);
  const moves = [];
  const stay = { no_live_shipment_without_atc: outOfBand.length - candidates.length, vessel_stos_finished: 0 };
  for (const r of candidates) {
    const v = await pool.query(`SELECT COALESCE((${cyc.sqlContractVesselStosFinishedExpr('$1::text')}), FALSE) AS f`, [String(r.contract_id)]);
    if (v.rows[0].f) { stay.vessel_stos_finished += 1; continue; }
    const s = byId.get(String(r.contract_id));
    moves.push({
      contract_id: r.contract_id,
      po: String(r.po_numbers || '').slice(0, 22),
      product: r.product,
      plant_site: r.plant_site,
      incoterm: r.incoterm,
      os_mt: Math.round(Number(r.outstanding_quantity) / 100) / 10,
      live_ship: s.live_shipments,
      no_atc: s.live_without_atc,
      last_atc: s.last_atc ? new Date(s.last_atc).toISOString().slice(0, 10) : '-',
      shipments: String(s.shipments || '').slice(0, 90),
    });
  }
  moves.sort((a, b) => b.os_mt - a.os_mt);

  const sumMt = moves.reduce((a, m) => a + m.os_mt, 0);
  console.log('--- what the candidate rule would do to those contracts');
  console.table([
    { outcome: 'stay in Close: every live shipment has its ATC', contracts: stay.no_live_shipment_without_atc },
    { outcome: 'stay in Close: every vessel STO finished (arm 3)', contracts: stay.vessel_stos_finished },
    { outcome: 'MOVE BACK TO OPEN: a live shipment still has no ATC', contracts: moves.length },
  ]);
  console.log(`Outstanding that would return to the Open tab: ${Math.round(sumMt * 10) / 10} MT over ${moves.length} contracts`);
  const watch = moves.find((m) => String(m.contract_id) === '1004032275' || String(m.po).includes(WATCH_PO));
  console.log(`PO ${WATCH_PO} in the list that moves: ${watch ? 'YES' : 'no'}\n`);
  console.log('--- the contracts that would move (largest outstanding first, at most 40)');
  console.table(moves.slice(0, 40));
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e && e.message ? e.message : e); process.exit(1); });
