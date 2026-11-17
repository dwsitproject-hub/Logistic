/*
 * Clear discharge-port actual times that were COPIED onto the shipments of one operation, not typed. Dry run unless --apply.
 *
 *   cd /opt/klip && cat docs/scripts/repair-copied-discharge-ata.cjs | docker exec -i klip-backend node - --op=OP-1004030473-49138234
 *   cd /opt/klip && cat docs/scripts/repair-copied-discharge-ata.cjs | docker exec -i klip-backend node - --op=OP-1004030473-49138234 --apply
 *   (--only=arrival,berthed,start,complete limits it to some of the four; default is all four)
 *
 * Background. 2026-11-12: the five shipments of OP-1004030473-49138234 (manual STOs MNL-50527716-..., MT. MULIA KARSA 2) showed an ATC of 2026-09-15 nobody typed. It was the ATC of the same POs'
 * finished voyage on STO 1006019867, written into their discharge-port rows by the SAP port sync (fixed in 70e4cfd) and replicated among the operation's members. That repair cleared only the
 * ATC column. 2026-11-17: the same voyage's ATA (08-27), ATB (09-12) and ATS (09-13) were still in all five rows - two with a SAP mirror (the old sync wrote the mirror too), three without
 * (copied by the save of a member: every modal save rewrites the discharge row and fans its dates out to the whole voyage) - and a user who emptied them in Edit Shipment saw them come
 * back, because the page reads override -> shipments column -> PORT ROW and the save only emptied the override. The code now clears the lower layers when a person empties a field; this
 * repairs what is already there.
 *
 * What it touches, and nothing else - a milestone of a row is cleared only when ALL of these hold:
 *   - the shipment belongs to the operation you name, is live, and its STO is a manual one (not a number): SAP has no dates of its own for it, so a SAP mirror on it can only be borrowed;
 *   - it is the DISCHARGE-port row and holds that date;
 *   - no person wrote it: the column is not in the row's klip_edited_fields;
 *   - nothing above it holds a date for that milestone (no override, no shipments column), so the row is what the page shows.
 * Cleared: the port column and its SAP mirror. Every other date (the loading port's ATA, ETAs, quantities) stays. The statements to put the old values back are printed, with --apply,
 * before anything is written.
 */
const path = require('path')
const dist = (p) => require(path.join(process.cwd(), 'dist', p))

// label, port-row column, its SAP mirror, shipment column, override column
const MILESTONES = {
  arrival: { label: 'ATA at Discharge Port', port: 'ata_vessel_arrival', sap: 'sap_ata_vessel_arrival', ship: 'ata_discharge_arrival', sao: 'ata_discharge_arrival' },
  berthed: { label: 'ATB at Discharge Port', port: 'ata_vessel_berthed', sap: 'sap_ata_vessel_berthed', ship: 'ata_discharge_berthed', sao: 'ata_discharge_berthed' },
  start: { label: 'ATS Discharge', port: 'ata_loading_start', sap: 'sap_ata_loading_start', ship: 'ata_discharge_start', sao: 'ata_discharge_start' },
  complete: { label: 'ATC Discharge', port: 'ata_loading_completed', sap: 'sap_ata_loading_completed', ship: 'ata_discharge_complete', sao: 'ata_discharge_complete' },
}

