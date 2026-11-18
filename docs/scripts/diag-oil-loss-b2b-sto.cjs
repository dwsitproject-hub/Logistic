/*
 * READ-ONLY: why Oil Loss R1 / R3 of an STO look wrong when one of its POs is a B2B child.
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-oil-loss-b2b-sto.cjs | docker exec -i -e STO=1006019499 klip-backend node -
 *   (add -e SCAN=1 to also count, over the whole snapshot, the STOs that have a B2B child and look odd)
 *
 * R1 = (SFAL - Delivery) / Delivery, R2 = (SFBD - SFAL) / SFAL, R3 = (Receive - SFBD) / SFBD (frontend app/oil-loss/page.tsx). SFAL and SFBD are the VESSEL's figures of the STO (the primary
 * shipment row, per STO); Delivery and Receive are SUMS over the POs of the STO of each PO's STO-scoped SAP kilograms (oilLossVesselCompletedSql.ts, vessel_contract_qty). If the sums miss a PO
 * that the vessel figures include, R1 and R3 move and R2 (SFBD vs SFAL, both vessel-wide) does not.
 *
 * What this checks, in order:
 *  1. The snapshot row Oil Loss shows for the STO (quantity_delivery / _received / _sfal / _sfbd, the POs it lists).
 *  2. The POs as Oil Loss sees them: contractsOnStoSubquery maps a B2B CHILD to its ORIGIN (COALESCE(b2b_o.contract_id, cc.contract_id)), and each PO's Delivery / Receive is then looked up
 *     by THAT contract number and incoterm. The SAP rows that carry the STO belong to the child, so the origin's own figure can be empty.
 *  3. The contracts that really carry the STO in SAP (no mapping): who is a B2B child / origin, each one's incoterm, and the STO-scoped Delivery / Receive of each as SAP holds it.
 *  4. The same R1 / R2 / R3 recomputed from (a) what Oil Loss summed and (b) every contract that carries the STO (a B2B origin counted together with its children, as Contract Details does).
 * Nothing is written to the database or to a file.
 */
const path = require('path')
const dist = (p) => require(path.join(process.cwd(), 'dist', p))
const pool = dist('database/connection').default
const { contractsOnStoSubquery } = dist('utils/stoLinkedContractSql')
const { sqlStoScopedDeliveredKgSql, sqlStoScopedReceiveKgSql } = dist('utils/contractLogisticsStoDetailSql')

