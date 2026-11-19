/*
 * READ-ONLY: why Edit Shipment answers 400 "No sibling shipment found for contract <X> under this STO / operation" when a Delivered Qty (Klip) is saved.
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-po-klip-qty-sibling.cjs | docker exec -i -e CONTRACT=9144101942 klip-backend node -
 *   (add -e STO=<the STO or operation id of the shipment you were editing> to also test it the way the modal does)
 *
 * PUT /shipments/:id/po-klip-qty writes a PO's quantity onto ITS OWN shipment row inside the STO / operation group (shipmentPoAssignment.service.ts batchSaveShipmentPoKlipQty,
 * findSiblingShipmentIdForContract: a NON-cancelled shipment of that contract in the group). A PO the modal lists but that has no such row cannot take a quantity. Usual reasons:
 *   - a B2B ORIGIN (numbers starting 9...): the shipment is on its CHILD, the origin only rides the STO in SAP;
 *   - the PO's shipment was cancelled (reverted, replaced), and the PO is still listed through the STO or an Add PO link;
 *   - the PO rides the STO in SAP and was never planned as a shipment of its own.
 * What this prints: 1. the contract rows, 2. its SAP B2B flags and its B2B children, 3. its shipment rows (any status) with the STO key each belongs to, 4. with STO=...: the group the modal
 * opens, and for each PO of it whether the modal would let you type a quantity (the same test it uses). Writes nothing.
 */
const path = require('path')
const dist = (p) => require(path.join(process.cwd(), 'dist', p))
const pool = dist('database/connection').default
const { STO_KEY_SQL } = dist('jps/eligibility')
const { resolveShipmentEditContext } = dist('services/shipmentEditContext.service')
const { contractsWithActiveSiblingShipment } = dist('services/shipmentPoAssignment.service')

const CONTRACT = String(process.env.CONTRACT || '').trim()
const STO = String(process.env.STO || '').trim()
const q = async (sql, params = []) => (await pool.query(sql, params)).rows
const t = (v) => (v == null || v === '' ? '-' : String(v))

async function section(title, fn) {
  console.log(`\n== ${title}`)
  try {
    await fn()
  } catch (e) {
    console.log('  ERROR: ' + (e && e.message ? e.message : e))
  }
}

