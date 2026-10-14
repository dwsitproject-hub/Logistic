import { query } from '../database/connection';
import logger from '../utils/logger';
import { ttlMemo } from '../utils/ttlMemo';
import {
  buildDischargePortMap,
  expandDischargePortPicks,
  type DischargePortMap,
} from '../utils/dischargePortMap';
import { parseDischargePortParam } from '../utils/shipmentDischargePortSql';

const MAP_TTL_MS = 5 * 60 * 1000;

/**
 * Is the Master Port mapping of the Discharge Port filter on? OFF by default: the filter then lists and matches the port as SAP wrote it (only the PORT prefix
 * and spelling are folded). Turn it on with DISCHARGE_PORT_MASTER_MAPPING=true (backend env, needs a restart) once Master Port and the plant aliases are tidy,
 * because until then most plant names would stay unmapped (see docs/scripts/diag-discharge-port-gaps.cjs).
 *
 * One switch is enough for every page: Oil Loss, Shipping Performance and the pre-planned groups label rows by the map the backend sends, and an empty map is no map.
 */
export function isDischargePortMasterMappingEnabled(): boolean {
  return String(process.env.DISCHARGE_PORT_MASTER_MAPPING ?? 'false').trim().toLowerCase() === 'true';
}

/**
 * The Master Port <-> SAP discharge-port-text mapping (rules in utils/dischargePortMap.ts), read from master_loading_ports and discharge_port_aliases.
 * A few dozen rows, so it is kept for five minutes like the other filter options; a Master Port or alias edit shows up within that.
 * Empty (no table is read) while the mapping is off.
 */
export async function loadDischargePortMap(): Promise<DischargePortMap> {
  if (!isDischargePortMasterMappingEnabled()) return buildDischargePortMap([], []);
  return ttlMemo('discharge-port-map', MAP_TTL_MS, async () => {
    const [ports, aliases] = await Promise.all([
      query(`SELECT port, COALESCE(dhm_is_deleted, FALSE) AS deleted FROM master_loading_ports WHERE NULLIF(BTRIM(port), '') IS NOT NULL`),
      query(
        `SELECT a.alias_name AS alias, s.site_name AS site
         FROM discharge_port_aliases a
         LEFT JOIN master_sites s ON s.id = a.site_id`,
      ),
    ]);
    return buildDischargePortMap(
      ports.rows.map((r: { port: string; deleted: boolean }) => ({ port: String(r.port), deleted: r.deleted === true })),
      aliases.rows.map((r: { alias: string; site: string | null }) => ({ alias: String(r.alias), site: r.site == null ? null : String(r.site) })),
    );
  });
}

/**
 * The `dischargePort` query param as the list the SQL filters take: each pick expanded to every spelling that stands for it (Master Port, with or
 * without PORT, and the plant names that map to it), plus Blank. Empty when no port is picked, and then the map is not even read.
 *
 * If the mapping cannot be read the picks are used as they are: the filter then works on the spelling alone (phase-1 behaviour) instead of failing the page.
 */
export async function resolveDischargePortPicks(rawParam: unknown): Promise<string[]> {
  const picks = parseDischargePortParam(rawParam);
  if (picks.length === 0) return [];
  try {
    return expandDischargePortPicks(await loadDischargePortMap(), picks);
  } catch (error) {
    logger.warn('Discharge port mapping unavailable; filtering on the picked spelling only', { error: (error as Error)?.message });
    return picks;
  }
}
