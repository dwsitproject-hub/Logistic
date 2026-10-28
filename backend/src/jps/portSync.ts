import { query } from '../database/connection';
import { integrationEnv } from '../integrations/integrationEnv';
import { parseJpsPorts } from './ports';

/**
 * A port cannot be switched on unless DHM knows it: JPS takes the port as port_hub_code (the Master Port's DHM code), so every shipment of an unsynced port would be held one
 * by one ("discharge port has no DHM code on Master Port") with nothing to say why the port is on. Checked when the list is SAVED, and only for a row that is newly switched on,
 * so a list that was already running can still be edited while its port is being fixed.
 */
export async function jpsPortSyncProblems(raw: string): Promise<string[]> {
  const parsed = parseJpsPorts(raw);
  if (!parsed.ok) return []; // validateSettingValue already says why
  const current = parseJpsPorts(integrationEnv('JPS_PORTS'));
  const wasOn = new Set((current.ok ? current.ports : []).filter((p) => p.enabled).map((p) => p.port));
  const problems: string[] = [];
  for (const item of parsed.ports) {
    if (!item.enabled || wasOn.has(item.port)) continue;
    const res = await query(
      `SELECT NULLIF(TRIM(mp.code_dhm), '') AS code, COALESCE(mp.dhm_is_deleted, FALSE) AS deleted
         FROM master_loading_ports mp
        WHERE mp.id = klip_resolve_master_port_id($1::text)`,
      [item.port],
    );
    const row = res.rows[0] as { code: string | null; deleted: boolean } | undefined;
    if (!row) problems.push(`There is no Master Port "${item.port}". Add it in Master Port first.`);
    else if (!row.code || row.deleted) {
      problems.push(`Master Port "${item.port}" is not synced with DHM (no DHM code). Sync it before switching the port on.`);
    }
  }
  return problems;
}
