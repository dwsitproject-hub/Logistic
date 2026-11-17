/*
 * READ-ONLY: where do the discharge-port ACTUAL times of an operation come from, layer by layer - and which other shipments on the server look the same?
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-discharge-ata-layers.cjs | docker exec -i -e OP=OP-1004030473-49138234 klip-backend node -
 *   (add -e SCAN=1 to also scan the whole database for the same pattern)
 *
 * Edit Shipment shows ATA at Discharge Port / ATB at Discharge Port / ATS Discharge / ATC Discharge as the FIRST value that exists in:
 *   JPS (while the shipment is open)  ->  shipment_ata_overrides  ->  shipments.ata_discharge_*  ->  the discharge port row (vessel_loading_ports.ata_vessel_arrival / ata_vessel_berthed / ata_loading_start / ata_loading_completed)
 * and saving the modal writes ONLY shipment_ata_overrides (an empty field there is NULL). So a date that sits in a lower layer cannot be cleared from the page: the override empties, the
 * lower layer shows through again and the field "keeps its value". 2026-11-12 showed this for the ATC of OP-1004030473-49138234 (the SAP port sync wrote another STO's voyage dates into the port
 * rows); only the ATC column was repaired then. This prints, per live shipment of the operation, every layer of the four milestones, who wrote the port row, SAP's own mirror, and the last
 * audit rows, so the layer that holds the date is named. Nothing is written to the database or to a file.
 */
const path = require('path')
const pool = require(path.join(process.cwd(), 'dist', 'database', 'connection')).default

const OP = (process.env.OP || '').trim()
const SCAN = process.env.SCAN === '1'
const q = async (sql, params = []) => (await pool.query(sql, params)).rows
const d = (v) => (v == null || v === '' ? '-' : String(v).slice(0, 10))

// the four milestones: label, override column, shipments column, port-row column, SAP mirror column
const MILESTONES = [
  { label: 'ATA at Discharge Port', sao: 'ata_discharge_arrival', ship: 'ata_discharge_arrival', port: 'ata_vessel_arrival', sap: 'sap_ata_vessel_arrival', jps: 'jps_ata_discharge_arrival' },
  { label: 'ATB at Discharge Port', sao: 'ata_discharge_berthed', ship: 'ata_discharge_berthed', port: 'ata_vessel_berthed', sap: 'sap_ata_vessel_berthed', jps: 'jps_ata_discharge_berthed' },
  { label: 'ATS Discharge', sao: 'ata_discharge_start', ship: 'ata_discharge_start', port: 'ata_loading_start', sap: 'sap_ata_loading_start', jps: 'jps_ata_discharge_start' },
  { label: 'ATC Discharge', sao: 'ata_discharge_complete', ship: 'ata_discharge_complete', port: 'ata_loading_completed', sap: 'sap_ata_loading_completed', jps: 'jps_ata_discharge_complete' },
]

const selectLayers = MILESTONES.map(
  (m) =>
    `sao.${m.jps}::text AS ${m.jps}, sao.${m.sao}::text AS sao_${m.sao}, s.${m.ship}::text AS s_${m.ship}, v.${m.port}::text AS v_${m.port}, v.${m.sap}::text AS v_${m.sap}`,
).join(',\n            ')

const baseFrom = `
       FROM shipments s
       JOIN contracts c ON c.id = s.contract_id
       LEFT JOIN shipment_ata_overrides sao ON sao.shipment_id = s.id
       LEFT JOIN vessel_loading_ports v
         ON v.shipment_id = s.id AND COALESCE(v.is_discharge_port, false) = true AND COALESCE(v.is_cancelled, false) = false`

/** Which layer the page reads this milestone from, in the order the page reads them. */
function source(row, m) {
  if (row.status !== 'COMPLETED' && row[m.jps]) return 'JPS'
  if (row[`sao_${m.sao}`]) return 'override (a person saved it)'
  if (row[`s_${m.ship}`]) return 'shipments column'
  if (row[`v_${m.port}`]) return 'PORT ROW (' + (row[`v_${m.sap}`] ? 'SAP mirror present' : 'no SAP mirror, not typed in the modal') + ')'
  return null
}

