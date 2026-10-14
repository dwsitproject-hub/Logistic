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

/**
 * Answers per resolver and text. A page filters every row several times per click (Shipping Performance: once per filter list, 7 passes) while the rows carry a few
 * hundred distinct texts, so the regex clean-up runs once per text instead of once per row and pass. A new map (a new resolver) starts empty.
 */
const masterPortLabelMemo = new WeakMap<DischargePortResolver, Map<string, string | null>>()

/** The Master Port a text stands for, or null when it has none (empty, or a text nobody mapped). Null as well while the resolver has not loaded. */
export function masterPortLabel(value: unknown, resolver?: DischargePortResolver | null): string | null {
  if (!resolver) return null;
  const key = typeof value === 'string' ? value : String(value ?? '');
  let memo = masterPortLabelMemo.get(resolver);
  if (!memo) {
    memo = new Map();
    masterPortLabelMemo.set(resolver, memo);
  }
  const known = memo.get(key);
  if (known !== undefined) return known;
  const label = cleanDischargePortLabel(key);
  const answer = label ? resolver.get(spellingIdentity(label)) ?? null : null;
  memo.set(key, answer);
  return answer;
}

/** A port text as a read-only field DRAWS it: its Master Port when it has one, else the original text (a "-" or an empty value stays as it is). */
export function drawnPortLabel(value: string, resolver?: DischargePortResolver | null): string {
  return masterPortLabel(value, resolver) ?? value
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
  const picked = pickedIdentities(selectedPorts, resolver)
  if (picked.size === 0) return true
  if (!resolver) {
    const identity = spellingIdentity(cleanDischargePortLabel(rowPort))
    return identity !== '' && picked.has(identity)
  }
  const row = masterPortLabel(rowPort, resolver)
  return row !== null && picked.has(spellingIdentity(row))
}

/** The picks as identities, worked out once per (selection array, resolver): the selection is page state, so every row of a filter pass passes the same array. */
const pickedIdentitiesMemo = new WeakMap<readonly string[], { resolver: DischargePortResolver | null; ids: Set<string> }>()

function pickedIdentities(selectedPorts: readonly string[] | undefined, resolver: DischargePortResolver | null | undefined): Set<string> {
  if (!selectedPorts || selectedPorts.length === 0) return new Set()
  const r = resolver ?? null
  const known = pickedIdentitiesMemo.get(selectedPorts)
  if (known && known.resolver === r) return known.ids
  const ids = new Set(
    realDischargePicks(selectedPorts).map((port) =>
      spellingIdentity(r ? masterPortLabel(port, r) ?? cleanDischargePortLabel(port) : cleanDischargePortLabel(port)),
    ),
  )
  pickedIdentitiesMemo.set(selectedPorts, { resolver: r, ids })
  return ids
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
