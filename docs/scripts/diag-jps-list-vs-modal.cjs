/*
 * READ-ONLY: why the Edit Shipment modal says one Jetty Status and the Shipments table another for one STO (prod, STO 1006021140: modal Approved, table Not Sent).
 *
 *   cd /opt/klip && git fetch origin --quiet && git show origin/main:docs/scripts/diag-jps-list-vs-modal.cjs | docker exec -i -e STO=1006021140 klip-backend node -
 *
 * Both screens read jps_shipping_instructions, keyed on the STO key, picking the current row by JPS_CURRENT_ROW_ORDER_SQL; the modal derives the key per shipment with
 * shipmentListStoKeyExpr(c, l, s) (shipmentEditPayload.service.ts loadJettyStatusForShipment), the list from shipment_page.sto_key. So three things can differ:
 *  1. The instruction rows themselves (which revision, state, status, when last polled/written).
 *  2. The key: a shipment of this STO whose key is not the STO number (second voyage OP-..., a numeric shipment_id that differs) finds no row, or another row.
 *  3. Nothing in the database differs and the list is served from its in-memory cache (kept up to an hour; cleared by the JPS sweep only when a status CHANGED).
 * This prints 1 and 2; if they agree, the cause is 3.
 * Nothing is written.
 */
const path = require('path')
const dist = (p) => require(path.join(process.cwd(), 'dist', p))
const pool = dist('database/connection').default
const { shipmentListStoKeyExpr } = dist('utils/shipmentStoTypeSql')
const { JPS_CURRENT_ROW_ORDER_SQL } = dist('utils/shipmentListStoJoinSql')

const STO = String(process.env.STO || '').trim()
const q = async (sql, params = []) => (await pool.query(sql, params)).rows
const t = (v) => (v == null ? '-' : v instanceof Date ? v.toISOString().replace('T', ' ').slice(0, 19) + 'Z' : String(v))

async function section(title, fn) {
  console.log(`\n== ${title}`)
  try {
    await fn()
  } catch (e) {
    console.log('  ERROR: ' + (e && e.message ? e.message : e))
  }
}

async function main() {
  if (!STO) {
    console.log('usage: -e STO=<sto number>')
    return
  }
  console.log(`STO ${STO}`)

  await section('1. every JPS tracker row that names this STO (any key that contains it)', async () => {
    const rows = await q(
      `SELECT sto_key, revision, state, jps_status, external_reference, submitted_at, last_polled_at, updated_at, last_error
       FROM jps_shipping_instructions WHERE sto_key = $1 OR sto_key LIKE '%' || $1 || '%' ORDER BY sto_key, revision`,
      [STO],
    )
    if (!rows.length) console.log('  no row: KLIP never recorded a submission under this STO key')
    for (const r of rows) {
      console.log(`  key ${r.sto_key}  R${r.revision}  ${r.state}  jps_status=${t(r.jps_status)}  ref=${t(r.external_reference)}`)
      console.log(`      submitted ${t(r.submitted_at)}   last polled ${t(r.last_polled_at)}   updated ${t(r.updated_at)}   error ${t(r.last_error)}`)
    }
  })

  await section('2. the shipments of this STO, the key the MODAL derives for each, and the row it picks', async () => {
    const rows = await q(
      `SELECT s.id, s.status, s.shipment_id, s.operation_id, c.contract_id, c.sto_number,
              ${shipmentListStoKeyExpr('c', 'l', 's')} AS modal_key,
              (SELECT j.jps_status FROM jps_shipping_instructions j
                WHERE j.sto_key = ${shipmentListStoKeyExpr('c', 'l', 's')} AND j.state IN ('SUBMITTED','FAILED','SKIPPED_NO_CARGO')
                ORDER BY ${JPS_CURRENT_ROW_ORDER_SQL} LIMIT 1) AS modal_status,
              (SELECT j.state FROM jps_shipping_instructions j
                WHERE j.sto_key = ${shipmentListStoKeyExpr('c', 'l', 's')} AND j.state IN ('SUBMITTED','FAILED','SKIPPED_NO_CARGO')
                ORDER BY ${JPS_CURRENT_ROW_ORDER_SQL} LIMIT 1) AS modal_state
       FROM shipments s
       JOIN contracts c ON c.id = s.contract_id
       LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
       WHERE TRIM(c.sto_number::text) = $1 OR TRIM(s.shipment_id::text) = $1 OR TRIM(s.operation_id::text) = $1
       ORDER BY s.created_at`,
      [STO],
    )
    if (!rows.length) console.log('  no shipment row carries this STO number (shipment_id / operation_id / contract sto_number)')
    for (const r of rows) {
      console.log(`  shipment ${r.id}  status ${t(r.status)}  contract ${t(r.contract_id)}  contract.sto ${t(r.sto_number)}  shipment_id ${t(r.shipment_id)}  operation_id ${t(r.operation_id)}`)
      console.log(`      modal key ${t(r.modal_key)}  ->  modal reads: ${r.modal_status ? r.modal_status : r.modal_state ? '(' + r.modal_state + ')' : 'nothing (Not Sent)'}`)
    }
    const keys = [...new Set(rows.map((r) => r.modal_key))]
    console.log(`  distinct modal keys: ${keys.join(', ') || '-'}   (more than one = the rows of this STO do not share a key)`)
  })

  console.log(
    '\nHow to read it: if section 1 holds a SUBMITTED row with the status the modal shows, and every shipment in section 2 reads the same, the database agrees and the table is serving a cached page.' +
      '\nThen the next question is why the JPS sweep did not clear that cache (the clear runs only when polled.changed > 0 or something was sent).',
  )
}

main()
  .catch((e) => console.log('FATAL: ' + (e && e.message ? e.message : e)))
  .finally(() => pool.end())