;(async () => {
  if (OP) {
    const rows = await q(
      `SELECT s.id::text AS shipment_id, c.po_number AS po, TRIM(s.shipment_id::text) AS sto, s.status, s.vessel_name AS vessel, s.updated_at::text AS updated_at,
              v.id::text AS port_id, v.port_name, COALESCE(v.klip_edited_fields::text, '{}') AS port_edited, v.updated_at::text AS port_updated_at,
              COALESCE(s.klip_edited_fields::text, '{}') AS ship_edited,
            ${selectLayers}
       ${baseFrom}
      WHERE s.operation_id = $1 AND UPPER(COALESCE(s.status, '')) NOT IN ('CANCELLED', 'CANCELED')
      ORDER BY c.po_number, s.shipment_id`,
      [OP],
    )
    console.log(`operation ${OP}: ${rows.length} live shipment(s)\n`)
    for (const r of rows) {
      console.log(`PO ${r.po}  STO ${r.sto}  [${r.status}]  vessel ${r.vessel || '-'}  port row ${r.port_name || '(none)'}  port row last written ${d(r.port_updated_at)} (${r.port_updated_at ? r.port_updated_at.slice(11, 19) : '-'})`)
      console.log(`    marked as typed by a person - shipment: ${r.ship_edited}   port row: ${r.port_edited}`)
      for (const m of MILESTONES) {
        const src = source(r, m)
        console.log(
          `    ${m.label.padEnd(22)} JPS ${d(r[m.jps])} | override ${d(r[`sao_${m.sao}`])} | shipments ${d(r[`s_${m.ship}`])} | port row ${d(r[`v_${m.port}`])} | SAP mirror ${d(r[`v_${m.sap}`])}   => page shows from: ${src || '(empty)'}`,
        )
      }
      console.log('')
    }

    // The last audit rows of these shipments: did a person ever save one of these dates?
    const ids = rows.map((r) => r.shipment_id)
    if (ids.length) {
      const audit = await q(
        `SELECT a.timestamp::text AS at, COALESCE(u.full_name, a.user_id::text) AS who, a.action, a.entity_type,
                (SELECT string_agg(k, ',') FROM jsonb_object_keys(CASE WHEN jsonb_typeof(a.after_data) = 'object' THEN a.after_data ELSE '{}'::jsonb END) k WHERE k ~* 'ata_|_ata') AS ata_keys
           FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
          WHERE a.entity_id::text = ANY($1::text[])
          ORDER BY a.timestamp DESC LIMIT 12`,
        [ids],
      )
      console.log('last audit rows of these shipments (ata_keys = the actual-time fields that save carried):')
      for (const a of audit) console.log(`  ${a.at.slice(0, 19)}  ${String(a.who).padEnd(24)} ${a.action} ${a.entity_type}  ata_keys: ${a.ata_keys || '-'}`)
      if (audit.length === 0) console.log('  (none)')
    }
  } else {
    console.log('No OP given: pass -e OP=OP-... for one operation. Scanning only.\n')
  }

  if (SCAN || !OP) {
    // A date that only the PORT ROW holds, that no person marked, with no SAP mirror, on a live shipment: the shape of a copied date.
    const parts = MILESTONES.map(
      (m) =>
        `(v.${m.port} IS NOT NULL AND v.${m.sap} IS NULL AND sao.${m.sao} IS NULL AND s.${m.ship} IS NULL AND NOT ('${m.port}' = ANY(COALESCE(v.klip_edited_fields, '{}'))))`,
    )
    const scan = await q(
      `SELECT s.operation_id, COUNT(*)::int AS shipments, COUNT(*) FILTER (WHERE TRIM(s.shipment_id::text) !~ '^[0-9]+$')::int AS manual_sto,
              MIN(s.vessel_name) AS vessel,
              BOOL_OR(${parts[0]}) AS ata, BOOL_OR(${parts[1]}) AS atb, BOOL_OR(${parts[2]}) AS ats, BOOL_OR(${parts[3]}) AS atc
         ${baseFrom}
        WHERE UPPER(COALESCE(s.status, '')) NOT IN ('CANCELLED', 'CANCELED')
          AND (${parts.join(' OR ')})
        GROUP BY s.operation_id
        ORDER BY shipments DESC
        LIMIT 60`,
    )
    console.log(`\nSCAN: operations with a live shipment whose discharge-port actual times exist ONLY in the port row (no override, no shipments column, no SAP mirror, not marked typed): ${scan.length}`)
    for (const r of scan) {
      console.log(`  ${String(r.operation_id || '(no operation)').padEnd(28)} shipments ${String(r.shipments).padStart(3)}  manual STO ${String(r.manual_sto).padStart(3)}  ${String(r.vessel || '').padEnd(22)} ATA ${r.ata ? 'Y' : '-'} ATB ${r.atb ? 'Y' : '-'} ATS ${r.ats ? 'Y' : '-'} ATC ${r.atc ? 'Y' : '-'}`)
    }
  }
  await pool.end()
})().catch((e) => {
  console.error(e && e.message ? e.message : e)
  process.exit(1)
})
