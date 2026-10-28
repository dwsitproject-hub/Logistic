/**
 * The Master Ports KLIP submits to JPS for, and whether each has been switched on.
 *
 * JPS identifies a shipping instruction's port by its DHM code (port_hub_code) and nothing else: it has no site or region, and its API key is not scoped to a port. So the
 * only question KLIP asks is "does this shipment discharge at a port switched on for JPS". An STO is sent when the Master Port its discharge port resolves to is in this
 * list and switched on, whatever Region/Site its contracts carry.
 *
 * Kept free of imports so the Integrations registry (validation) and jps/config.ts (reading) share ONE definition.
 *
 * Stored as a JSON array in the setting JPS_PORTS: [{"port":"<Master Port>","enabled":true}, ...]. No port is built into the code: with no port switched on nothing is
 * sent. Migration 249 seeded the one port that was already running when the list was introduced, as ordinary data an ADMIN edits.
 * - port     the Master Port, compared as a Master Port (klip_resolve_master_port_id), so a VESSEL PORT (SAP) alias of it counts. It needs a DHM code before it can be
 *            switched on: that code is what JPS receives.
 * - enabled  false keeps the port out of every sweep and makes Submit to Jetty say it is not switched on yet. A new port starts off and is switched on by an ADMIN once
 *            JPS has set it up (its jetty, and the companies mapped to it).
 */
export interface JpsPort {
  port: string;
  enabled: boolean;
}

export const JPS_PORTS_MAX = 50;

type Parsed = { ok: true; ports: JpsPort[] } | { ok: false; problem: string };

/** Strict reading, with the problem in words an ADMIN can act on. */
export function parseJpsPorts(raw: string | null | undefined): Parsed {
  const text = String(raw ?? '').trim();
  if (!text) return { ok: false, problem: 'No ports are set.' };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, problem: 'Ports is not valid JSON.' };
  }
  if (!Array.isArray(data)) return { ok: false, problem: 'Ports must be a list.' };
  if (data.length > JPS_PORTS_MAX) return { ok: false, problem: `Ports can hold at most ${JPS_PORTS_MAX} ports.` };

  const ports: JpsPort[] = [];
  const seen = new Set<string>();
  for (const [i, item] of data.entries()) {
    const n = i + 1;
    if (!item || typeof item !== 'object' || Array.isArray(item)) return { ok: false, problem: `Port ${n} is not an object.` };
    const o = item as Record<string, unknown>;
    const port = typeof o.port === 'string' ? o.port.trim().toUpperCase() : '';
    if (!port) return { ok: false, problem: `Port ${n} has no Master Port name.` };
    if (port === 'ALL') return { ok: false, problem: 'ALL is not a port: name each port to send for.' };
    if (typeof o.enabled !== 'boolean') return { ok: false, problem: `${port}: enabled must be true or false.` };
    if (/[^\x20-\x7E]/.test(port)) return { ok: false, problem: `${port}: the name contains an invisible or non-ASCII character. Retype it.` };
    if (seen.has(port)) return { ok: false, problem: `${port} is listed twice.` };
    seen.add(port);
    ports.push({ port, enabled: o.enabled });
  }
  return { ok: true, ports };
}

/** For the registry: null when the value is acceptable. */
export function validateJpsPortsValue(raw: string): string | null {
  const parsed = parseJpsPorts(raw);
  return parsed.ok ? null : parsed.problem;
}
