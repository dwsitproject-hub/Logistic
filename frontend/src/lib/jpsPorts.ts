/**
 * Integrations > JPS > Ports: the rows of the editor and the JSON string the setting JPS_PORTS holds (backend/src/jps/ports.ts is the other end of this contract).
 * JPS knows a port by its DHM code and has no site or region, so a row is just a Master Port and a switch. Kept free of React so the rules can be tested.
 */
export interface JpsPortRow {
  port: string
  enabled: boolean
}

/** No port is built into KLIP: with none switched on, nothing is sent to JPS. */
export const DEFAULT_JPS_PORTS: JpsPortRow[] = []

export interface JpsPortOptions {
  ports: Array<{ port: string; hasDhmCode: boolean; dhmCode: string | null; shipments: number }>
}

/** Rows from the saved string. Empty or unreadable is no port at all (the backend reads it the same way), never a guess. */
export function parsePortsValue(raw: string | null | undefined): JpsPortRow[] {
  const text = String(raw ?? '').trim()
  if (!text) return []
  try {
    const data: unknown = JSON.parse(text)
    if (!Array.isArray(data)) return []
    return data
      .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x))
      .map((x) => ({ port: typeof x.port === 'string' ? x.port : '', enabled: x.enabled === true }))
  } catch {
    return []
  }
}

/**
 * The string the editor holds and saves. Names are kept exactly as typed: trimming or upper-casing here would drop a space the moment it is typed ("PORT" before
 * "DUMAI" can follow). The backend trims and upper-cases when it reads them (jps/ports.ts), and the view does the same.
 */
export function serializePorts(rows: JpsPortRow[]): string {
  return JSON.stringify(rows.map((r) => ({ port: r.port, enabled: r.enabled })))
}

/** Problems the editor can show before the server does. */
export function portsProblems(rows: JpsPortRow[]): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  rows.forEach((r, i) => {
    const port = r.port.trim().toUpperCase()
    if (!port) problems.push(`Baris ${i + 1}: Master Port belum dipilih.`)
    else if (port === 'ALL') problems.push('ALL bukan port: sebutkan tiap port yang dikirim.')
    else if (seen.has(port)) problems.push(`${port} terdaftar dua kali.`)
    else seen.add(port)
  })
  return problems
}

export type PortState = 'ok' | 'no_dhm_code' | 'not_found'

/** Whether a port can actually be sent to JPS: it must be a Master Port with a DHM code (port_hub_code). */
export function portState(port: string, options: JpsPortOptions | null): PortState {
  const wanted = port.trim().toUpperCase()
  if (!wanted) return 'not_found'
  if (!options) return 'ok'
  const found = options.ports.find((p) => p.port.toUpperCase() === wanted)
  if (!found) return 'not_found'
  return found.hasDhmCode ? 'ok' : 'no_dhm_code'
}

export const PORT_STATE_WARNING: Record<Exclude<PortState, 'ok'>, string> = {
  no_dhm_code: 'Master Port ini belum punya kode DHM: tidak bisa diaktifkan sebelum kodenya terisi (sinkronkan dengan DHM).',
  not_found: 'Tidak ada Master Port dengan nama ini: pilih dari daftar, atau tambahkan di Master Port dulu.',
}

/** One line per port, for the read-only view. */
export function describePorts(raw: string | null | undefined): string[] {
  return parsePortsValue(raw).map((r) => `${r.port.trim().toUpperCase() || '(kosong)'} · ${r.enabled ? 'aktif' : 'nonaktif'}`)
}
