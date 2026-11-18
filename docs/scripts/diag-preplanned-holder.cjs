/*
 * READ-ONLY: who holds a PO in a Preplanned group, and why the Shipments page still offers it for grouping.
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-preplanned-holder.cjs | docker exec -i -e PO=1001030838,1001030130,1001031132,1001031288,1001032471 klip-backend node -
 *
 * Why it exists (2026-11-18, Yohan, Bontang): selecting five POs in Shipments and pressing "Creating..." answered
 *   "PO 1001030838 is already in Preplanned group PPM-BONTAN-023 (ACCEPTED); PO 1001031130 is already in ... PP-BONTAN-175 (SUGGESTED); ..."
 * The manual grouping first checks the rule the Unplanned card uses (contractBacklogCoreWhereSql) and only refuses a PO that sits in an ACCEPTED group with NO shipment link.
 * An ACCEPTED group that IS linked to a shipment (linkAcceptedPrePlannedGroupsForContracts links the WHOLE group when a shipment is made for ANY member) does not count there, so a member
 * without a shipment of its own shows as Unplanned, passes the check, and then hits the partial unique index ux_ppgm_active_contract. SUGGESTED holders are released by the same save,
 * but the message lists every active holder after the rollback, so the SUGGESTED ones look like blockers although they are not.
 *
 * Per PO this prints every ACTIVE membership (group, status, source, the shipment the group is linked to and its status, how many members the group has and how many of them have a live
 * shipment of their own), the PO's own shipments, and a verdict: which of the holders blocks the manual grouping and which one the save would release by itself.
 * Nothing is written to the database or to a file.
 */
const path = require('path')
const pool = require(path.join(process.cwd(), 'dist', 'database', 'connection')).default

