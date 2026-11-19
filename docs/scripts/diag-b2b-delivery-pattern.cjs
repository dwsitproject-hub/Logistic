/*
 * READ-ONLY: in a B2B chain (an ORIGIN contract and its CHILD that share an STO), which of the two does SAP book the STO's Delivery / Receive on?
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-b2b-delivery-pattern.cjs | docker exec -i klip-backend node -
 *   optional: -e LIMIT=300 (pairs to measure, default 400)   -e CLOSED=1 (only STOs whose shipments are all COMPLETED)   -e SHOW=15 (sample rows per pattern, default 8)
 *
 * Asked 2026-11-19 (STO 1006021152: origin 9144101942 + child 1004033142, one cargo of 4,495 MT, two PO rows in the Edit Shipment modal). The decision is where Delivered Qty (Klip) is entered and what the
 * Submit to Jetty email lists, and that depends on how SAP itself books a chain: on the child, on the origin, on both (the same cargo twice, which must NOT be added), or on neither.
 *
 * For every (STO, child, origin) found in sap_processed_data (the child's B2B flag and Contract Reff PO pointing at the origin's PO), the STO-scoped Delivery and Receive of each contract is read the way
 * the modal and Oil Loss read them (sqlStoScopedDeliveredKgSql / sqlStoScopedReceiveKgSql). Patterns: CHILD ONLY, ORIGIN ONLY, BOTH SAME (within 1 kg or 0.5%), BOTH DIFFERENT, NEITHER.
 * Writes nothing. Each pair runs the SAP lookup twice, so a large database takes a while: LIMIT bounds it.
 */
const path = require('path')
const dist = (p) => require(path.join(process.cwd(), 'dist', p))
const pool = dist('database/connection').default
const { sqlStoScopedDeliveredKgSql, sqlStoScopedReceiveKgSql } = dist('utils/contractLogisticsStoDetailSql')

const LIMIT = Math.max(1, Number(process.env.LIMIT || 400))
const SHOW = Math.max(0, Number(process.env.SHOW || 8))
const CLOSED = process.env.CLOSED === '1'
const q = async (sql, params = []) => (await pool.query(sql, params)).rows
const n = (v) => (v == null || v === '' ? null : Number(v))
const mt = (kg) => (kg == null ? '-' : (Number(kg) / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 }))

function pattern(childKg, originKg) {
  const c = childKg != null && childKg > 0
  const o = originKg != null && originKg > 0
  if (c && !o) return 'CHILD ONLY'
  if (!c && o) return 'ORIGIN ONLY'
  if (!c && !o) return 'NEITHER'
  const diff = Math.abs(childKg - originKg)
  return diff <= 1 || diff <= 0.005 * Math.max(childKg, originKg) ? 'BOTH SAME' : 'BOTH DIFFERENT'
}

