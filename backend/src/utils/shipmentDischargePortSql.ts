import {
  humanReadablePortNameExpr,
  sapDischargePortTextSubquery,
} from './portDisplaySql';
import { sqlContractDischargePortWithB2bChild, sqlShipmentB2bChildDischargePort } from './b2bChildDischargePortSql';

/**
 * The Shipments page's Discharge Port filter.
 *
 * B2B first: the port of a B2B origin (parent) is its ending CHILD's (utils/b2bChildDischargePortSql.ts), because the parent is the company in the middle. For a
 * shipment the child's port replaces everything below unless a user typed the port; for a contract with no shipment it replaces the contract's own SAP port.
 *
 * Which port a SHIPMENT has otherwise is the KLIP side of what the table shows (shipmentListPortsSql.ts, sqlShipmentListDischargePortsKlipAgg): its active discharge
 * leg(s) in vessel_loading_ports when it has any named one, otherwise shipments.port_of_discharge. SAP's Vessel Discharge Port is copied onto that column at
 * import (denormalizeShipmentPortsFromSap), so it is mostly SAP's own text. A port that only the SAP side carries (a GR-closed row the SAP aggregate shows
 * first) is not matched: the SAP side exists only for the rows of one page, and matching it would mean running it over the whole filtered set.
 *
 * Which port a BACKLOG CONTRACT (Unplanned, Preplanned, Completed, Cancelled: no shipment yet) has is what the table shows for it: the ending child's port, else the
 * newest SAP row's Vessel Discharge Port (sapDischargePortTextSubquery), read with the same expression the backlog rows are drawn with.
 *
 * What the picks ARE is decided before this file: a pick is a Master Port (or a text nobody mapped, or Blank), and utils/dischargePortMap.ts expands it to every
 * spelling that stands for it. Here a spelling is an identity: "PORT BONTANG", "Port of Bontang" and "BONTANG" are one (the rule the Shipments list de-duplicates
 * ports by, frontend normalizeListPortIdentity), so a list of identities matches whatever the column's spelling. `Blank` finds what names no port.
 *
 * The shipment predicate is on `s`, like the other shipment-level filters, so it narrows relevant_contract_numbers, shipment_base_core and ranked_sto alike. A
 * contract with a shipment to the port is in; its Outstanding is still the whole contract's (contract-level, as for Region/Plant). The backlog predicate is
 * on the contract, and both share ONE bound text[] so the parameter numbering of the callers moves by one.
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

/**
 * The port a backlog contract is drawn with: the newest SAP row's Vessel Discharge Port without blanks and numeric codes.
 * humanReadablePortNameExpr repeats the text it is given (four times), so the SAP lookup goes in a one-row subquery and runs once per contract,
 * the way shipmentUnplannedHybridSql.ts draws the same column.
 */
function sqlOwnContractPort(contractIdRef: string): string {
  return `(SELECT ${humanReadablePortNameExpr('bp0.p')} FROM (SELECT ${sapDischargePortTextSubquery(contractIdRef)} AS p) bp0)`;
}

/** What a B2B origin's ending child says, else the contract's own: the port a contract with no shipment is drawn with (utils/b2bChildDischargePortSql.ts). */
export function sqlBacklogContractPort(contractIdRef: string, contractPoRef = contractIdRef.replace(/contract_id$/, 'po_number')): string {
  return sqlContractDischargePortWithB2bChild(contractPoRef, sqlOwnContractPort(contractIdRef));
}

/** True for an empty value, a numeric SAP code or a placeholder: a column that names no port. NULL counts as blank. */
function sqlIsNoPort(columnExpr: string): string {
  const id = sqlDischargePortIdentity(columnExpr);
  return `COALESCE((${id} ~ '^[0-9 ]*$' OR ${id} IN ('BLANK', 'DISCHARGE PORT')), TRUE)`;
}