const STO = String(process.env.STO || '').trim()
const q = async (sql, params = []) => (await pool.query(sql, params)).rows
const n = (v) => (v == null || v === '' ? null : Number(v))
const mt = (kg) => (kg == null ? '-' : (Number(kg) / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 }))
const pct = (num, den) => (num == null || den == null || Number(den) === 0 ? '-' : ((Number(num) / Number(den)) * 100).toFixed(2) + '%')
const rates = (sfal, sfbd, del, rec) => ({
  R1: pct(sfal == null || del == null ? null : sfal - del, del),
  R2: pct(sfal == null || sfbd == null ? null : sfbd - sfal, sfal),
  R3: pct(rec == null || sfbd == null ? null : rec - sfbd, sfbd),
  Loss: pct(rec == null || del == null ? null : rec - del, del),
})
const show = (label, r) => console.log(`  ${label.padEnd(34)} R1 ${String(r.R1).padStart(9)}   R2 ${String(r.R2).padStart(9)}   R3 ${String(r.R3).padStart(9)}   Loss ${String(r.Loss).padStart(9)}`)

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
    console.error('Name the STO: -e STO=1006019499')
    process.exit(1)
  }
  console.log(`STO ${STO}`)

  let snap = null
  await section('1. the row Oil Loss shows (oil_loss_snapshot)', async () => {
    const rows = await q(
      `SELECT id::text, transport_mode, po_number, contract_number, incoterm, vessel_name, status,
              quantity_delivery, quantity_received, quantity_sfal, quantity_sfbd, gain_loss_amount, gain_loss_percentage
         FROM oil_loss_snapshot WHERE TRIM(sto_number::text) = $1`,
      [STO],
    )
    if (rows.length === 0) console.log('  no row for this STO in the snapshot (not Completed by the Oil Loss rule, or not SEA)')
    for (const r of rows) {
      snap = r
      console.log(`  ${r.transport_mode}  ${r.vessel_name}  incoterm ${r.incoterm}  POs ${r.po_number}`)
      console.log(`  Delivery ${mt(r.quantity_delivery)} MT   Receive ${mt(r.quantity_received)} MT   SFAL ${mt(r.quantity_sfal)} MT   SFBD ${mt(r.quantity_sfbd)} MT`)
      show('as the page computes it', rates(n(r.quantity_sfal), n(r.quantity_sfbd), n(r.quantity_delivery), n(r.quantity_received)))
    }
  })

  const qtyOpts = { contractNumberExpr: 'c2.contract_id', contractQtyExpr: 'COALESCE(c2.quantity_ordered, 0)', stoKeyExpr: '$1::text', poNumberExpr: 'c2.po_number', incotermExpr: 'c2.incoterm' }
  const deliveredSql = sqlStoScopedDeliveredKgSql(qtyOpts)
  const receivedSql = sqlStoScopedReceiveKgSql({ ...qtyOpts, incotermExpr: undefined })

  let seen = []
  await section('2. the POs as Oil Loss sees them (a B2B child is replaced by its origin)', async () => {
    seen = await q(
      `SELECT c2.contract_id, c2.po_number, c2.incoterm, c2.quantity_ordered, c2.status,
              ${deliveredSql} AS delivered_kg, ${receivedSql} AS received_kg
         FROM contracts c2
        WHERE c2.contract_id IN (SELECT lc.contract_id FROM (${contractsOnStoSubquery('$1::text')}) lc)
        ORDER BY c2.contract_id`,
      [STO],
    )
    for (const r of seen) {
      console.log(`  ${String(r.contract_id).padEnd(12)} PO ${String(r.po_number || '-').padEnd(12)} ${String(r.incoterm || '-').padEnd(4)} [${r.status}] contract ${mt(r.quantity_ordered)} MT   Delivery ${mt(r.delivered_kg)}   Receive ${mt(r.received_kg)}`)
    }
    const sd = seen.reduce((a, r) => a + (n(r.delivered_kg) || 0), 0)
    const sr = seen.reduce((a, r) => a + (n(r.received_kg) || 0), 0)
    console.log(`  sum over these POs               Delivery ${mt(sd)} MT   Receive ${mt(sr)} MT   (this is what the row is built from)`)
    if (snap) {
      const same = Math.abs(sd - (n(snap.quantity_delivery) || 0)) < 1 && Math.abs(sr - (n(snap.quantity_received) || 0)) < 1
      console.log(`  ${same ? 'matches' : 'DOES NOT match'} the snapshot row (a difference means the snapshot is older than the data)`)
    }
  })

  let real = []
  await section('3. the contracts that really carry the STO in SAP (no mapping)', async () => {
    real = await q(
      `WITH carriers AS (
         SELECT DISTINCT spd.contract_number
           FROM sap_processed_data spd
          WHERE TRIM(COALESCE(spd.sto_number::text, spd.data->'raw'->>'STO No.', spd.data->'raw'->>'STO Number', spd.data->'shipment'->>'sto_no', spd.data->'contract'->>'sto_no')) = $1
            AND spd.contract_number IS NOT NULL
       )
       SELECT c2.contract_id, c2.po_number, c2.incoterm, c2.quantity_ordered, c2.status,
              l.b2b_flag_raw, l.contract_reference_po_raw,
              ${deliveredSql} AS delivered_kg, ${receivedSql} AS received_kg
         FROM carriers ca
         JOIN contracts c2 ON c2.contract_id = ca.contract_number
         LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = c2.contract_id
        ORDER BY c2.contract_id`,
      [STO],
    )
    if (real.length === 0) console.log('  no SAP row names this STO')
    for (const r of real) {
      const role = String(r.b2b_flag_raw || '').toUpperCase() === 'B2B' ? (r.contract_reference_po_raw ? `B2B CHILD of PO ${r.contract_reference_po_raw}` : 'B2B (no reference PO)') : 'normal'
      console.log(`  ${String(r.contract_id).padEnd(12)} PO ${String(r.po_number || '-').padEnd(12)} ${String(r.incoterm || '-').padEnd(4)} [${r.status}] ${role.padEnd(32)} contract ${mt(r.quantity_ordered)} MT   Delivery ${mt(r.delivered_kg)}   Receive ${mt(r.received_kg)}`)
    }
    const sd = real.reduce((a, r) => a + (n(r.delivered_kg) || 0), 0)
    const sr = real.reduce((a, r) => a + (n(r.received_kg) || 0), 0)
    console.log(`  sum over the carriers            Delivery ${mt(sd)} MT   Receive ${mt(sr)} MT`)
  })

  await section('4. the vessel figures and the rates', async () => {
    const ships = await q(
      `SELECT TRIM(s.shipment_id::text) AS sto_or_id, s.status, c.po_number, s.vessel_name, s.sfal_qty, s.sfbd_qty
         FROM shipments s JOIN contracts c ON c.id = s.contract_id
        WHERE TRIM(s.shipment_id::text) = $1 OR NULLIF(TRIM(s.operation_id::text), '') = $1
        ORDER BY c.po_number`,
      [STO],
    )
    for (const s of ships) console.log(`  shipment ${String(s.po_number).padEnd(12)} [${s.status}] ${s.vessel_name || ''}  SFAL ${mt(s.sfal_qty)}  SFBD ${mt(s.sfbd_qty)}`)
    const sfal = snap ? n(snap.quantity_sfal) : null
    const sfbd = snap ? n(snap.quantity_sfbd) : null
    const seenD = seen.reduce((a, r) => a + (n(r.delivered_kg) || 0), 0) || null
    const seenR = seen.reduce((a, r) => a + (n(r.received_kg) || 0), 0) || null
    const realD = real.reduce((a, r) => a + (n(r.delivered_kg) || 0), 0) || null
    const realR = real.reduce((a, r) => a + (n(r.received_kg) || 0), 0) || null
    console.log('')
    show('Oil Loss sums (what the page shows)', rates(sfal, sfbd, seenD, seenR))
    show('every SAP carrier of the STO summed', rates(sfal, sfbd, realD, realR))
    console.log(`\n  Delivery: Oil Loss ${mt(seenD)} MT vs carriers ${mt(realD)} MT (gap ${mt(realD == null || seenD == null ? null : realD - seenD)} MT)`)
    console.log(`  Receive : Oil Loss ${mt(seenR)} MT vs carriers ${mt(realR)} MT (gap ${mt(realR == null || seenR == null ? null : realR - seenR)} MT)`)
  })

  if (process.env.SCAN === '1') {
    await section('5. SCAN: how many Oil Loss rows have a B2B child among the contracts that carry their STO', async () => {
      // Only the stored sto_number column of sap_processed_data (indexed), so a few STOs known from the raw JSON alone may be missed: read the count as "at least".
      const rows = await q(
        `WITH sto AS (
           SELECT DISTINCT TRIM(o.sto_number::text) AS sto FROM oil_loss_snapshot o WHERE o.transport_mode = 'SEA' AND NULLIF(TRIM(o.sto_number::text), '') IS NOT NULL
         ),
         carriers AS (
           SELECT DISTINCT sto.sto, spd.contract_number
             FROM sto JOIN sap_processed_data spd ON TRIM(spd.sto_number::text) = sto.sto
            WHERE spd.contract_number IS NOT NULL
         ),
         children AS (
           SELECT ca.sto, count(*)::int AS b2b_children
             FROM carriers ca JOIN contract_latest_spd_snapshot l ON l.contract_number = ca.contract_number
            WHERE UPPER(COALESCE(l.b2b_flag_raw, '')) = 'B2B' AND NULLIF(TRIM(l.contract_reference_po_raw), '') IS NOT NULL
            GROUP BY ca.sto
         )
         SELECT o.sto_number, o.vessel_name, o.incoterm, ch.b2b_children,
                o.quantity_delivery, o.quantity_received, o.quantity_sfal, o.quantity_sfbd
           FROM children ch JOIN oil_loss_snapshot o ON TRIM(o.sto_number::text) = ch.sto AND o.transport_mode = 'SEA'
          ORDER BY o.sto_number`,
      )
      const rate = (a, b) => (a == null || b == null || Number(b) === 0 ? null : ((Number(a) - Number(b)) / Number(b)) * 100)
      const withRates = rows.map((r) => ({
        ...r,
        r1: rate(r.quantity_sfal, r.quantity_delivery),
        r3: rate(r.quantity_received, r.quantity_sfbd),
      }))
      const odd = withRates.filter((r) => (r.r1 != null && Math.abs(r.r1) > 5) || (r.r3 != null && Math.abs(r.r3) > 5))
      console.log(`  ${rows.length} Oil Loss STO(s) have at least one B2B child among their SAP carriers; ${odd.length} of them show |R1| or |R3| above 5%`)
      console.log('  (for comparison: the whole SEA snapshot is the baseline of normal rows, where R1 and R3 stay within a few percent)')
      for (const r of withRates.slice(0, 60)) {
        const f = (v) => (v == null ? '-' : v.toFixed(2) + '%')
        console.log(`  ${String(r.sto_number).padEnd(12)} ${String(r.vessel_name || '').padEnd(22)} ${String(r.incoterm || '-').padEnd(4)} children ${r.b2b_children}  Delivery ${mt(r.quantity_delivery).padStart(10)}  Receive ${mt(r.quantity_received).padStart(10)}  R1 ${f(r.r1).padStart(9)}  R3 ${f(r.r3).padStart(9)}${odd.includes(r) ? '   <-- odd' : ''}`)
      }
    })
  }
  await pool.end()
})().catch((e) => {
  console.error(e && e.message ? e.message : e)
  process.exit(1)
})
