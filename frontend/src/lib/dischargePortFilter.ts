import { normalizeListPortIdentity } from '@/lib/shipmentListPorts'

/**
 * The Discharge Port filter, shared by Oil Loss and Shipping Performance so both mean the same thing by "the same port".
 *
 * A discharge port is where the cargo is unloaded, not the Region/Plant (the contract's SAP Discharge Destination, a site such as BONTANG): the
 * two can differ, which is why the pages have both filters. Ports are free text from SAP or typed in KLIP, so a label is trimmed, single-spaced and
 * upper-cased, and spelling variants are one port: "PORT BONTANG", "Port of Bontang" and "BONTANG" (normalizeListPortIdentity, the rule the
 * Shipments list de-duplicates ports by). A row with no port is listed and filtered as Blank, so cargo without a recorded port can be found.
 */

export const BLANK_DISCHARGE_PORT = 'Blank'

export function cleanDischargePortLabel(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toUpperCase()
}

/** The label a row is listed under: its port, or Blank. */
export function dischargePortLabel(value: unknown): string {
  return cleanDischargePortLabel(value) || BLANK_DISCHARGE_PORT
}

/** What two spellings of one port have in common. All Blank rows share one identity. */
export function dischargePortIdentity(value: unknown): string {
  const label = cleanDischargePortLabel(value)
  if (!label) return BLANK_DISCHARGE_PORT.toUpperCase()
  return normalizeListPortIdentity(label) || label
}

/** True when nothing is picked; otherwise when the row's port is one of the picked ports (spelling variants count as the port). */
export function matchesDischargePortSelection(rowPort: unknown, selected: readonly string[] | undefined): boolean {
  if (!selected || selected.length === 0) return true
  const identity = dischargePortIdentity(rowPort)
  return selected.some((port) => dischargePortIdentity(port) === identity)
}

/**
 * The dropdown: every port the rows have (one entry per port, whatever its spelling), plus whatever is picked so a pick stays listed and
 * ticked when the other filters leave it no row. Blank sorts last so the real ports come first.
 */
export function dischargePortOptionsFrom(rowPorts: Iterable<unknown>, selected: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (label: string) => {
    if (!label) return
    const key = dischargePortIdentity(label)
    if (seen.has(key)) return
    seen.add(key)
    out.push(label)
  }
  selected.forEach((port) => add(cleanDischargePortLabel(port)))
  for (const port of rowPorts) add(dischargePortLabel(port))
  const blank = BLANK_DISCHARGE_PORT.toUpperCase()
  return out.sort((a, b) => {
    const aBlank = a.toUpperCase() === blank
    const bBlank = b.toUpperCase() === blank
    if (aBlank !== bBlank) return aBlank ? 1 : -1
    return a.localeCompare(b)
  })
}