export interface DischargePortFilters {
  /** On the shipment (alias `s`). */
  shipmentSql: string;
  /** On the backlog contract (`c.contract_id`): the SAP port the table shows for it. */
  contractSql: string;
  params: unknown[];
  nextIndex: number;
}

/**
 * Both predicates for the picked ports, starting at parameter `startIndex`: ONE text[] of identities (none when only Blank is picked) that both read.
 * Empty selection: no SQL, no parameter.
 */
export function buildDischargePortFilters(
  ports: readonly string[],
  startIndex: number,
  opts: { shipmentAlias?: string; contractAlias?: string; contractIdRef?: string; contractPoRef?: string } = {},
): DischargePortFilters {
  const { identities, includeBlank } = resolveDischargePortSelection(ports);
  if (identities.length === 0 && !includeBlank) return { shipmentSql: '', contractSql: '', params: [], nextIndex: startIndex };

  const s = opts.shipmentAlias ?? 's';
  const contractAlias = opts.contractAlias ?? 'c';
  const contractIdRef = opts.contractIdRef ?? `${contractAlias}.contract_id`;
  const contractPoRef = opts.contractPoRef ?? contractIdRef.replace(/contract_id$/, 'po_number');
  /** The ending child's port for the shipment (NULL: no child, or a user typed the port). One lookup, in a scalar subquery. */
  const childPortExpr = sqlShipmentB2bChildDischargePort(s, contractAlias);
  /** The shipment's named, active discharge legs: when it has one, those are its ports (as in the table) and the shipment column is not looked at. */
  const namedLeg = (extra: string) => `EXISTS (
        SELECT 1 FROM vessel_loading_ports vd
        WHERE vd.shipment_id = ${s}.id
          AND COALESCE(vd.is_discharge_port, false) = true
          AND COALESCE(vd.is_cancelled, false) = false
          AND ${extra}
      )`;
  const arms: string[] = [];
  /** The same port text the backlog row is drawn with: the newest SAP row's, without blanks and numeric codes. Evaluated once, in one scalar subquery. */
  const contractPortExpr = sqlBacklogContractPort(contractIdRef, contractPoRef);
  const contractArms: string[] = [];
  const params: unknown[] = [];
  let next = startIndex;
  /** What the ending child's port says about the pick: true or false when the shipment has one, NULL when it has none (the arms below then decide). */
  let childVerdict = 'NULL';

  if (identities.length > 0) {
    const idx = next;
    params.push(identities);
    next += 1;
    childVerdict = `${sqlDischargePortIdentity('bc.p')} = ANY($${idx}::text[])`;
    arms.push(
      namedLeg(`${sqlDischargePortIdentity('vd.port_name')} = ANY($${idx}::text[])`),
      `(NOT ${namedLeg(`NOT ${sqlIsNoPort('vd.port_name')}`)}
        AND ${sqlDischargePortIdentity(`${s}.port_of_discharge`)} = ANY($${idx}::text[]))`,
    );
    contractArms.push(`COALESCE(${sqlDischargePortIdentity('bp.p')} = ANY($${idx}::text[]), FALSE)`);
  }
  if (includeBlank) {
    arms.push(
      `(NOT ${namedLeg(`NOT ${sqlIsNoPort('vd.port_name')}`)}
        AND ${sqlIsNoPort(`${s}.port_of_discharge`)})`,
    );
    contractArms.push(sqlIsNoPort('bp.p'));
  }
  // a shipment with an ending child's port is at THAT port (a pick of Blank alone cannot match: the child names a port); only without one do the arms decide
  const shipmentArms = `(${arms.join('\n      OR ')})`;
  return {
    shipmentSql: `COALESCE(
      (SELECT CASE WHEN bc.p IS NULL THEN NULL ELSE COALESCE(${identities.length > 0 ? childVerdict : 'FALSE'}, FALSE) END FROM (SELECT ${childPortExpr} AS p) bc),
      ${shipmentArms}
    )`,
    contractSql: `COALESCE((SELECT ${contractArms.join(' OR ')} FROM (SELECT ${contractPortExpr} AS p) bp), FALSE)`,
    params,
    nextIndex: next,
  };
}

