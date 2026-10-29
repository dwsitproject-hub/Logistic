/**
 * Read-only: why an STO is, or is not, in the JPS sweep.
 *
 *   git show origin/SIT:docs/scripts/diag-jps-sto-eligibility.cjs | docker exec -i klip-backend node - 1006020421
 *
 * The sweep (jps/eligibility.ts findEligibleStos) offers an STO only while ALL of these hold on the shipment rows of its key:
 *   ATC Loading filled | no discharge ATA (arrival, berthed, start, complete) | status not COMPLETED/CANCELLED | ETA discharge arrival filled |
 *   the discharge port resolves to a Master Port switched on in Integrations > JPS > Ports | the contract is in contract_latest_spd_snapshot
 * and then only the first JPS_MAX_SUBMITS_PER_SWEEP of them, ordered by ETA, are looked at. A held STO (SKIPPED_NO_CARGO) stays in that list on purpose, so one that
 * stops being rewritten has left the list: either a condition above stopped holding, or the cap pushed it out.
 *
 * Prints, per shipment row of the STO, each condition as true/false, then the real sweep list (with the cap), the STO's instruction rows, and the audit log of its
 * shipments, which says who changed what and when. Writes nothing.
 */
const path = require('path');
const DIST = path.join(process.cwd(), 'dist');
const pool = require(path.join(DIST, 'database', 'connection')).default;
const { STO_KEY_SQL, EFFECTIVE_ATA_SQL, findEligibleStos } = require(path.join(DIST, 'jps', 'eligibility'));

const sto = String(process.argv[2] || '').trim();
if (!sto) {
  console.error('usage: ... | docker exec -i klip-backend node - <STO key>');
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
  // the switches the sweep reads (Integrations > JPS), as stored
  const settings = await show(
    'JPS settings that decide the sweep',
    `SELECT setting_key, value_plain FROM integration_settings WHERE integration = 'jps' AND setting_key IN ('JPS_PORTS', 'JPS_MAX_SUBMITS_PER_SWEEP', 'JPS_ENABLED')`,
  );
  const get = (k) => (settings.find((s) => s.setting_key === k) || {}).value_plain;
  let ports = [];
  try {
    ports = JSON.parse(get('JPS_PORTS') || process.env.JPS_PORTS || '[]').filter((p) => p && p.enabled).map((p) => p.port);
  } catch {
    /* shown below as an empty list */
  }
  const cap = Number(get('JPS_MAX_SUBMITS_PER_SWEEP') || process.env.JPS_MAX_SUBMITS_PER_SWEEP) || 25;
  console.log(`\nports switched on: ${ports.length ? ports.join(', ') : '(none)'}   |   cap per sweep: ${cap}`);

  const rows = await show(
    `shipment rows of STO ${sto}: each sweep condition`,
    `SELECT s.id::text AS shipment_uuid, s.shipment_id, s.operation_id, s.status, s.vessel_name,
            s.updated_at,
            (l.contract_number IS NOT NULL)                                   AS c6_in_snapshot,
            (eff.atc_loading IS NOT NULL)                                     AS c1_atc_loading,
            (eff.ata_disch_arrival IS NULL AND eff.ata_disch_berthed IS NULL
              AND eff.ata_disch_start IS NULL AND eff.ata_disch_complete IS NULL) AS c2_no_discharge_ata,
            (COALESCE(s.status, '') NOT IN ('COMPLETED', 'CANCELLED'))        AS c3_status_open,
            (s.eta_discharge_arrival IS NOT NULL)                             AS c4_eta_arrival,
            (rp.id IN (SELECT klip_resolve_master_port_id(p) FROM unnest($2::text[]) AS p)) AS c5_port_switched_on,
            eff.atc_loading, eff.ata_disch_arrival, eff.ata_disch_berthed, eff.ata_disch_start, eff.ata_disch_complete,
            s.eta_discharge_arrival, s.port_of_discharge, rp.port AS resolved_master_port
       FROM shipments s
       LEFT JOIN shipment_ata_overrides sao ON sao.shipment_id = s.id
       INNER JOIN contracts c ON c.id = s.contract_id
       LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
       CROSS JOIN LATERAL (SELECT ${EFFECTIVE_ATA_SQL}) eff
       LEFT JOIN master_loading_ports rp ON rp.id = COALESCE(
              s.discharge_master_port_id,
              (SELECT v.master_port_id FROM vessel_loading_ports v
                WHERE v.shipment_id = s.id AND COALESCE(v.is_discharge_port, FALSE) IS TRUE AND COALESCE(v.is_cancelled, FALSE) IS NOT TRUE AND v.master_port_id IS NOT NULL
                ORDER BY v.port_sequence DESC LIMIT 1))
      WHERE ${STO_KEY_SQL} = $1
      ORDER BY s.updated_at DESC`,
    [sto, ports],
  );
  if (rows.length === 0) console.log('   no shipment row has this STO key: the key itself changed (the Shipments page groups by another key now).');
  for (const r of rows) {
    const failed = ['c1_atc_loading', 'c2_no_discharge_ata', 'c3_status_open', 'c4_eta_arrival', 'c5_port_switched_on', 'c6_in_snapshot'].filter((k) => r[k] !== true);
    console.log(`   ${r.shipment_id || r.operation_id}: ${failed.length ? 'FAILS ' + failed.join(', ') : 'meets every condition'}`);
  }

  // the real list the sweep walks, with the cap
  let list = [];
  try {
    list = await findEligibleStos(ports, 1000);
  } catch (e) {
    console.log(`\n== sweep list: ERROR ${e.message}`);
  }
  const at = list.findIndex((e) => e.sto_key === sto);
  console.log(`\n== the sweep list (ordered by ETA, cap ${cap}): ${list.length} STOs; STO ${sto} is ${at < 0 ? 'NOT in it' : `number ${at + 1}${at + 1 > cap ? ' - BEYOND the cap, never looked at' : ' - inside the cap'}`}`);
  if (list.length) console.table(list.slice(0, 40).map((e, i) => ({ n: i + 1, sto_key: e.sto_key, eta: e.eta_discharge_arrival, vessel: e.vessel_name, port: e.port_hub_code })));

  await show(
    `instruction rows of STO ${sto}`,
    `SELECT revision, state, jps_status, left(coalesce(last_error, ''), 90) AS reason, created_at, updated_at FROM jps_shipping_instructions WHERE sto_key = $1 ORDER BY revision DESC LIMIT 6`,
    [sto],
  );

  const ids = rows.map((r) => r.shipment_uuid);
  if (ids.length) {
    await show(
      'audit log of the STO shipments, newest first (who changed what, when)',
      `SELECT a.timestamp, u.email AS by_user, a.action, a.entity_type, left(a.entity_id::text, 8) AS entity, left(coalesce(a.after_data::text, ''), 160) AS change
         FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.entity_id::text = ANY($1::text[]) ORDER BY a.timestamp DESC LIMIT 15`,
      [ids],
    );
  }
  await pool.end();
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
