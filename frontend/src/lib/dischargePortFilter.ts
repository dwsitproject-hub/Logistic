import { normalizeListPortIdentity } from '@/lib/shipmentListPorts'

/**
 * The Discharge Port filter, shared by Oil Loss, Shipping Performance and the Shipments pre-planned groups so all of them mean the same thing by "the same port".
 *
 * A discharge port is where the cargo is unloaded, not the Region/Plant (the contract's SAP Discharge Destination, a site such as BONTANG): the two can differ,
 * which is why the pages have both filters. SAP writes the port as free text, often a PLANT's name ("EUP EDIBLE OIL BONTANG"), so a text is read through the
 * Master Port (a resolver built from GET /contracts/filter-options/discharge-port-map, from the Master Port and its VESSEL PORT (SAP) names): a text that is a Master
 * Port, with or without PORT, or one of a port's SAP names, is that Master Port.
 *
 * What the filter can find is the Master Ports. A text with no Master Port is NOT offered in the dropdown and is not matched by a pick (it is still found by PO and
 * the other searches); the page draws it as it is. Without a resolver (not loaded yet, or failed) only the spelling counts: "PORT BONTANG", "Port of Bontang" and
 * "BONTANG" are one port (normalizeListPortIdentity, the rule the Shipments list de-duplicates ports by).
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

/** Blank was a pick before; a remembered one means nothing now and is dropped. */
export function realDischargePicks(selected: readonly string[] | undefined): string[] {
  return (selected ?? []).filter((port) => cleanDischargePortLabel(port) !== '' && cleanDischargePortLabel(port) !== BLANK_DISCHARGE_PORT.toUpperCase())
}

/** The Master Port a text stands for, or null when it has none (empty, or a text nobody mapped). Null as well while the resolver has not loaded. */
export function masterPortLabel(value: unknown, resolver?: DischargePortResolver | null): string | null {
  const label = cleanDischargePortLabel(value);
  if (!label || !resolver) return null;
  return resolver.get(spellingIdentity(label)) ?? null;
}

/** The label a row is DRAWN under: its Master Port, else its own text, else Blank. */
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

/**
 * True when nothing is picked; otherwise when the row's port is one of the picked Master Ports. A row whose text has no Master Port is never one of them.
 * Without a resolver the spelling decides, so the filter still works before the map has loaded.
 */
export function matchesDischargePortSelection(
  rowPort: unknown,
  selectedPorts: readonly string[] | undefined,
  resolver?: DischargePortResolver | null,
): boolean {
  const selected = realDischargePicks(selectedPorts)
  if (selected.length === 0) return true
  if (!resolver) {
    const identity = spellingIdentity(cleanDischargePortLabel(rowPort))
    return identity !== '' && selected.some((port) => spellingIdentity(cleanDischargePortLabel(port)) === identity)
  }
  const row = masterPortLabel(rowPort, resolver)
  if (!row) return false
  const rowIdentity = spellingIdentity(row)
  return selected.some((port) => spellingIdentity(masterPortLabel(port, resolver) ?? cleanDischargePortLabel(port)) === rowIdentity)
}

/**
 * The dropdown: the Master Ports the rows are at (one entry per port, whatever its spelling), plus whatever is picked so a pick stays listed and ticked when the other
 * filters leave it no row. A text with no Master Port is not offered, and there is no Blank. Without a resolver the rows' labels are offered as they are (the Shipments
 * page passes the server's list, which is Master Ports already).
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
    const key = spellingIdentity(label)
    if (seen.has(key)) return
    seen.add(key)
    out.push(label)
  }
  realDischargePicks(selected).forEach((port) => add(masterPortLabel(port, resolver) ?? cleanDischargePortLabel(port)))
  for (const port of rowPorts) add(resolver ? masterPortLabel(port, resolver) ?? '' : cleanDischargePortLabel(port))
  return out.sort((a, b) => a.localeCompare(b))
}
