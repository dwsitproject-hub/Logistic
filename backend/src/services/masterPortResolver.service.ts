/**
 * The Master Port a vessel port text stands for, as a map the browser can use: identity of a text -> the Master Port label (migration 237).
 *
 * Built from the database function klip_resolve_master_port_id, so the pages that filter in the browser (Oil Loss, Shipping Performance, the Shipments list display)
 * agree, text for text, with the ids the server stores and the Shipments filter matches on. A text is a Master Port by its own name (PORT / PORT OF ... ignored) or is
 * one of a port's VESSEL PORT (SAP) names; any other text has no entry, and the pages then show it as it is and do not offer it in the filter.
 */
import { query } from '../database/connection';
import { ttlMemo } from '../utils/ttlMemo';
import { MASTER_PORT_MAP_MEMO_KEY } from '../utils/masterPortSapNames';

export interface MasterPortMapEntry {
  identity: string;
  canonical: string;
}

const MASTER_PORT_MAP_SQL = `
  WITH idents AS (
    SELECT klip_port_identity(port) AS identity FROM master_loading_ports
    UNION
    SELECT klip_port_identity(sap_name) FROM master_port_sap_names
  )
  SELECT i.identity, UPPER(REGEXP_REPLACE(BTRIM(mp.port), '\\s+', ' ', 'g')) AS canonical
  FROM idents i
  JOIN master_loading_ports mp ON mp.id = klip_resolve_master_port_id(i.identity)
  WHERE i.identity <> ''
  ORDER BY i.identity`;

/**
 * Kept 5 minutes like the other filter options. A Master Port edit made in KLIP drops it at once (refreshMasterPortIds, utils/masterPortSapNames.ts); a port that
 * only the DHM sync changed shows within the 5 minutes.
 */
export async function loadMasterPortMapEntries(): Promise<MasterPortMapEntry[]> {
  return ttlMemo(MASTER_PORT_MAP_MEMO_KEY, 5 * 60 * 1000, async () => {
    const result = await query(MASTER_PORT_MAP_SQL);
    return (result.rows as Array<{ identity: string; canonical: string }>).map((r) => ({ identity: r.identity, canonical: r.canonical }));
  });
}