;(async () => {
  const pool = dist('database/connection').default
  const { invalidateAfterShipmentWrite } = dist('services/shipmentWriteInvalidation.service')
  const apply = process.argv.includes('--apply')
  const arg = (name) => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
    return hit ? hit.slice(name.length + 3).trim() : ''
  }
  const op = arg('op')
  const max = arg('max') ? Number(arg('max')) : 10
  const onlyArg = arg('only')
  const keys = onlyArg ? onlyArg.split(',').map((k) => k.trim()).filter(Boolean) : Object.keys(MILESTONES)
  const bad = keys.filter((k) => !MILESTONES[k])
  if (!op) {
    console.error('Name the operation: --op=OP-...  (nothing is touched without it)')
    process.exit(1)
  }
  if (bad.length) {
    console.error(`Unknown --only value(s): ${bad.join(', ')}. Choose from: ${Object.keys(MILESTONES).join(', ')}`)
    process.exit(1)
  }

  const cols = Object.values(MILESTONES)
    .map((m) => `v.${m.port}::text AS p_${m.port}, v.${m.sap}::text AS m_${m.sap}, s.${m.ship}::text AS s_${m.ship}, sao.${m.sao}::text AS o_${m.sao}`)
    .join(',\n            ')
  const rows = (
    await pool.query(
      `SELECT v.id::text AS port_id, s.id::text AS shipment_id, c.po_number AS po, TRIM(s.shipment_id::text) AS sto, s.status, v.port_name,
            COALESCE(v.klip_edited_fields::text, '{}') AS edited,
            ${cols}
       FROM vessel_loading_ports v
       JOIN shipments s ON s.id = v.shipment_id
       JOIN contracts c ON c.id = s.contract_id
       LEFT JOIN shipment_ata_overrides sao ON sao.shipment_id = s.id
      WHERE s.operation_id = $1 AND COALESCE(v.is_discharge_port, false) AND COALESCE(v.is_cancelled, false) = false
        AND UPPER(COALESCE(s.status, '')) NOT IN ('CANCELLED', 'CANCELED')
      ORDER BY c.po_number`,
      [op],
    )
  ).rows
  console.log(`operation ${op}: ${rows.length} live discharge-port row(s); milestones: ${keys.join(', ')}\n`)
  if (rows.length === 0) {
    await pool.end()
    return
  }

  const d = (v) => (v ? String(v).slice(0, 10) : '-')
  const verdict = (r, m) => {
    if (!r[`p_${m.port}`]) return 'no date on the discharge-port row: nothing to clear'
    if (/^\d+$/.test(r.sto)) return `STO ${r.sto} is a SAP STO, not a manual one: left alone`
    if (r.edited.includes(m.port)) return 'marked as typed by a person: left alone'
    if (r[`o_${m.sao}`]) return `a person's override (${d(r[`o_${m.sao}`])}) wins over this row: left alone`
    if (r[`s_${m.ship}`]) return `the shipment's own column (${d(r[`s_${m.ship}`])}) wins over this row: left alone`
    return null
  }

  const todo = []
  for (const r of rows) {
    console.log(`PO ${r.po}  ${r.sto}  [${r.status}]  ${r.port_name || '(no port name)'}`)
    for (const key of keys) {
      const m = MILESTONES[key]
      const why = verdict(r, m)
      console.log(
        `    ${m.label.padEnd(22)} port row ${d(r[`p_${m.port}`])}  SAP mirror ${d(r[`m_${m.sap}`])}  -> ${why ? why : 'WILL BE CLEARED' + (apply ? '' : '  (dry run)')}`,
      )
      if (!why) todo.push({ row: r, m })
    }
  }
  const touchedRows = new Set(todo.map((t) => t.row.port_id)).size
  console.log(`\n${todo.length} date(s) to clear on ${touchedRows} row(s).`)
  if (todo.length > max * keys.length) {
    console.error(`More than ${max * keys.length} dates: this is not the case this script was written for. Nothing written. (Raise --max=${max} only after looking at the list.)`)
    process.exit(1)
  }
  if (!apply) {
    console.log('dry run - nothing written. Add --apply to clear them.')
    await pool.end()
    return
  }

  console.log('\nto put the old values back (keep this output):')
  for (const { row, m } of todo) {
    const port = row[`p_${m.port}`]
    const sap = row[`m_${m.sap}`]
    console.log(
      `  UPDATE vessel_loading_ports SET ${m.port} = '${String(port).slice(0, 19)}', ${m.sap} = ${sap ? `'${String(sap).slice(0, 10)}'` : 'NULL'} WHERE id = '${row.port_id}';`,
    )
  }

  const done = new Set()
  for (const { row, m } of todo) {
    const res = await pool.query(
      `UPDATE vessel_loading_ports
          SET ${m.port} = NULL, ${m.sap} = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1::uuid AND ${m.port} IS NOT NULL
          AND NOT ('${m.port}' = ANY(COALESCE(klip_edited_fields, '{}')))
        RETURNING id::text`,
      [row.port_id],
    )
    if (res.rows.length > 0) done.add(row.shipment_id)
  }
  console.log(`\ncleared dates on ${done.size} discharge-port row(s).`)
  if (done.size > 0) {
    // Fire-and-forget: it SCHEDULES the snapshot refreshes, which still need this connection; poll the stale flags and close only when they are clear.
    invalidateAfterShipmentWrite([...done])
    const staleNow = async () =>
      Number(
        (
          await pool.query(
            `SELECT (SELECT COUNT(*) FROM pipeline_summary_refresh_meta WHERE is_stale) +
                    (SELECT COUNT(*) FROM contract_performance_snapshot_meta WHERE is_stale) +
                    (SELECT COUNT(*) FROM oil_loss_snapshot_meta WHERE is_stale) AS n`,
          )
        ).rows[0].n,
      )
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    await sleep(4000)
    const deadline = Date.now() + 300000
    let clearPolls = 0
    let remaining = await staleNow()
    while (Date.now() < deadline && clearPolls < 2) {
      clearPolls = remaining === 0 ? clearPolls + 1 : 0
      if (clearPolls < 2) {
        await sleep(3000)
        remaining = await staleNow()
      }
    }
    console.log(remaining === 0 ? 'snapshots refreshed' : `${remaining} snapshot flag(s) still stale after 5 min - they rebuild on the next refresh`)
    console.log(
      'NOTE: the running backend keeps its own in-memory list caches (about an hour). They are not cleared from here - they expire on their own, or clear on the next shipment save in the app.',
    )
  }
  await pool.end()
})().catch((e) => {
  console.error(e && e.message ? e.message : e)
  process.exit(1)
})
