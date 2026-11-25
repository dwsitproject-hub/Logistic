/*
 * READ-ONLY: a shipment that KMAPS (or another screen) shows but the Shipments page does not. Which of the page's rules leaves it out?
 *
 *   cd /opt/klip && git fetch origin --quiet && git show origin/main:docs/scripts/diag-shipment-not-in-list.cjs | docker exec -i -e REF=MNL-60841719-9174100051 -e CONTRACT=9174100051 -e VESSEL="luminor 6" klip-backend node -
 *
 * Name the shipment by any of: REF (shipment id / operation id / STO), CONTRACT (contract number), PO. VESSEL is what was typed in the search box (optional).
 *
 * The Shipments page is a SCOPED view; KMAPS is not. These are the rules that can leave a real shipment out of the page, and each is evaluated for the shipment:
 *   1. Incoterm: only CIF / FOB / CFR contracts (effective incoterm: the contract's, else the latest SAP one). A PO of FRC / LCO belongs to the Trucking page. (shipmentIncotermScope.ts)
 *   2. Status: a CANCELLED shipment is not listed; the page's Open filter hides Completed ones.
 *   3. Period: the page's YTD range is on the CONTRACT DATE (from 1 Jan of this year), so a contract dated last year is outside it.
 *   4. Search: the box matches contract / PO / STO / operation id / vessel_name of the shipment itself (not the master vessel's name nor the vessel code KMAPS uses).
 * Nothing is written.
 */
const path = require('path')
const dist = (p) => require(path.join(process.cwd(), 'dist', p))
const pool = dist('database/connection').default
const { contractEffectiveIncotermExpr } = dist('utils/truckingIncotermScope')

const REF = String(process.env.REF || '').trim()
const CONTRACT = String(process.env.CONTRACT || '').trim()
const PO = String(process.env.PO || '').trim()
const VESSEL = String(process.env.VESSEL || '').trim()
const q = async (sql, params = []) => (await pool.query(sql, params)).rows
const t = (v) => (v == null || v === '' ? '-' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v))