/** The shipment predicate alone (see buildDischargePortFilters). */
export function buildShipmentDischargePortFilter(
  ports: readonly string[],
  startIndex: number,
  shipmentAlias = 's',
): { sql: string; params: unknown[]; nextIndex: number } {
  const f = buildDischargePortFilters(ports, startIndex, { shipmentAlias });
  return { sql: f.shipmentSql, params: f.params, nextIndex: f.nextIndex };
}

/** The backlog-contract predicate alone, with its own parameter (see buildDischargePortFilters). */
export function buildContractDischargePortFilter(
  ports: readonly string[],
  startIndex: number,
  contractIdRef = 'c.contract_id',
): { sql: string; params: unknown[]; nextIndex: number } {
  const f = buildDischargePortFilters(ports, startIndex, { contractIdRef });
  return { sql: f.contractSql, params: f.params, nextIndex: f.nextIndex };
}

/**
 * The texts the filter can offer: every named discharge port of the Shipments page's own shipments, and the SAP port of its backlog contracts (same contract
 * scope as the Product options: its incoterms, a contract SAP still carries, no B2B child). One row per spelling; the controller maps each to its Master Port
 * (utils/dischargePortMap.ts) and lists a port once.
 */
export function buildShipmentDischargePortOptionsSql(contractScopeSql: string, opts: { withSource?: boolean } = {}): string {
  // withSource (the diagnostic only): which source of the page each label comes from. The page itself asks for the label alone.
  const src = (name: string) => (opts.withSource ? `, '${name}' AS src` : '');
  return `
    WITH page_shipments AS (
      -- b2b_port: the ending child's port when the shipment has one (then its own names are not offered: the table shows the child's)
      SELECT s.id, s.port_of_discharge, ${sqlShipmentB2bChildDischargePort('s', 'c')} AS b2b_port
      FROM shipments s
      JOIN contracts c ON c.id = s.contract_id
      LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
      WHERE ${contractScopeSql}
    ),
    page_backlog AS (
      SELECT ${sqlBacklogContractPort('c.contract_id', 'c.po_number')} AS port_of_discharge
      FROM contracts c
      LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
      WHERE ${contractScopeSql}
        AND NOT EXISTS (SELECT 1 FROM shipments sx WHERE sx.contract_id = c.id)
    ),
    named AS (
      SELECT UPPER(REGEXP_REPLACE(BTRIM(b.port_of_discharge), '\\s+', ' ', 'g')) AS label${src('backlog contract (SAP port)')}
      FROM page_backlog b
      UNION
      SELECT UPPER(REGEXP_REPLACE(BTRIM(p.b2b_port), '\\s+', ' ', 'g')) AS label${src('B2B ending child port')}
      FROM page_shipments p
      WHERE p.b2b_port IS NOT NULL
      UNION
      SELECT UPPER(REGEXP_REPLACE(BTRIM(p.port_of_discharge), '\\s+', ' ', 'g')) AS label${src('shipment port_of_discharge')}
      FROM page_shipments p
      WHERE p.b2b_port IS NULL
      UNION
      SELECT UPPER(REGEXP_REPLACE(BTRIM(vd.port_name), '\\s+', ' ', 'g')) AS label${src('discharge leg name')}
      FROM page_shipments p
      JOIN vessel_loading_ports vd ON vd.shipment_id = p.id
      WHERE p.b2b_port IS NULL
        AND COALESCE(vd.is_discharge_port, false) = true
        AND COALESCE(vd.is_cancelled, false) = false
    )
    SELECT label${opts.withSource ? ', src' : ''} FROM named
    WHERE NOT ${sqlIsNoPort('label')}
    ORDER BY label`;
}
