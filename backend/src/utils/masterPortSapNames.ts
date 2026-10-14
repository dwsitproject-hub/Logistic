/**
 * Master Port "VESSEL PORT (SAP)": the SAP port texts that stand for a Master Port (table master_port_sap_names, migration 237).
 *
 * One SAP text belongs to ONE port (a unique index on its identity: upper-case, punctuation to a space, a leading PORT / PORT OF / JETTY ... removed), and a text that
 * already IS another Master Port ("BONTANG" vs PORT BONTANG) is refused, because the port itself would always win and the entry would never be used.
 * After any change to the master the Master Port ids stored next to the port texts are re-resolved (klip_refresh_master_port_ids), without touching updated_at.
 */
import type { PoolClient } from 'pg';
import pool, { query } from '../database/connection';
import logger from './logger';
import { normalizeDischargePortIdentity } from './shipmentDischargePortSql';
import { invalidateTtlMemo } from './ttlMemo';

/**
 * Cached answers that are read from the Master Port: the browser map (services/masterPortResolver.service.ts) and the Shipments Discharge Port options
 * (contract.controller.ts). They are kept for minutes and dropped here on every Master Port change made through KLIP, so an edit shows on the next request.
 */
export const MASTER_PORT_MAP_MEMO_KEY = 'master-port-map-entries';
export const SHIPMENT_MASTER_PORT_OPTIONS_MEMO_KEY = 'filter-options:shipment-master-ports';

export class MasterPortSapNameConflictError extends Error {
  readonly statusCode = 409;
  constructor(message: string, readonly conflicts: Array<{ name: string; reason: string }>) {
    super(message);
    this.name = 'MasterPortSapNameConflictError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A SAP text as it is stored and shown: upper-case, single-spaced. */
export function cleanSapName(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
}

/** True for an identity that names no port: empty, a numeric SAP code, or a placeholder. */
function namesNoPort(identity: string): boolean {
  return identity === '' || /^[0-9 ]*$/.test(identity) || identity === 'BLANK' || identity === 'DISCHARGE PORT';
}

/**
 * The names a request carries, or undefined when it carries none (then the stored names are left alone). An array, or one string with the names separated by
 * `;`, `|` or a new line (a comma is part of some names: "PORT KUMALINGON, LEOK").
 */
export function parseSapNamesInput(raw: unknown): string[] | undefined {
  if (raw === undefined) return undefined;
  const list = Array.isArray(raw) ? raw : raw == null ? [] : String(raw).split(/[;|\r\n]+/);
  return list.map(cleanSapName).filter(Boolean);
}

/** One entry per identity (the first spelling wins); entries that name no port are dropped. */
export function dedupeSapNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const identity = normalizeDischargePortIdentity(name);
    if (namesNoPort(identity) || seen.has(identity)) continue;
    seen.add(identity);
    out.push(name);
  }
  return out;
}

type Db = Pick<PoolClient, 'query'>;

/**
 * Throws MasterPortSapNameConflictError when a name is already another port's VESSEL PORT (SAP) name, or is itself another Master Port.
 * `ownPort`: the port being saved (its id when it exists, its name always) - a name equal to its own port is redundant and not an error.
 */
