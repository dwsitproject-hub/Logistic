import type { OilLossSourceRow } from '@/lib/oilLossAllContractColumns'

/** What the Edit Shipment modal just saved, in kg (shipments.sfal_qty / sfbd_qty). null clears the value. */
export interface OilLossSfalSfbdPatch {
  sfalKg: number | null
  sfbdKg: number | null
}

function stoTokens(value: unknown): string[] {
  return String(value ?? '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
}

/** A cleared or zero quantity is no quantity: the snapshot stores NULLIF(sfal_qty, 0), and the table draws "-" for it. */
function asKg(value: number | null): number | null {
  if (value == null || !Number.isFinite(value) || value === 0) return null
  return value
}

/**
 * Show a saved SFAL / SFBD on the Oil Loss row of that STO right away.
 *
 * The Oil Loss rows come from a snapshot that is rebuilt in the background after a shipment edit, which takes a while; until it commits, the snapshot still holds the
 * old quantities. The R1 / R2 / R3 / Loss columns, the cards and the By Supplier / By Transporter tables are all worked out in the browser from these two fields, so
 * patching them here moves every figure at once. The snapshot that arrives later carries the same edit, and replaces the rows.
 *
 * Only a row that is that STO alone is touched (its id is `sto:<sto>`, or its STO list is exactly that one): a row that joins several STOs holds a sum this patch
 * cannot recompute, so it is left for the snapshot. Nothing else in the row changes.
 */
export function applyOilLossSfalSfbdPatch<T extends Pick<OilLossSourceRow, 'id' | 'sto_number' | 'quantity_sfal' | 'quantity_sfbd'>>(
  rows: readonly T[],
  sto: string | null | undefined,
  patch: OilLossSfalSfbdPatch | null | undefined,
): T[] {
  const wanted = String(sto ?? '').trim()
  if (!wanted || !patch) return [...rows]
  return rows.map((row) => {
    const tokens = stoTokens(row.sto_number)
    const isThatSto = row.id === `sto:${wanted}` || (tokens.length === 1 && tokens[0] === wanted)
    if (!isThatSto) return row
    return { ...row, quantity_sfal: asKg(patch.sfalKg), quantity_sfbd: asKg(patch.sfbdKg) }
  })
}
