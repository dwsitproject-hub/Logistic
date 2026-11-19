/*
 * READ-ONLY: where does an STO that KLIP shows come from, when the SAP data has none? (STO 1006021152, 2026-11-19: SAP Logistics data has the STO No column EMPTY for PO 9141001942 / 1001033142.)
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-sto-source.cjs | docker exec -i -e STO=1006021152 klip-backend node -
 *   optional: -e CONTRACTS=9144101942,1004033142   (also read what SAP holds for these contracts)
 *
 * An STO number can reach KLIP four ways: a SAP import (sap_processed_data.sto_number, then contract_stos by the distribution step), a person typing it on the shipment
 * (shipments.shipment_id), a user link made by Add PO (user_sto_contract_assignments), or a contract merge. This prints each place that holds this STO, with when it was written,
 * so the first one in time is the origin. Nothing is written.
 */
const path = require('path')
const dist = (p) => require(path.join(process.cwd(), 'dist', p))
const pool = dist('database/connection').default

const STO = String(process.env.STO || '').trim()
const CONTRACTS = String(process.env.CONTRACTS || '').split(',').map((s) => s.trim()).filter(Boolean)
const q = async (sql, params = []) => (await pool.query(sql, params)).rows
const t = (v) => (v == null || v === '' ? '-' : v instanceof Date ? v.toISOString().replace('T', ' ').slice(0, 19) + 'Z' : String(v))

async function section(title, fn) {
  console.log(`\n== ${title}`)
  try {
    await fn()
  } catch (e) {
    console.log('  (this section failed: ' + String(e && e.message ? e.message : e).slice(0, 240) + ')')
  }
}

;(async () => {
  if (!STO) {
    console.error('Name the STO: -e STO=1006021152')
    process.exit(1)
  }
  console.log(`STO ${STO}${CONTRACTS.length ? `   contracts ${CONTRACTS.join(', ')}` : ''}`)

  let shipmentIds = []
  await section('1. shipments that carry it (shipment_id or operation_id)', async () => {
    const rows = await q(
      `SELECT s.id, s.status, s.shipment_id, s.operation_id, s.operation_id_source, s.created_at, c.contract_id, c.po_number
         FROM shipments s JOIN contracts c ON c.id = s.contract_id
        WHERE TRIM(s.shipment_id::text) = $1 OR NULLIF(TRIM(s.operation_id::text), '') = $1 ORDER BY s.created_at`,
      [STO],
    )
    if (!rows.length) console.log('  none')
    for (const r of rows) console.log(`  ${r.id}  ${t(r.status)}  contract ${t(r.contract_id)} PO ${t(r.po_number)}  shipment_id ${t(r.shipment_id)}  operation_id ${t(r.operation_id)} (source ${t(r.operation_id_source)})  created ${t(r.created_at)}`)
    shipmentIds = rows.map((r) => String(r.id))
  })

  await section('2. who created or changed those shipments (audit log, oldest first)', async () => {
    if (!shipmentIds.length) return console.log('  (no shipment)')
    const rows = await q(
      `SELECT a.timestamp AS at, a.action, a.entity_type, COALESCE(u.username, a.user_id::text) AS who
         FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.entity_id::text = ANY($1::text[]) ORDER BY a.timestamp LIMIT 12`,
      [shipmentIds],
    )
    if (!rows.length) console.log('  no audit entry for them')
    for (const r of rows) console.log(`  ${t(r.at)}  ${t(r.action)}  ${t(r.entity_type)}  by ${t(r.who)}`)
  })

  await section('3. contract_stos rows with this STO (the link the PO table and JPS read)', async () => {
    const rows = await q(
      `SELECT c.contract_id, c.po_number, cs.sto_number, cs.sto_quantity, cs.sto_type, cs.created_at
         FROM contract_stos cs JOIN contracts c ON c.id = cs.contract_id WHERE TRIM(cs.sto_number::text) = $1 ORDER BY cs.created_at`,
      [STO],
    )
    if (!rows.length) console.log('  none')
    for (const r of rows) console.log(`  contract ${t(r.contract_id)} PO ${t(r.po_number)}  qty ${t(r.sto_quantity)}  type ${t(r.sto_type)}  created ${t(r.created_at)}`)
  })

  await section('4. SAP rows that name this STO (sap_processed_data, with the import they came from)', async () => {
    const rows = await q(
      `SELECT spd.contract_number, count(*)::int AS n, min(spd.created_at) AS first_at, max(spd.created_at) AS last_at, array_agg(DISTINCT i.file_name) AS files
         FROM sap_processed_data spd LEFT JOIN sap_data_imports i ON i.id = spd.import_id
        WHERE TRIM(spd.sto_number::text) = $1 GROUP BY spd.contract_number ORDER BY 1`,
      [STO],
    )
    if (!rows.length) console.log('  NO SAP row names this STO: KLIP holds it without SAP')
    for (const r of rows) console.log(`  contract ${t(r.contract_number)}  ${r.n} row(s)  ${t(r.first_at)} .. ${t(r.last_at)}  files ${(r.files || []).filter(Boolean).join(' | ') || '-'}`)
  })

  await section('5. Add PO links under this STO (user_sto_contract_assignments)', async () => {
    const rows = await q(`SELECT contract_number, sto_qty_assigned, created_at FROM user_sto_contract_assignments WHERE TRIM(sto_number::text) = $1 ORDER BY created_at`, [STO])
    if (!rows.length) console.log('  none')
    for (const r of rows) console.log(`  contract ${t(r.contract_number)}  qty assigned ${t(r.sto_qty_assigned)}  created ${t(r.created_at)}`)
  })

  if (CONTRACTS.length) {
    await section('6. what SAP holds for the contracts you named (STO column as imported)', async () => {
      const rows = await q(
        `SELECT spd.contract_number, COALESCE(NULLIF(TRIM(spd.sto_number::text), ''), '(empty)') AS sto, count(*)::int AS n, max(spd.created_at) AS last_at
           FROM sap_processed_data spd WHERE spd.contract_number = ANY($1::text[]) GROUP BY 1, 2 ORDER BY 1, 2`,
        [CONTRACTS],
      )
      if (!rows.length) console.log('  no SAP row for these contracts')
      for (const r of rows) console.log(`  contract ${t(r.contract_number)}  STO ${r.sto}  ${r.n} row(s)  last ${t(r.last_at)}`)
    })
  }

  console.log('\nHow to read it: section 4 empty and a shipment in section 1 = the STO was typed in KLIP (a manual shipment), not imported. Section 3 with a created time that matches no SAP import = KLIP made that link. The earliest time across sections 1-5 is the origin.')
  await pool.end()
})().catch((e) => {
  console.error(e && e.message ? e.message : e)
  process.exit(1)
})
