/*
 * READ-ONLY: B2B chains that have TWO live shipments, one on the ORIGIN (a KLIP plan) and one on the CHILD (the row SAP made when it assigned the STO).
 *
 *   cd /opt/klip && git fetch origin --quiet && git show origin/main:docs/scripts/diag-b2b-duplicate-plans.cjs | docker exec -i klip-backend node -
 *   optional: -e SHOW=30 (rows to print, default 15)
 *
 * Seen 2026-11-25 on production: MT. ARCADIA, PO 9141001942, listed twice on the Shipments page: one row with STO 1006021152 (the child's SAP row) and one without STO (a KLIP plan on the ORIGIN
 * contract 9144101942). SAP assigns the STO to the CHILD (1004033142). The override that lets SAP take over a KLIP-planned shipment (klipLogisticsActivity.ts findKlipPlannedStoSupersedeCandidate,
 * called from sapDataDistribution.service.ts upsertShipment) looks for the plan only among the shipments of the contract of the SAP row, which is the child, so a plan on the origin is never found
 * and SAP inserts a second shipment. This counts how many chains are in that state, so the size of the problem is known before the fix is chosen.
 *
 * Reading the result: a pair is a LIKELY DUPLICATE when the origin's shipment has no STO (an operation id of KLIP) and carries the same vessel as the child's shipment.
 * Nothing is written.
 */
const path = require('path')
const dist = (p) => require(path.join(process.cwd(), 'dist', p))
const pool = dist('database/connection').default

const SHOW = Math.max(0, Number(process.env.SHOW || 15))
const q = async (sql, params = []) => (await pool.query(sql, params)).rows
const t = (v) => (v == null || v === '' ? '-' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v))
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

;(async () => {
  const pairs = await q(
    `WITH pairs AS (
       SELECT c.contract_id AS child, c.id AS child_uuid, oc.contract_id AS origin, oc.id AS origin_uuid, NULLIF(TRIM(oc.po_number::text), '') AS origin_po
         FROM contracts c
         JOIN contract_latest_spd_snapshot chb
           ON chb.contract_number = c.contract_id AND UPPER(COALESCE(chb.b2b_flag_raw, '')) = 'B2B' AND NULLIF(TRIM(chb.contract_reference_po_raw), '') IS NOT NULL
         JOIN contracts oc ON TRIM(oc.po_number::text) = TRIM(chb.contract_reference_po_raw) AND oc.contract_id <> c.contract_id
     )
     SELECT p.child, p.origin, p.origin_po,
            cs.id AS child_ship, cs.status AS child_status, cs.shipment_id AS child_sto, cs.vessel_name AS child_vessel, cs.created_at AS child_created,
            os.id AS origin_ship, os.status AS origin_status, os.shipment_id AS origin_sid, os.operation_id AS origin_op, os.vessel_name AS origin_vessel, os.created_at AS origin_created,
            os.port_of_loading AS origin_pol, os.port_of_discharge AS origin_pod, cs.port_of_loading AS child_pol, cs.port_of_discharge AS child_pod
       FROM pairs p
       JOIN shipments cs ON cs.contract_id = p.child_uuid AND UPPER(COALESCE(cs.status, '')) <> 'CANCELLED'
       JOIN shipments os ON os.contract_id = p.origin_uuid AND UPPER(COALESCE(os.status, '')) <> 'CANCELLED'
      ORDER BY os.created_at DESC`,
  )
  const withKind = pairs.map((r) => ({
    ...r,
    originHasSto: /^[0-9]+$/.test(String(r.origin_sid || '').trim()),
    sameVessel: norm(r.origin_vessel) !== '' && norm(r.origin_vessel) === norm(r.child_vessel),
  }))
  const likely = withKind.filter((r) => !r.originHasSto && r.sameVessel)
  const planNoStoOtherVessel = withKind.filter((r) => !r.originHasSto && !r.sameVessel)
  const bothSto = withKind.filter((r) => r.originHasSto)

  console.log('== 1. B2B chains with a live shipment on BOTH the origin and the child')
  console.log(`  ${withKind.length} (origin shipment, child shipment) pair(s)`)
  console.log(`  LIKELY DUPLICATE (the origin one has no STO, same vessel as the child's) : ${likely.length}`)
  console.log(`  the origin one has no STO, another vessel (a different voyage, probably real) : ${planNoStoOtherVessel.length}`)
  console.log(`  the origin one has an STO of its own : ${bothSto.length}`)

  const chainsWithChildShip = await q(
    `SELECT count(DISTINCT c.id)::int AS n
       FROM contracts c
       JOIN contract_latest_spd_snapshot chb ON chb.contract_number = c.contract_id AND UPPER(COALESCE(chb.b2b_flag_raw, '')) = 'B2B' AND NULLIF(TRIM(chb.contract_reference_po_raw), '') IS NOT NULL
       JOIN shipments s ON s.contract_id = c.id AND UPPER(COALESCE(s.status, '')) <> 'CANCELLED'`,
  )
  console.log(`\n== 2. for scale: B2B children that have a live shipment at all: ${chainsWithChildShip[0].n}`)

  if (SHOW > 0) {
    console.log(`\n== 3. examples, likely duplicates first (newest ${SHOW})`)
    const ordered = [...likely, ...planNoStoOtherVessel, ...bothSto].slice(0, SHOW)
    for (const r of ordered) {
      const tag = !r.originHasSto && r.sameVessel ? 'LIKELY DUPLICATE' : !r.originHasSto ? 'other vessel    ' : 'origin has STO  '
      console.log(`  ${tag}  PO ${t(r.origin_po)}  origin ${r.origin} [${t(r.origin_status)}] ${t(r.origin_sid)} / ${t(r.origin_op)}  "${t(r.origin_vessel)}"  ${t(r.origin_pol)} -> ${t(r.origin_pod)}  created ${t(r.origin_created)}`)
      console.log(`  ${' '.repeat(16)}  child  ${r.child} [${t(r.child_status)}] STO ${t(r.child_sto)}  "${t(r.child_vessel)}"  ${t(r.child_pol)} -> ${t(r.child_pod)}  created ${t(r.child_created)}`)
    }
  }
  console.log('\nHow to read it: LIKELY DUPLICATE rows are the pattern of MT. ARCADIA. Zero = a one-off; many = every B2B plan that SAP later gives an STO is doubled, and the override has to look on the origin.')
  await pool.end()
})().catch((e) => {
  console.error(e && e.message ? e.message : e)
  process.exit(1)
})
