/**
 * OS Qty of a PO that is carried by several STOs.
 *
 * The OS Qty of such a PO is the PO's, not an STO's: Contract Qty less the TOTAL Delivery / Receive of every STO of the PO (by the PO's incoterm). So with a Contract Qty of
 * 1,000 and STOs that moved 100, 300 and 200, each of the three STO rows shows OS 400 - the View Table and the Edit / View Shipment modal alike - while the modal still
 * shows each STO's own Delivery / Receive. These helpers explain that figure next to it.
 */

export type StoFulfilmentRow = {
  sto_number?: string | null
  type?: string | null
  quantity_delivered?: number | string | null
  quantity_receive?: number | string | null
}

export type OutstandingBasis = 'receive' | 'delivery'

/** More than one SAP STO on the PO: the OS Qty is reduced by the quantities of the others too. */
export function isMultiStoPo(stoCount: unknown): boolean {
  const n = Number(stoCount)
  return Number.isFinite(n) && n > 1
}

/**
 * Which quantity reduces OS for an incoterm: Receive for FRC / CIF / CFR, Delivery for LCO / FOB (the rule the list and the cards use). Any other incoterm uses
 * Receive, else Delivery, so no single column is named.
 */
export function outstandingBasis(incoterm: unknown): OutstandingBasis | null {
  const inc = String(incoterm ?? '').trim().toUpperCase()
  if (inc === 'FRC' || inc === 'CIF' || inc === 'CFR') return 'receive'
  if (inc === 'LCO' || inc === 'FOB') return 'delivery'
  return null
}

function toKg(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** Total Delivery and Receive over the STOs (kg). */
export function sumStoFulfilment(rows: readonly StoFulfilmentRow[]): { delivery: number; receive: number } {
  let delivery = 0
  let receive = 0
  for (const row of rows) {
    delivery += toKg(row.quantity_delivered)
    receive += toKg(row.quantity_receive)
  }
  return { delivery, receive }
}

/** The explanation shown beside an OS Qty that several STOs reduced. */
export function poStoOutstandingHelpText(stoCount: unknown, incoterm?: unknown): string {
  const n = Math.max(2, Math.trunc(Number(stoCount) || 2))
  const basis = outstandingBasis(incoterm)
  const inc = String(incoterm ?? '').trim().toUpperCase()
  const counted =
    basis === 'receive'
      ? `Receive Qty counts for ${inc}`
      : basis === 'delivery'
        ? `Delivery Qty counts for ${inc}`
        : 'Receive Qty counts, else Delivery Qty'
  return (
    `This PO has ${n} STOs. OS Qty is the PO's: Contract Qty less the total Delivery / Receive of all ${n} STOs (${counted}), ` +
    `not of this STO alone, so every STO row of the PO shows the same OS Qty.`
  )
}

/** True when a listed STO is the one the modal / row is about (STO numbers compared trimmed). */
export function isCurrentSto(rowSto: unknown, currentSto: unknown): boolean {
  const a = String(rowSto ?? '').trim()
  const b = String(currentSto ?? '').trim()
  return a !== '' && b !== '' && a === b
}
