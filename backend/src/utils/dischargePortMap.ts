/**
 * Which Master Port a discharge-port text from SAP stands for.
 *
 * SAP's Vessel Discharge Port is often a PLANT's name, not a port: "EUP EDIBLE OIL BONTANG" is 46% of the rows on the 28 Sep 2026 export (migration 213).
 * The rule is the one jps/eligibility.ts resolves a shipment's port by, so a filter and a JPS submission agree on which port a shipment is at:
 *
 *   1. the text is a Master Port, with or without the PORT prefix ("BONTANG", "PORT BONTANG", "Port of Bontang" -> PORT BONTANG);
 *   2. otherwise the text is a discharge_port_aliases name, and its Site's port "PORT <site>" is the port ("EUP EDIBLE OIL BONTANG" -> site BONTANG -> PORT BONTANG);
 *   3. otherwise it is not mapped, and stays what it is: no port is invented. An alias whose Site has no "PORT <site>" Master Port (TANJUNG PURA, KARAWANG, ...)
 *      is in this case too - a Site can have many ports and picking "its only one" put BEKASI on PORT KUMAI. Those gaps are Master Port data to fill, not code.
 *
 * Pure functions over rows already read, so the rule is tested without a database (services/dischargePortMap.service.ts reads the rows).
 */
import { normalizeDischargePortIdentity } from './shipmentDischargePortSql';

export interface MasterPortRow {
  port: string;
  /** Deleted in DHM: still a name SAP can use, but never preferred over a live one. */
  deleted?: boolean;
}

export interface DischargePortAliasRow {
  alias: string;
  /** The Site of the plant; null when the alias has none. */
  site: string | null;
}

export interface DischargePortMap {
  /** Identity of a text (PORT prefix and punctuation removed) -> the canonical Master Port label. */
  canonicalByIdentity: Map<string, string>;
  /** Canonical label -> every identity that stands for it: the port's own and its aliases'. */
  identitiesByCanonical: Map<string, string[]>;
}

export const BLANK_PORT_LABEL = 'Blank';

/** Upper-cased and single-spaced: how a label is listed and compared. */
export function cleanPortLabel(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
}

function preferMaster(a: { label: string; deleted: boolean }, b: { label: string; deleted: boolean }): number {
  if (a.deleted !== b.deleted) return a.deleted ? 1 : -1;
  const aPrefixed = a.label.startsWith('PORT ');
  const bPrefixed = b.label.startsWith('PORT ');
  if (aPrefixed !== bPrefixed) return aPrefixed ? -1 : 1;
  if (a.label.length !== b.label.length) return a.label.length - b.label.length;
  return a.label.localeCompare(b.label);
}

export function buildDischargePortMap(
  masterPorts: readonly MasterPortRow[],
  aliases: readonly DischargePortAliasRow[],
): DischargePortMap {
  const masters = masterPorts
    .map((m) => ({ label: cleanPortLabel(m.port), deleted: m.deleted === true }))
    .filter((m) => m.label !== '' && normalizeDischargePortIdentity(m.label) !== '');
  masters.sort(preferMaster);

  const canonicalByIdentity = new Map<string, string>();
  for (const master of masters) {
    const identity = normalizeDischargePortIdentity(master.label);
    // sorted best first, so the first master of an identity is the one that stays
    if (!canonicalByIdentity.has(identity)) canonicalByIdentity.set(identity, master.label);
  }

  for (const row of aliases) {
    const identity = normalizeDischargePortIdentity(row.alias);
    const site = cleanPortLabel(row.site);
    if (!identity || !site) continue;
    // a name that is itself a Master Port is that port (rule 1 before rule 2)
    if (canonicalByIdentity.has(identity)) continue;
    // the port named exactly "PORT <site>", a live one first (masters is sorted that way)
    const target = masters.find((m) => m.label === `PORT ${site}`);
    if (!target) continue;
    const canonical = canonicalByIdentity.get(normalizeDischargePortIdentity(target.label));
    if (canonical) canonicalByIdentity.set(identity, canonical);
  }

  const identitiesByCanonical = new Map<string, string[]>();
  for (const [identity, canonical] of canonicalByIdentity) {
    const list = identitiesByCanonical.get(canonical);
    if (list) list.push(identity);
    else identitiesByCanonical.set(canonical, [identity]);
  }
  for (const list of identitiesByCanonical.values()) list.sort();
  return { canonicalByIdentity, identitiesByCanonical };
}

/** The Master Port label of a text, or the text itself (cleaned) when it maps to none. Empty is Blank. */
export function canonicalDischargePort(map: DischargePortMap, value: unknown): string {
  const label = cleanPortLabel(value);
  if (!label) return BLANK_PORT_LABEL;
  const identity = normalizeDischargePortIdentity(label);
  return (identity && map.canonicalByIdentity.get(identity)) || label;
}

/**
 * Picks (Master Port labels, texts nobody mapped, or Blank) as the list the SQL filters take: every identity that stands for each pick, plus Blank.
 * A pick written as an alias name ("EUP EDIBLE OIL BONTANG") is the port it maps to, so an old selection keeps working after the mapping lands.
 */
export function expandDischargePortPicks(map: DischargePortMap, picks: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of picks) {
    const label = String(raw ?? '').trim();
    if (!label) continue;
    if (label.toLowerCase() === BLANK_PORT_LABEL.toLowerCase()) {
      out.add(BLANK_PORT_LABEL);
      continue;
    }
    const canonical = canonicalDischargePort(map, label);
    const identities = map.identitiesByCanonical.get(canonical);
    if (identities) identities.forEach((identity) => out.add(identity));
    else out.add(normalizeDischargePortIdentity(label) || cleanPortLabel(label));
  }
  return [...out].sort();
}

/** The mapping as the page needs it to label rows the same way: identity -> canonical label. */
export function dischargePortMapEntries(map: DischargePortMap): Array<{ identity: string; canonical: string }> {
  return [...map.canonicalByIdentity.entries()]
    .map(([identity, canonical]) => ({ identity, canonical }))
    .sort((a, b) => a.identity.localeCompare(b.identity));
}