async function main() {
  if (!CONTRACT) {
    console.log('usage: -e CONTRACT=<contract number> [-e STO=<sto or operation id>]')
    return
  }
  console.log(`contract ${CONTRACT}${STO ? `   STO ${STO}` : ''}`)

  let contractIds = []
  await section('1. the contract rows (by contract id or PO number)', async () => {
    const rows = await q(
      `SELECT id, contract_id, po_number, status, incoterm, quantity_ordered FROM contracts WHERE TRIM(contract_id::text) = $1 OR TRIM(po_number::text) = $1`,
      [CONTRACT],
    )
    if (!rows.length) console.log('  no contract has this number as contract id or PO number')
    for (const r of rows) console.log(`  contract_id ${t(r.contract_id)}  PO ${t(r.po_number)}  status ${t(r.status)}  incoterm ${t(r.incoterm)}  qty ordered ${t(r.quantity_ordered)}  (row ${r.id})`)
    contractIds = rows.map((r) => String(r.contract_id))
  })

  await section('2. SAP B2B flags of it, and the B2B children that point at its PO', async () => {
    if (!contractIds.length) return console.log('  (no contract)')
    const flags = await q(
      `SELECT contract_number, b2b_flag_raw, contract_reference_po_raw FROM contract_latest_spd_snapshot WHERE contract_number = ANY($1::text[])`,
      [contractIds],
    )
    for (const r of flags) console.log(`  ${r.contract_number}: B2B flag "${t(r.b2b_flag_raw)}"  Contract Reff PO "${t(r.contract_reference_po_raw)}"`)
    const pos = (await q(`SELECT TRIM(po_number::text) AS po FROM contracts WHERE contract_id = ANY($1::text[]) AND NULLIF(TRIM(po_number::text), '') IS NOT NULL`, [contractIds])).map((r) => r.po)
    if (!pos.length) return console.log('  (no PO number to look children up by)')
    const kids = await q(
      `SELECT chb.contract_number, chb.b2b_flag_raw, ch.status, ch.po_number
         FROM contract_latest_spd_snapshot chb JOIN contracts ch ON ch.contract_id = chb.contract_number
        WHERE TRIM(chb.contract_reference_po_raw) = ANY($1::text[]) AND UPPER(COALESCE(chb.b2b_flag_raw,'')) = 'B2B'`,
      [pos],
    )
    console.log(kids.length ? `  ${kids.length} B2B child(ren) point at this PO: ${kids.map((k) => `${k.contract_number} (PO ${t(k.po_number)}, ${t(k.status)})`).join(', ')}` : '  no B2B child points at this PO')
    const asChild = flags.filter((f) => String(f.b2b_flag_raw || '').toUpperCase() === 'B2B' && f.contract_reference_po_raw)
    if (asChild.length) console.log('  this contract is itself a B2B CHILD of PO ' + asChild.map((f) => f.contract_reference_po_raw).join(', '))
  })

  await section('3. its shipment rows, any status, with the STO key each belongs to', async () => {
    if (!contractIds.length) return console.log('  (no contract)')
    const rows = await q(
      `SELECT s.id, s.status, s.shipment_id, s.operation_id, s.quantity_delivered_klip, ${STO_KEY_SQL} AS sto_key
         FROM shipments s JOIN contracts c ON c.id = s.contract_id
         LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
        WHERE c.contract_id = ANY($1::text[]) ORDER BY s.created_at`,
      [contractIds],
    )
    if (!rows.length) console.log('  NO shipment row at all: this PO has no shipment of its own, so a quantity cannot be saved on it')
    for (const r of rows) console.log(`  shipment ${r.id}  ${t(r.status)}  STO key ${t(r.sto_key)}  operation ${t(r.operation_id)}  Delivery Qty (Klip) ${t(r.quantity_delivered_klip)}`)
  })

  if (STO) {
    await section(`4. the group of STO / operation ${STO}: the shipments in it and what the modal allows`, async () => {
      const group = await q(
        `SELECT s.id, s.status, c.contract_id, c.po_number, s.quantity_delivered_klip
           FROM shipments s JOIN contracts c ON c.id = s.contract_id
           LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
          WHERE ${STO_KEY_SQL} = $1 ORDER BY c.contract_id`,
        [STO],
      )
      for (const r of group) console.log(`  shipment ${r.id}  ${t(r.status).padEnd(10)} contract ${t(r.contract_id)}  PO ${t(r.po_number)}  Delivery Qty (Klip) ${t(r.quantity_delivered_klip)}`)
      const anchor = group.find((r) => String(r.status || '').toUpperCase() !== 'CANCELLED')
      if (!anchor) return console.log('  every shipment of this group is cancelled')
      const ctx = await resolveShipmentEditContext(String(anchor.id), STO)
      if (!ctx) return console.log('  the modal could not resolve this group')
      const listed = String(ctx.contract_numbers || '').split(',').map((x) => x.trim()).filter(Boolean)
      const live = await contractsWithActiveSiblingShipment(String(ctx.lookup_key), String(anchor.id), listed)
      console.log(`  the modal lists ${listed.length} PO row(s) (lookup key ${t(ctx.lookup_key)}):`)
      for (const c of listed) console.log(`    ${c.padEnd(14)} ${live.has(c) ? 'editable' : 'LOCKED: no live shipment in this group, a quantity typed here is refused with the 400'}${c === CONTRACT ? '   <-- the contract in the error' : ''}`)
    })
  }

  console.log('\nHow to read it: section 3 empty or all CANCELLED = the PO has no shipment to take the quantity (a B2B origin, or a cancelled/reverted PO). Section 2 with children = a B2B origin: the quantity belongs on the child.')
}

main()
  .catch((e) => console.log('FATAL: ' + (e && e.message ? e.message : e)))
  .finally(() => pool.end())
