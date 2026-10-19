/*
 * READ-ONLY: how many multi-PO groups would stop reading Completed if "a group is Completed only when every active member shipment is finished"?
 *
 *   cd /opt/klip && git fetch origin main --quiet && git show origin/main:docs/scripts/diag-multi-po-completed-groups.cjs | docker exec -i klip-backend node -
 *
 * Today the table reads Completed when ANY member of a group has a discharge-complete ATA (manual override, shipments column, discharge port row or JPS):
 * the list takes MAX over the group. A PO added to the operation after the voyage ended therefore rides along as Completed with 0 MT delivered
 * (operation OP-1004031313-76403194, PO 1001031718).
 *
 * Groups are approximated by operation_id, else shipment_id (the Shipments list also groups by STO; this sizes the problem, it is not the exact list grouping).
 * Per group it counts the active (not cancelled) members, how many have their OWN discharge-complete ATA, and splits the others into:
 *   LATE   - created AFTER the group's latest ATC: a PO added once the voyage was over (the case reported)
 *   EARLY  - created before it, with no ATC of its own: the ATA was probably saved on one member only (an Edit Shipment save writes one shipment),
 *            so a strict rule would wrongly un-complete these.
 */
const path = require('path');
const fs = require('fs');
const DIST = ['/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].find((p) => fs.existsSync(p));
if (!DIST) {
  console.error('no backend build found');
  process.exit(1);
}
const connection = require(path.join(DIST, 'database/connection'));
const q = (sql, params) => connection.query(sql, params).then((r) => r.rows);
const day = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '-');

(async () => {
  const rows = await q(
    `WITH m AS (
       SELECT s.id, s.status, s.created_at,
              COALESCE(NULLIF(TRIM(s.operation_id), ''), NULLIF(TRIM(s.shipment_id::text), '')) AS gkey,
              c.po_number, c.contract_id,
              COALESCE(
                sao.jps_ata_discharge_complete,
                sao.ata_discharge_complete,
                s.ata_discharge_complete,
                (SELECT MAX(v.ata_loading_completed)::date FROM vessel_loading_ports v
                  WHERE v.shipment_id = s.id AND COALESCE(v.is_discharge_port, false) = true)
              )::date AS atc
         FROM shipments s
         LEFT JOIN contracts c ON c.id = s.contract_id
         LEFT JOIN shipment_ata_overrides sao ON sao.shipment_id = s.id
        WHERE UPPER(TRIM(COALESCE(s.status, ''))) NOT IN ('CANCELLED', 'CANCELED')
     )
     SELECT gkey,
            COUNT(*)::int AS members,
            COUNT(*) FILTER (WHERE atc IS NOT NULL)::int AS with_atc,
            MAX(atc) AS group_atc,
            JSON_AGG(JSON_BUILD_OBJECT('po', po_number, 'created', created_at, 'atc', atc) ORDER BY created_at) AS detail
       FROM m
      WHERE gkey IS NOT NULL
      GROUP BY gkey
     HAVING COUNT(*) >= 2 AND COUNT(*) FILTER (WHERE atc IS NOT NULL) >= 1 AND COUNT(*) FILTER (WHERE atc IS NULL) >= 1`,
  );

  let late = 0;
  let early = 0;
  const lateGroups = [];
  const earlyGroups = [];
  for (const g of rows) {
    const atc = g.group_atc ? new Date(g.group_atc) : null;
    const lacking = g.detail.filter((d) => !d.atc);
    const lateOnes = lacking.filter((d) => atc && new Date(d.created) > atc);
    const earlyOnes = lacking.filter((d) => !(atc && new Date(d.created) > atc));
    if (lateOnes.length) {
      late += 1;
      lateGroups.push({ g, lateOnes });
    }
    if (earlyOnes.length) {
      early += 1;
      earlyGroups.push({ g, earlyOnes });
    }
  }

  console.log(`Groups with 2+ active members where some member has a discharge ATC and another has none: ${rows.length}`);
  console.log(`  with a LATE member (created after the group's ATC - the reported case): ${late}`);
  console.log(`  with an EARLY member (no ATC of its own, created before it - ATA probably saved on one member only): ${early}`);

  console.log('\nLATE members (a strict rule would, rightly, stop reading these groups as Completed):');
  for (const { g, lateOnes } of lateGroups.slice(0, 40)) {
    console.log(`  ${g.gkey}  group ATC ${day(g.group_atc)}  late: ${lateOnes.map((d) => `po ${d.po} created ${day(d.created)}`).join('; ')}`);
  }
  console.log('\nEARLY members (a strict rule would wrongly un-complete these):');
  for (const { g, earlyOnes } of earlyGroups.slice(0, 40)) {
    console.log(`  ${g.gkey}  group ATC ${day(g.group_atc)}  members ${g.members}, with ATC ${g.with_atc}; no ATC: ${earlyOnes.map((d) => `po ${d.po} created ${day(d.created)}`).join('; ')}`);
  }

  await connection.end?.();
})().catch((e) => {
  console.error('diag failed:', e);
  process.exit(1);
});
