/**
 * The Shipments page's Discharge Port filter (phase 1: the port as SAP wrote it, no Master Port mapping).
 *
 * Which port a shipment has is the KLIP side of what the table shows (shipmentListPortsSql.ts, sqlShipmentListDischargePortsKlipAgg): its active discharge
 * leg(s) in vessel_loading_ports when it has any named one, otherwise shipments.port_of_discharge. SAP's Vessel Discharge Port is copied onto that column at
 * import (denormalizeShipmentPortsFromSap), so it is mostly SAP's own text. A port that only the SAP side carries (a GR-closed row the SAP aggregate shows
 * first) is not matched: the SAP side exists only for the rows of one page, and matching it would mean running it over the whole filtered set.
 *
 * Spelling variants are one port, with the rule the Shipments list de-duplicates ports by (frontend normalizeListPortIdentity): "PORT BONTANG",
 * "Port of Bontang" and "BONTANG" match each other. `Blank` finds the shipments with no named port.
 *
 * The predicate is on the shipment (alias `s`), like the other shipment-level filters, so it narrows relevant_contract_numbers, shipment_base_core and
 * ranked_sto alike. A contract with a shipment to the port is in; its Outstanding is still the whole contract's (contract-level, as for Region/Plant).
 * The contract backlog (Unplanned, Preplanned, Completed, Cancelled contracts with no shipment yet) has no port, so a port filter leaves it out
 * (buildUnplannedContractToolbarScope).
 */

export const DISCHARGE_PORT_BLANK = 'blank';

/** Values the table never shows as a port; as an identity they mean "no port". */
const NOT_A_PORT_IDENTITIES = new Set(['BLANK', 'DISCHARGE PORT']);

/** Mirror of the frontend's normalizeListPortIdentity: upper-case, punctuation to a space, a leading PORT / PORT OF / JETTY ... removed. */
export function normalizeDischargePortIdentity(value: unknown): string {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/^(PORT|JETTY|TERMINAL|PELABUHAN|DERMAGA)(\s+OF)?\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNotAPortIdentity(identity: string): boolean {
  return /^[0-9 ]*$/.test(identity) || NOT_A_PORT_IDENTITIES.has(identity);
}

/** The `dischargePort` query param (one value or repeated) as trimmed, non-empty strings. */
export function parseDischargePortParam(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : raw != null && raw !== '' ? [raw] : [];
  return list.map((v) => String(v).trim()).filter(Boolean);
}

/** The ports a filter asks for, as identities, and whether it asks for the shipments with none. Order and duplicates do not matter. */
export function resolveDischargePortSelection(ports: readonly string[]): { identities: string[]; includeBlank: boolean } {
  const identities = new Set<string>();
  let includeBlank = false;
  for (const port of ports) {
    const label = String(port ?? '').trim();
    if (!label) continue;
    if (label.toLowerCase() === DISCHARGE_PORT_BLANK) {
      includeBlank = true;
      continue;
    }
    const identity = normalizeDischargePortIdentity(label);
    if (identity && !isNotAPortIdentity(identity)) identities.add(identity);
  }
  return { identities: [...identities].sort(), includeBlank };
}

/** The selection as a canonical list (identities, then `blank`), so two spellings of one pick share a cache key. */
export function resolveDischargePortSelectionKey(ports: readonly string[]): string[] {
  const { identities, includeBlank } = resolveDischargePortSelection(ports);
  return includeBlank ? [...identities, DISCHARGE_PORT_BLANK] : identities;
}

/** SQL twin of normalizeDischargePortIdentity (NULL stays NULL). Regex written with String.raw so the backslashes reach Postgres. */
export function sqlDischargePortIdentity(columnExpr: string): string {
  const stripped = String.raw`REGEXP_REPLACE(BTRIM(REGEXP_REPLACE(UPPER(${columnExpr}), '[^A-Z0-9]+', ' ', 'g')), '^(PORT|JETTY|TERMINAL|PELABUHAN|DERMAGA)(\s+OF)?\s+', '')`;
  return stripped;
}

/** True for an empty value, a numeric SAP code or a placeholder: a column that names no port. NULL counts as blank. */
function sqlIsNoPort(columnExpr: string): string {
  const id = sqlDischargePortIdentity(columnExpr);
  return `COALESCE((${id} ~ '^[0-9 ]*$' OR ${id} IN ('BLANK', 'DISCHARGE PORT')), TRUE)`;
}

/**
 * Shipment-level predicate for the picked discharge ports, starting at parameter `startIndex` (one text[] param of identities, none when only Blank is picked).
 * Empty selection: no SQL.
 */
export function buildShipmentDischargePortFilter(
  ports: readonly string[],
  startIndex: number,
  shipmentAlias = 's',
): { sql: string; params: unknown[]; nextIndex: number } {
  const { identities, includeBlank } = resolveDischargePortSelection(ports);
  if (identities.length === 0 && !includeBlank) return { sql: '', params: [], nextIndex: startIndex };

  const s = shipmentAlias;
  /** The shipment's named, active discharge legs: when it has one, those are its ports (as in the table) and the shipment column is not looked at. */
  const namedLeg = (extra: string) => `EXISTS (
        SELECT 1 FROM vessel_loading_ports vd
        WHERE vd.shipment_id = ${s}.id
          AND COALESCE(vd.is_discharge_port, false) = true
          AND COALESCE(vd.is_cancelled, false) = false
          AND ${extra}
      )`;
  const arms: string[] = [];
  const params: unknown[] = [];
  let next = startIndex;

  if (identities.length > 0) {
    const idx = next;
    params.push(identities);
    next += 1;
    arms.push(
      namedLeg(`${sqlDischargePortIdentity('vd.port_name')} = ANY($${idx}::text[])`),
      `(NOT ${namedLeg(`NOT ${sqlIsNoPort('vd.port_name')}`)}
        AND ${sqlDischargePortIdentity(`${s}.port_of_discharge`)} = ANY($${idx}::text[]))`,
    );
  }
  if (includeBlank) {
    arms.push(
      `(NOT ${namedLeg(`NOT ${sqlIsNoPort('vd.port_name')}`)}
        AND ${sqlIsNoPort(`${s}.port_of_discharge`)})`,
    );
  }
  return { sql: `(${arms.join('\n      OR ')})`, params, nextIndex: next };
}

/**
 * The ports the filter can offer: every named discharge port of the Shipments page's own shipments (same contract scope as the Product options:
 * its incoterms, a contract SAP still carries, no B2B child). One row per spelling; the page lists a port once whatever its spelling.
 */
export function buildShipmentDischargePortOptionsSql(contractScopeSql: string): string {
  return `
    WITH page_shipments AS (
      SELECT s.id, s.port_of_discharge
      FROM shipments s
      JOIN contracts c ON c.id = s.contract_id
      LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
      WHERE ${contractScopeSql}
    ),
    named AS (
      SELECT UPPER(REGEXP_REPLACE(BTRIM(p.port_of_discharge), '\\s+', ' ', 'g')) AS label
      FROM page_shipments p
      UNION
      SELECT UPPER(REGEXP_REPLACE(BTRIM(vd.port_name), '\\s+', ' ', 'g')) AS label
      FROM page_shipments p
      JOIN vessel_loading_ports vd ON vd.shipment_id = p.id
      WHERE COALESCE(vd.is_discharge_port, false) = true
        AND COALESCE(vd.is_cancelled, false) = false
    )
    SELECT label FROM named
    WHERE NOT ${sqlIsNoPort('label')}
    ORDER BY label`;
}