const POS = String(process.env.PO || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const q = async (sql, params = []) => (await pool.query(sql, params)).rows
const CANCELLED = (alias) => `UPPER(TRIM(COALESCE(${alias}.status, ''))) IN ('CANCELLED', 'CANCELED')`

;(async () => {
  if (POS.length === 0) {
    console.error('Name the POs: -e PO=1001030838,1001031130 (po_number or contract number)')
    process.exit(1)
  }
  const contracts = await q(
    `SELECT c.id::text AS id, c.contract_id AS contract, c.po_number AS po, c.status, c.supplier, c.product
       FROM contracts c WHERE c.po_number = ANY($1::text[]) OR c.contract_id = ANY($1::text[]) ORDER BY c.po_number`,
    [POS],
  )
  console.log(`${contracts.length} of ${POS.length} PO(s) found\n`)

  for (const c of contracts) {
    console.log(`PO ${c.po}  contract ${c.contract}  [${c.status}]  ${c.supplier || ''}  ${c.product || ''}`)
    const own = await q(
      `SELECT TRIM(s.shipment_id::text) AS sto, s.status, s.operation_id, s.vessel_name FROM shipments s WHERE s.contract_id = $1::uuid ORDER BY s.created_at`,
      [c.id],
    )
    console.log(`  own shipments: ${own.length === 0 ? '(none)' : ''}`)
    for (const s of own) console.log(`    ${String(s.sto).padEnd(28)} ${String(s.status || '').padEnd(10)} ${s.operation_id || '-'}  ${s.vessel_name || ''}`)
    const liveOwn = own.filter((s) => !/^CANCEL/i.test(String(s.status || '')) && String(s.status || '').toUpperCase() !== 'UNPLANNED').length

    const holds = await q(
      `SELECT pg.id::text AS gid, pg.group_code, pg.status, pg.source, pg.shipment_id::text AS linked_id, pgm.created_at::text AS since,
              ls.status AS linked_status, TRIM(ls.shipment_id::text) AS linked_sto, ls.operation_id AS linked_op,
              (SELECT count(*) FROM pre_planned_group_members m WHERE m.group_id = pg.id AND m.released_at IS NULL)::int AS members,
              (SELECT count(*) FROM pre_planned_group_members m
                WHERE m.group_id = pg.id AND m.released_at IS NULL
                  AND EXISTS (SELECT 1 FROM shipments x WHERE x.contract_id = m.contract_id AND UPPER(TRIM(COALESCE(x.status, ''))) NOT IN ('CANCELLED', 'CANCELED', 'UNPLANNED')))::int AS members_with_shipment
         FROM pre_planned_group_members pgm
         JOIN pre_planned_groups pg ON pg.id = pgm.group_id
         LEFT JOIN shipments ls ON ls.id = pg.shipment_id
        WHERE pgm.contract_id = $1::uuid AND pgm.released_at IS NULL
        ORDER BY pg.status, pg.group_code`,
      [c.id],
    )
    console.log(`  active Preplanned membership(s): ${holds.length === 0 ? '(none)' : ''}`)
    for (const h of holds) {
      let verdict
      if (['SUGGESTED', 'SUPERSEDED', 'DISMISSED'].includes(h.status)) verdict = 'released automatically by the manual grouping (NOT the blocker)'
      else if (h.status === 'ACCEPTED' && !h.linked_id) verdict = 'BLOCKS, and the Unplanned rule already hides this PO from grouping (an unlinked ACCEPTED group is Preplanned)'
      else if (h.status === 'ACCEPTED' && /^CANCEL/i.test(String(h.linked_status || ''))) verdict = liveOwn === 0 ? 'released automatically (its shipment is cancelled and the PO has no live shipment)' : 'BLOCKS: its shipment is cancelled but the PO has a live shipment of its own'
      else if (h.status === 'ACCEPTED') verdict = liveOwn === 0 ? 'BLOCKS - THE CASE: a group linked to a live shipment of ANOTHER member holds a PO that has no shipment of its own, so the page lists it as Unplanned' : 'BLOCKS: the group is linked to a live shipment and the PO has a shipment of its own'
      else verdict = 'unknown status'
      console.log(
        `    ${h.group_code.padEnd(18)} ${String(h.status).padEnd(10)} ${String(h.source || '').padEnd(7)} since ${String(h.since).slice(0, 10)}  linked shipment: ${h.linked_id ? `${h.linked_sto} [${h.linked_status}] ${h.linked_op || ''}` : '(none)'}  members ${h.members}, with a live shipment of their own ${h.members_with_shipment}`,
      )
      console.log(`        -> ${verdict}`)
    }
    console.log('')
  }

  // The size of the pattern: ACCEPTED groups linked to a live/completed shipment whose active members include one WITHOUT a live shipment of its own.
  const pattern = await q(
    `SELECT pg.group_code, pg.status, TRIM(ls.shipment_id::text) AS linked_sto, ls.status AS linked_status,
            count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM shipments x WHERE x.contract_id = m.contract_id AND UPPER(TRIM(COALESCE(x.status, ''))) NOT IN ('CANCELLED', 'CANCELED', 'UNPLANNED')))::int AS members_without_shipment,
            count(*)::int AS members
       FROM pre_planned_groups pg
       JOIN pre_planned_group_members m ON m.group_id = pg.id AND m.released_at IS NULL
       JOIN shipments ls ON ls.id = pg.shipment_id
      WHERE pg.status = 'ACCEPTED' AND UPPER(TRIM(COALESCE(ls.status, ''))) NOT IN ('CANCELLED', 'CANCELED')
      GROUP BY pg.id, pg.group_code, pg.status, ls.shipment_id, ls.status
     HAVING count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM shipments x WHERE x.contract_id = m.contract_id AND UPPER(TRIM(COALESCE(x.status, ''))) NOT IN ('CANCELLED', 'CANCELED', 'UNPLANNED'))) > 0
      ORDER BY members_without_shipment DESC, pg.group_code
      LIMIT 40`,
  )
  const total = pattern.reduce((sum, r) => sum + r.members_without_shipment, 0)
  console.log(`PATTERN on this database: ${pattern.length} ACCEPTED group(s) linked to a live or completed shipment still hold ${total} PO(s) that have no live shipment of their own (each such PO is listed as Unplanned and cannot be grouped by hand):`)
  for (const r of pattern) console.log(`  ${String(r.group_code).padEnd(18)} linked ${String(r.linked_sto).padEnd(26)} [${r.linked_status}]  members without a shipment ${r.members_without_shipment} of ${r.members}`)
  await pool.end()
})().catch((e) => {
  console.error(e && e.message ? e.message : e)
  process.exit(1)
})