;(async () => {
  if (!REF && !CONTRACT && !PO) {
    console.error('Name the shipment: -e REF=<id> and/or -e CONTRACT=<contract> and/or -e PO=<po>')
    process.exit(1)
  }
  console.log(`looking for REF "${REF || '-'}"  CONTRACT "${CONTRACT || '-'}"  PO "${PO || '-'}"   search text "${VESSEL || '-'}"`)

  const rows = await q(
    `SELECT s.id, s.status, s.shipment_id, s.operation_id, s.operation_id_source, s.vessel_name, s.vessel_code, s.port_of_loading, s.port_of_discharge,
            s.created_at, s.updated_at, s.eta_discharge_arrival,
            c.contract_id, c.po_number, c.status AS contract_status, c.contract_date, c.incoterm AS contract_incoterm,
            ${contractEffectiveIncotermExpr('c')} AS effective_incoterm,
            c.product, c.supplier, c.quantity_ordered,
            mv.vessel_name AS master_vessel_name
       FROM shipments s
       JOIN contracts c ON c.id = s.contract_id
       LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
       LEFT JOIN master_vessels mv ON mv.id = s.master_vessel_id
      WHERE ($1 <> '' AND (TRIM(s.shipment_id::text) = $1 OR TRIM(s.operation_id::text) = $1))
         OR ($2 <> '' AND TRIM(c.contract_id::text) = $2)
         OR ($3 <> '' AND TRIM(c.po_number::text) = $3)
      ORDER BY s.created_at`,
    [REF, CONTRACT, PO],
  )
  console.log(`\n== 1. shipment rows found: ${rows.length}`)
  if (!rows.length) {
    const c = await q(
      `SELECT c.contract_id, c.po_number, c.status, c.incoterm, c.contract_date FROM contracts c WHERE ($1 <> '' AND TRIM(c.contract_id::text) = $1) OR ($2 <> '' AND TRIM(c.po_number::text) = $2)`,
      [CONTRACT, PO],
    )
    console.log('  no shipment row in KLIP matches. contract rows:', c.length ? JSON.stringify(c) : 'none')
    console.log('  => the row KMAPS shows is not a shipment of the shipments table under this name; check the id KMAPS used (record id) against the partner snapshot.')
    await pool.end()
    return
  }
  const yearStart = `${new Date().getFullYear()}-01-01`
  const inScope = (inc) => ['CIF', 'FOB', 'CFR'].includes(String(inc || '').toUpperCase().trim())
  for (const r of rows) {
    console.log(`\n  shipment ${r.id}`)
    console.log(`    written    : created ${t(r.created_at)}  last updated ${r.updated_at ? new Date(r.updated_at).toISOString().replace('T', ' ').slice(0, 19) + 'Z' : '-'}`)
    console.log(`    ids        : shipment_id ${t(r.shipment_id)}  operation_id ${t(r.operation_id)} (source ${t(r.operation_id_source)})`)
    console.log(`    contract   : ${t(r.contract_id)}  PO ${t(r.po_number)}  status ${t(r.contract_status)}  date ${t(r.contract_date)}  product ${t(r.product)}  qty ${t(r.quantity_ordered)}`)
    console.log(`    vessel     : shipment "${t(r.vessel_name)}"  code ${t(r.vessel_code)}  master vessel "${t(r.master_vessel_name)}"`)
    console.log(`    route      : ${t(r.port_of_loading)} -> ${t(r.port_of_discharge)}   ETA discharge ${t(r.eta_discharge_arrival)}   status ${t(r.status)}`)
    console.log('    rules of the Shipments page:')
    const okInc = inScope(r.effective_incoterm)
    console.log(`      1. incoterm CIF/FOB/CFR : ${okInc ? 'PASS' : 'FAIL'}   (contract "${t(r.contract_incoterm)}", effective "${t(r.effective_incoterm)}")${okInc ? '' : '  <-- out of the page\'s scope; FRC / LCO belong to Trucking'}`)
    const st = String(r.status || '').toUpperCase()
    const okStatus = st !== 'CANCELLED'
    console.log(`      2. not cancelled        : ${okStatus ? 'PASS' : 'FAIL'}   (status ${t(r.status)}; the Open filter also hides Completed)`)
    const cd = r.contract_date ? new Date(r.contract_date).toISOString().slice(0, 10) : null
    const okYtd = cd == null ? null : cd >= yearStart
    console.log(`      3. YTD (contract date)  : ${okYtd == null ? 'UNKNOWN (no contract date)' : okYtd ? 'PASS' : 'FAIL'}   (contract date ${t(cd)}, YTD starts ${yearStart})${okYtd === false ? '  <-- contract dated before this year' : ''}`)
    if (VESSEL) {
      const needle = VESSEL.toLowerCase()
      const hit = (v) => String(v || '').toLowerCase().includes(needle)
      const okSearch = hit(r.vessel_name) || hit(r.contract_id) || hit(r.po_number) || hit(r.operation_id) || hit(r.shipment_id)
      console.log(`      4. search "${VESSEL}"     : ${okSearch ? 'PASS' : 'FAIL'}   (shipment vessel_name "${t(r.vessel_name)}"; the master vessel "${t(r.master_vessel_name)}" is NOT searched)${okSearch ? '' : '  <-- the page does not read the vessel from the master'}`)
    }
    const fails = [!okInc && 'incoterm', !okStatus && 'cancelled', okYtd === false && 'YTD'].filter(Boolean)
    console.log(`    => ${fails.length ? 'left out by: ' + fails.join(', ') : 'no scope rule excludes it: check the region/plant and discharge-port filters of the top bar, and the stage filter'}`)
  }
  // What happened to these rows and when: their audit trail, and the SAP imports, so a change can be told apart as a person's edit, an import, or nothing.
  const ids = rows.map((r) => String(r.id))
  console.log('\n== 2. audit log of these shipments (oldest first)')
  try {
    const audit = await q(
      `SELECT a.timestamp AS at, a.action, a.entity_id::text AS shipment, COALESCE(u.username, a.user_id::text) AS who,
              left(COALESCE(a.after_data->>'status', ''), 20) AS new_status
         FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.entity_id::text = ANY($1::text[]) ORDER BY a.timestamp DESC LIMIT 25`,
      [ids],
    )
    if (!audit.length) console.log('  no audit entry: nothing a user did, or an import did it')
    for (const a of audit.reverse()) {
      console.log(`  ${new Date(a.at).toISOString().replace('T', ' ').slice(0, 19)}  ${String(a.action).padEnd(18)} ${a.shipment.slice(0, 8)}  by ${t(a.who)}  ${a.new_status ? 'status ' + a.new_status : ''}`)
    }
  } catch (e) {
    console.log('  (audit section failed: ' + String(e && e.message ? e.message : e).slice(0, 160) + ')')
  }
  console.log('\n== 3. the latest SAP imports (when SAP data could have changed these rows)')
  try {
    const imports = await q(`SELECT status, source, file_name, import_timestamp FROM sap_data_imports ORDER BY import_timestamp DESC NULLS LAST LIMIT 6`)
    for (const i of imports) {
      console.log(`  ${i.import_timestamp ? new Date(i.import_timestamp).toISOString().replace('T', ' ').slice(0, 19) + 'Z' : '-'}  ${t(i.status).padEnd(12)} ${t(i.source).padEnd(10)} ${t(i.file_name)}`)
    }
  } catch (e) {
    console.log('  (import section failed: ' + String(e && e.message ? e.message : e).slice(0, 160) + ')')
  }
  console.log('\nHow to read it: a row cancelled or updated at the time of an import was changed by SAP; at another time, by a person (section 2 names who). A row with no change still exists, and only the page filters hid it (the Discharge Port chip of the top bar).')
  await pool.end()
})().catch((e) => {
  console.error(e && e.message ? e.message : e)
  process.exit(1)
})