export async function assertSapNamesAvailable(
  names: readonly string[],
  ownPort: { id?: string | null; name?: string | null },
  db: Db = { query: (text: string, params?: unknown[]) => query(text, params) } as unknown as Db,
): Promise<void> {
  if (names.length === 0) return;
  const ownId = ownPort.id && UUID_RE.test(ownPort.id) ? ownPort.id : null;
  const ownIdentity = ownPort.name ? normalizeDischargePortIdentity(ownPort.name) : null;
  const conflicts: Array<{ name: string; reason: string }> = [];

  const onOtherPort = await db.query(
    `SELECT n.sap_name, p.port
     FROM master_port_sap_names n
     JOIN master_loading_ports p ON p.id = n.port_id
     WHERE klip_port_identity(n.sap_name) IN (SELECT klip_port_identity(x) FROM unnest($1::text[]) AS x)
       AND ($2::uuid IS NULL OR n.port_id <> $2::uuid)`,
    [[...names], ownId],
  );
  for (const row of onOtherPort.rows as Array<{ sap_name: string; port: string }>) {
    conflicts.push({ name: row.sap_name, reason: `already VESSEL PORT (SAP) of ${row.port}` });
  }

  const asMasterPort = await db.query(
    `SELECT p.port
     FROM master_loading_ports p
     WHERE klip_port_identity(p.port) IN (SELECT klip_port_identity(x) FROM unnest($1::text[]) AS x)
       AND ($2::uuid IS NULL OR p.id <> $2::uuid)`,
    [[...names], ownId],
  );
  for (const row of asMasterPort.rows as Array<{ port: string }>) {
    const identity = normalizeDischargePortIdentity(row.port);
    if (ownIdentity && identity === ownIdentity) continue;
    conflicts.push({ name: row.port, reason: 'is a Master Port itself' });
  }

  if (conflicts.length > 0) {
    throw new MasterPortSapNameConflictError(
      `VESSEL PORT (SAP): ${conflicts.map((c) => `"${c.name}" ${c.reason}`).join('; ')}`,
      conflicts,
    );
  }
}

/** Replace the VESSEL PORT (SAP) names of a port with exactly these (one transaction). A name equal to the port's own is not stored. */
export async function replaceSapNamesForPort(portId: string, portName: string, names: readonly string[]): Promise<string[]> {
  const ownIdentity = normalizeDischargePortIdentity(portName);
  const wanted = dedupeSapNames(names.map(cleanSapName)).filter((n) => normalizeDischargePortIdentity(n) !== ownIdentity);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await assertSapNamesAvailable(wanted, { id: portId, name: portName }, client);
    await client.query('DELETE FROM master_port_sap_names WHERE port_id = $1::uuid', [portId]);
    if (wanted.length > 0) {
      await client.query(
        `INSERT INTO master_port_sap_names (port_id, sap_name)
         SELECT $1::uuid, x FROM unnest($2::text[]) AS x`,
        [portId, wanted],
      );
    }
    await client.query('COMMIT');
    return wanted;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Adds `vessel_port_sap` (the port's names, sorted) to every row that is a real Master Port (a uuid id). */
export async function attachSapNames<T extends { id?: unknown }>(rows: T[]): Promise<Array<T & { vessel_port_sap: string[] }>> {
  const ids = rows.map((r) => String(r.id ?? '')).filter((id) => UUID_RE.test(id));
  const byPort = new Map<string, string[]>();
  if (ids.length > 0) {
    const result = await query(
      `SELECT port_id::text AS port_id, sap_name FROM master_port_sap_names WHERE port_id = ANY($1::uuid[]) ORDER BY sap_name`,
      [ids],
    );
    for (const row of result.rows as Array<{ port_id: string; sap_name: string }>) {
      const list = byPort.get(row.port_id) ?? [];
      list.push(row.sap_name);
      byPort.set(row.port_id, list);
    }
  }
  return rows.map((r) => ({ ...r, vessel_port_sap: byPort.get(String(r.id ?? '')) ?? [] }));
}

/**
 * Re-resolve the Master Port id of every stored port text (shipments, discharge / loading legs). Call after a change to Master Port or its names.
 * Never throws: the master change is already saved, and a failed refresh is only a stale id until the next one.
 */
export async function refreshMasterPortIds(): Promise<number | null> {
  try {
    const result = await query('SELECT klip_refresh_master_port_ids() AS changed');
    return Number(result.rows[0]?.changed ?? 0);
  } catch (error) {
    logger.error('Refresh master port ids failed:', error);
    return null;
  } finally {
    invalidateTtlMemo(MASTER_PORT_MAP_MEMO_KEY);
    invalidateTtlMemo(SHIPMENT_MASTER_PORT_OPTIONS_MEMO_KEY);
  }
}
