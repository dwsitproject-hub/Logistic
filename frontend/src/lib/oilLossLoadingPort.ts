import type { OilLossSourceRow } from '@/lib/oilLossAllContractColumns'

/** What a row with no loading port is listed and filtered as, the same word the other Oil Loss groupings use. */
export const OIL_LOSS_BLANK_LOADING_PORT = 'Blank'

/**
 * The loading port of an Oil Loss row, as one comparable label.
 *
 * `loading_location` of a vessel row is the shipment's `port_of_loading` - the primary (first) loading port. A voyage that loads at several
 * ports is counted once, under that primary port: its Loss % is one figure for the whole voyage, and there is no received quantity per port to
 * split it by. Ports are free text from SAP or typed in KLIP, so the label is trimmed, single-spaced and upper-cased; otherwise
 * "Pom Kendawangan" and "POM KENDAWANGAN" would be two ports.
 */
export function oilLossLoadingPortLabel(row: Pick<OilLossSourceRow, 'loading_location'>): string {
  const text = String(row.loading_location ?? '').replace(/\s+/g, ' ').trim().toUpperCase()
  return text || OIL_LOSS_BLANK_LOADING_PORT
}

/** True for any row when nothing is picked; otherwise when the row's port is one of the picked ports. */
export function matchesOilLossLoadingPortFilter(
  row: Pick<OilLossSourceRow, 'loading_location'>,
  selectedLoadingPorts: readonly string[],
): boolean {
  if (selectedLoadingPorts.length === 0) return true
  const label = oilLossLoadingPortLabel(row)
  return selectedLoadingPorts.some((port) => {
    const wanted = String(port ?? '').replace(/\s+/g, ' ').trim().toUpperCase()
    return (wanted || OIL_LOSS_BLANK_LOADING_PORT.toUpperCase()) === label.toUpperCase()
  })
}

/**
 * The Loading Port dropdown: every port the rows have, plus whatever is picked (so a pick stays listed and ticked when the other filters leave
 * it no row). Blank sorts last so the real ports come first.
 */
export function oilLossLoadingPortOptions(
  rows: readonly Pick<OilLossSourceRow, 'loading_location'>[],
  selected: readonly string[],
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (label: string) => {
    const key = label.toUpperCase()
    if (!label || seen.has(key)) return
    seen.add(key)
    out.push(label)
  }
  selected.forEach((port) => add(String(port ?? '').replace(/\s+/g, ' ').trim()))
  rows.forEach((row) => add(oilLossLoadingPortLabel(row)))
  const blank = OIL_LOSS_BLANK_LOADING_PORT.toUpperCase()
  return out.sort((a, b) => {
    const aBlank = a.toUpperCase() === blank
    const bBlank = b.toUpperCase() === blank
    if (aBlank !== bBlank) return aBlank ? 1 : -1
    return a.localeCompare(b)
  })
}
