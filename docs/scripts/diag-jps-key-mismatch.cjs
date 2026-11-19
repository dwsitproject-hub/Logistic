/*
 * READ-ONLY: which shipments show a different Jetty Status in the Shipments TABLE than in the Edit Shipment MODAL, because the table looked the tracker up under another key.
 *
 *   cd /opt/klip && git fetch origin --quiet && git show origin/main:docs/scripts/diag-jps-key-mismatch.cjs | docker exec -i klip-backend node -
 *   (on SIT use origin/SIT; add -e SHOW=20 for more example rows)
 *
 * The table groups its rows by shipmentListSeaStoKeyExpr; JPS, its tracker rows and the modal use shipmentListStoKeyExpr (the STO number). They agree for most shipments. They differ for a
 * FOB shipment with a vessel whose Operation ID was made by KLIP (OP-<contract>-<random>, not a SAP import shell): the table's key is that OP- id. Before the fix of 2026-11-19 the table looked the
 * tracker up by its own key only, so such a shipment, once submitted, read "Not Sent" in the table while the modal said what JPS said.
 *
 * Prints: 1. how many live shipments have two different keys, 2. how many of them have a tracker row under the JPS key (those showed the wrong status in the table),
 * 3. examples with the operation id and where it came from. Nothing is written.
 */
const path = require('path')
const dist = (p) => require(path.join(process.cwd(), 'dist', p))
const pool = dist('database/connection').default
const { shipmentListSeaStoKeyExpr, shipmentListStoKeyExpr } = dist('utils/shipmentStoTypeSql')

const SHOW = Math.max(0, Number(process.env.SHOW || 10))
const q = async (sql, params = []) => (await pool.query(sql, params)).rows
const t = (v) => (v == null || v === '' ? '-' : String(v))

;(async () => {
  const listKey = shipmentListSeaStoKeyExpr('c', 'l', 's')
  const jpsKey = shipmentListStoKeyExpr('c', 'l', 's')
  const base = `FROM shipments s JOIN contracts c ON c.id = s.contract_id LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
                WHERE UPPER(COALESCE(s.status, '')) <> 'CANCELLED'`

  const [summary] = await q(
    `SELECT count(*)::int AS live,
            count(*) FILTER (WHERE ${listKey} IS DISTINCT FROM ${jpsKey})::int AS differ,
            count(*) FILTER (WHERE ${listKey} IS DISTINCT FROM ${jpsKey}
                              AND EXISTS (SELECT 1 FROM jps_shipping_instructions j WHERE j.sto_key = ${jpsKey} AND j.state IN ('SUBMITTED', 'FAILED', 'SKIPPED_NO_CARGO')))::int AS differ_with_tracker,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM jps_shipping_instructions j WHERE j.sto_key = ${jpsKey} AND j.state = 'SUBMITTED'))::int AS submitted_all
       ${base}`,
  )
  console.log('== 1. live shipments, and how many have a table key different from the JPS key')
  console.log(`  ${summary.live} live shipments; ${summary.differ} have two different keys`)
  console.log('\n== 2. of those, how many HAVE a tracker row under the JPS key (these read "Not Sent" in the table before the fix)')
  console.log(`  ${summary.differ_with_tracker} of ${summary.differ}   (all live shipments with a SUBMITTED row: ${summary.submitted_all})`)

  console.log('\n== 3. where the Operation ID of those shipments comes from (operation_id_source)')
  const bySource = await q(
    `SELECT COALESCE(s.operation_id_source, '(none)') AS src, count(*)::int AS n
       ${base} AND ${listKey} IS DISTINCT FROM ${jpsKey} GROUP BY 1 ORDER BY 2 DESC`,
  )
  for (const r of bySource) console.log(`  ${r.src.padEnd(14)} ${String(r.n).padStart(5)}`)

  if (SHOW > 0) {
    console.log(`\n== 4. examples (newest ${SHOW}), the ones with a tracker row first`)
    const rows = await q(
      `SELECT s.id, s.status, s.shipment_id, s.operation_id, s.operation_id_source, ${listKey} AS list_key, ${jpsKey} AS jps_key,
              (SELECT string_agg(DISTINCT COALESCE(j.jps_status, j.state), ',') FROM jps_shipping_instructions j WHERE j.sto_key = ${jpsKey} AND j.state IN ('SUBMITTED', 'FAILED', 'SKIPPED_NO_CARGO')) AS tracker
         ${base} AND ${listKey} IS DISTINCT FROM ${jpsKey}
        ORDER BY (EXISTS (SELECT 1 FROM jps_shipping_instructions j WHERE j.sto_key = ${jpsKey})) DESC, s.created_at DESC LIMIT ${SHOW}`,
    )
    for (const r of rows) console.log(`  ${r.id}  ${t(r.status).padEnd(10)} table key ${t(r.list_key).padEnd(24)} JPS key ${t(r.jps_key).padEnd(14)} op ${t(r.operation_id)} (${t(r.operation_id_source)})  tracker ${t(r.tracker)}`)
  }

  console.log('\nHow to read it: section 2 is how many rows had the wrong Jetty Status in the table. Zero on SIT means no shipment there has the shape, which is why it did not show up.')
  await pool.end()
})().catch((e) => {
  console.error(e && e.message ? e.message : e)
  process.exit(1)
})