;(async () => {
  console.log(`B2B chains in SAP: where the STO's Delivery / Receive is booked   (LIMIT ${LIMIT}${CLOSED ? ', closed STOs only' : ''})`)

  const dOpts = (alias) => ({ contractNumberExpr: `${alias}.contract_id`, contractQtyExpr: `COALESCE(${alias}.quantity_ordered, 0)`, stoKeyExpr: 'p.sto', poNumberExpr: `${alias}.po_number`, incotermExpr: `${alias}.incoterm` })
  const rows = await q(
    `WITH carriers AS (
       SELECT DISTINCT TRIM(spd.sto_number::text) AS sto, spd.contract_number
         FROM sap_processed_data spd
        WHERE NULLIF(TRIM(spd.sto_number::text), '') IS NOT NULL AND spd.contract_number IS NOT NULL
     ),
     children AS (
       SELECT ca.sto, ca.contract_number AS child, TRIM(l.contract_reference_po_raw) AS origin_po
         FROM carriers ca JOIN contract_latest_spd_snapshot l ON l.contract_number = ca.contract_number
        WHERE UPPER(COALESCE(l.b2b_flag_raw, '')) = 'B2B' AND NULLIF(TRIM(l.contract_reference_po_raw), '') IS NOT NULL
     ),
     pairs AS (
       SELECT ch.sto, ch.child, oc.contract_id AS origin
         FROM children ch JOIN contracts oc ON TRIM(oc.po_number::text) = ch.origin_po AND oc.contract_id <> ch.child
     ),
     pairs_closed AS (
       SELECT p.* FROM pairs p
        WHERE ${CLOSED ? `EXISTS (SELECT 1 FROM shipments s WHERE (TRIM(s.shipment_id::text) = p.sto OR NULLIF(TRIM(s.operation_id::text), '') = p.sto))
          AND NOT EXISTS (SELECT 1 FROM shipments s WHERE (TRIM(s.shipment_id::text) = p.sto OR NULLIF(TRIM(s.operation_id::text), '') = p.sto) AND COALESCE(s.status, '') NOT IN ('COMPLETED', 'CANCELLED'))` : 'TRUE'}
        ORDER BY p.sto DESC, p.child
        LIMIT ${LIMIT}
     )
     SELECT p.sto, p.child, p.origin, cc.incoterm AS child_incoterm, oc.incoterm AS origin_incoterm,
            (SELECT string_agg(DISTINCT COALESCE(s.status, '?'), ',') FROM shipments s WHERE (TRIM(s.shipment_id::text) = p.sto OR NULLIF(TRIM(s.operation_id::text), '') = p.sto)) AS ship_status,
            ${sqlStoScopedDeliveredKgSql(dOpts('cc'))} AS child_delivered,
            ${sqlStoScopedReceiveKgSql({ ...dOpts('cc'), incotermExpr: undefined })} AS child_received,
            ${sqlStoScopedDeliveredKgSql(dOpts('oc'))} AS origin_delivered,
            ${sqlStoScopedReceiveKgSql({ ...dOpts('oc'), incotermExpr: undefined })} AS origin_received,
            EXISTS (SELECT 1 FROM sap_processed_data x WHERE x.contract_number = oc.contract_id AND TRIM(x.sto_number::text) = p.sto) AS origin_names_sto
       FROM pairs_closed p
       JOIN contracts cc ON cc.contract_id = p.child
       JOIN contracts oc ON oc.contract_id = p.origin
      ORDER BY p.sto DESC, p.child`,
  )

  console.log(`\n${rows.length} (STO, child, origin) pair(s) measured`)
  const withP = rows.map((r) => ({ ...r, dPattern: pattern(n(r.child_delivered), n(r.origin_delivered)), rPattern: pattern(n(r.child_received), n(r.origin_received)) }))

  const tally = (key) => {
    const m = new Map()
    for (const r of withP) m.set(r[key], (m.get(r[key]) || 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }
  console.log('\n== 1. where SAP books the DELIVERY')
  for (const [k, v] of tally('dPattern')) console.log(`  ${k.padEnd(15)} ${String(v).padStart(5)}  ${((v / Math.max(1, withP.length)) * 100).toFixed(1)}%`)
  console.log('\n== 2. where SAP books the RECEIVE')
  for (const [k, v] of tally('rPattern')) console.log(`  ${k.padEnd(15)} ${String(v).padStart(5)}  ${((v / Math.max(1, withP.length)) * 100).toFixed(1)}%`)

  console.log('\n== 3. Delivery pattern by incoterm of the CHILD')
  const byInc = new Map()
  for (const r of withP) {
    const k = `${String(r.child_incoterm || '-').toUpperCase()} / ${r.dPattern}`
    byInc.set(k, (byInc.get(k) || 0) + 1)
  }
  for (const [k, v] of [...byInc.entries()].sort()) console.log(`  ${k.padEnd(28)} ${String(v).padStart(5)}`)

  console.log('\n== 4. does SAP name the STO on the ORIGIN contract at all?')
  const names = withP.filter((r) => r.origin_names_sto).length
  console.log(`  the origin has a SAP row with this STO in ${names} of ${withP.length} pairs; in the other ${withP.length - names} the STO is carried by the child alone`)

  console.log('\n== 5. the shipment status of the STO, by Delivery pattern')
  const byStatus = new Map()
  for (const r of withP) {
    const k = `${String(r.ship_status || 'no shipment')} / ${r.dPattern}`
    byStatus.set(k, (byStatus.get(k) || 0) + 1)
  }
  for (const [k, v] of [...byStatus.entries()].sort()) console.log(`  ${k.padEnd(34)} ${String(v).padStart(5)}`)

  if (SHOW > 0) {
    console.log(`\n== 6. examples (up to ${SHOW} per Delivery pattern)`)
    const seen = new Map()
    for (const r of withP) {
      const k = r.dPattern
      const c = seen.get(k) || 0
      if (c >= SHOW) continue
      seen.set(k, c + 1)
      console.log(`  ${k.padEnd(14)} STO ${r.sto}  child ${r.child} ${mt(r.child_delivered).padStart(9)} MT / rec ${mt(r.child_received).padStart(9)}   origin ${r.origin} ${mt(r.origin_delivered).padStart(9)} MT / rec ${mt(r.origin_received).padStart(9)}   [${r.ship_status || '-'}] ${String(r.child_incoterm || '-')}`)
    }
  }

  console.log('\nHow to read it: CHILD ONLY everywhere = SAP books the chain on the child and the origin only rides along (the origin must show the child\'s figure, never add to it). BOTH SAME = the same cargo is booked on both (adding them doubles it).')
  await pool.end()
})().catch((e) => {
  console.error(e && e.message ? e.message : e)
  process.exit(1)
})
