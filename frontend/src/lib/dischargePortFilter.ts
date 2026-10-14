import { normalizeListPortIdentity } from '@/lib/shipmentListPorts'

/**
 * The Discharge Port filter, shared by Oil Loss, Shipping Performance and the Shipments pre-planned groups so all of them mean the same thing by "the same port".
 *
 * A discharge port is where the cargo is unloaded, not the Region/Plant (the contract's SAP Discharge Destination, a site such as BONTANG): the two can differ,
 * which is why the pages have both filters. SAP writes the port as free text, often a PLANT's name ("EUP EDIBLE OIL BONTANG"), so a text is first read through the
 * Master Port mapping (a resolver built from GET /contracts/filter-options/discharge-port-map; the rules are in backend utils/dischargePortMap.ts): a Master Port,
 * with or without PORT, or a plant name that is an alias of one, is that Master Port. A text nobody mapped stays what it is, trimmed, single-spaced and upper-cased.
 * Without a resolver (not loaded yet, or failed) only the spelling counts: "PORT BONTANG", "Port of Bontang" and "BONTANG" are one port
 * (normalizeListPortIdentity, the rule the Shipments list de-duplicates ports by). A row with no port is Blank, so cargo without a recorded port can be found.
 */

export const BLANK_DISCHARGE_PORT = 'Blank'

/** Identity of a SAP port text (PORT prefix and punctuation removed) -> the Master Port label it stands for. */
export type DischargePortResolver = ReadonlyMap<string, string>

export interface DischargePortMapEntry {
  identity: string
  canonical: string
}

export function createDischargePortResolver(entries: readonly DischargePortMapEntry[] | null | undefined): DischargePortResolver | null {
  if (!entries || entries.length === 0) return null
  return new Map(entries.map((entry) => [entry.identity, entry.canonical]))
}

export function cleanDischargePortLabel(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toUpperCase()
}

function spellingIdentity(label: string): string {
  return normalizeListPortIdentity(label) || label
}

/** The label a row is listed under: its Master Port, else its own text, else Blank. */
export function dischargePortLabel(value: unknown, resolver?: DischargePortResolver | null): string {
  const label = cleanDischargePortLabel(value)
  if (!label) return BLANK_DISCHARGE_PORT
  return resolver?.get(spellingIdentity(label)) ?? label
}

/** What two texts for one port have in common. All Blank rows share one identity. */
export function dischargePortIdentity(value: unknown, resolver?: DischargePortResolver | null): string {
  const label = cleanDischargePortLabel(value)
  if (!label) return BLANK_DISCHARGE_PORT.toUpperCase()
  return spellingIdentity(resolver?.get(spellingIdentity(label)) ?? label)
}

/** True when nothing is picked; otherwise when the row's port is one of the picked ports. */
export function matchesDischargePortSelection(
  rowPort: unknown,
  selected: readonly string[] | undefined,
  resolver?: DischargePortResolver | null,
): boolean {
  if (!selected || selected.length === 0) return true
  const identity = dischargePortIdentity(rowPort, resolver)
  return selected.some((port) => dischargePortIdentity(port, resolver) === identity)
}

/**
 * The dropdown: every port the rows have (one entry per port, whatever its spelling), plus whatever is picked so a pick stays listed and ticked when the
 * other filters leave it no row. Blank sorts last so the real ports come first.
 */
export function dischargePortOptionsFrom(
  rowPorts: Iterable<unknown>,
  selected: readonly string[],
  resolver?: DischargePortResolver | null,
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (label: string) => {
    if (!label) return
    const key = dischargePortIdentity(label, resolver)
    if (seen.has(key)) return
    seen.add(key)
    out.push(label)
  }
  selected.forEach((port) => add(cleanDischargePortLabel(port) ? dischargePortLabel(port, resolver) : ''))
  for (const port of rowPorts) add(dischargePortLabel(port, resolver))
  const blank = BLANK_DISCHARGE_PORT.toUpperCase()
  return out.sort((a, b) => {
    const aBlank = a.toUpperCase() === blank
    const bBlank = b.toUpperCase() === blank
    if (aBlank !== bBlank) return aBlank ? 1 : -1
    return a.localeCompare(b)
  })
}
