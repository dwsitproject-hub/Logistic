'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import api from '@/lib/api'
import {
  PORT_STATE_WARNING,
  describePorts,
  parsePortsValue,
  portState,
  portsProblems,
  serializePorts,
  type JpsPortOptions,
  type JpsPortRow,
} from '@/lib/jpsPorts'

/** Read-only view of the Ports setting: one line per port, switched on or off. */
export function JpsPortsSummary({ value }: { value: string | null }) {
  const lines = describePorts(value)
  return (
    <div className="space-y-0.5 text-xs text-gray-700">
      {lines.map((line) => (
        <p key={line} className="font-mono">
          {line}
        </p>
      ))}
      {lines.length === 0 ? <p className="text-[0.6875rem] text-gray-500">Belum ada port: tidak ada yang dikirim ke JPS. Klik Edit lalu Tambah port.</p> : null}
    </div>
  )
}

/**
 * The Ports editor: one row per Master Port with a switch. JPS knows a port by its DHM code and has no site or region, so a shipment is sent when its discharge port is
 * switched on here. A new port is added off and switched on once JPS has set it up. The picks are the Master Ports, flagged when one has no DHM code: JPS would refuse
 * a shipment of it, and the server refuses to switch it on.
 */
export function JpsPortsEditor({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const [options, setOptions] = useState<JpsPortOptions | null>(null)
  const [optionsError, setOptionsError] = useState(false)
  const rows = parsePortsValue(value)

  useEffect(() => {
    let cancelled = false
    void api
      .get('/integrations/jps/port-options')
      .then((res) => {
        if (!cancelled) setOptions((res.data?.data as JpsPortOptions) ?? null)
      })
      .catch(() => {
        if (!cancelled) setOptionsError(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const update = (next: JpsPortRow[]) => onChange(serializePorts(next))
  const setRow = (index: number, patch: Partial<JpsPortRow>) => update(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  const problems = portsProblems(rows)

  return (
    <div className="space-y-2">
      <datalist id="jps-port-names">
        {(options?.ports ?? []).map((p) => (
          <option key={p.port} value={p.port}>
            {p.hasDhmCode ? `${p.port} (${p.dhmCode}, ${p.shipments} shipment)` : `${p.port} (belum ada kode DHM)`}
          </option>
        ))}
      </datalist>

      {rows.length === 0 ? (
        <p className="text-xs text-gray-600">Belum ada port: tidak ada yang dikirim ke JPS. Tambahkan port, lalu aktifkan bila sudah siap di JPS.</p>
      ) : null}

      <div className="space-y-2">
        {rows.map((row, i) => {
          const state = portState(row.port, options)
          const warning = state === 'ok' ? null : PORT_STATE_WARNING[state]
          const known = options?.ports.find((p) => p.port.toUpperCase() === row.port.trim().toUpperCase())
          return (
            <div key={i} className="space-y-1 rounded border border-gray-200 bg-gray-50/60 p-2">
              <div className="grid grid-cols-1 items-center gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
                <Input
                  className="h-8 font-mono text-xs"
                  list="jps-port-names"
                  placeholder="Master Port"
                  aria-label="Master Port"
                  value={row.port}
                  onChange={(e) => setRow(i, { port: e.target.value })}
                />
                <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-gray-700">
                  <input type="checkbox" className="h-3.5 w-3.5" checked={row.enabled} onChange={(e) => setRow(i, { enabled: e.target.checked })} />
                  {row.enabled ? 'Aktif' : 'Nonaktif'}
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-gray-500 hover:text-red-600"
                  aria-label={`Hapus ${row.port || 'baris'}`}
                  onClick={() => update(rows.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              {known?.dhmCode ? <p className="text-[0.6875rem] text-gray-500">Kode DHM (port_hub_code): {known.dhmCode}</p> : null}
              {warning ? (
                <p className={`flex items-start gap-1 text-[0.6875rem] ${row.enabled ? 'text-amber-800' : 'text-gray-500'}`}>
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  {warning}
                </p>
              ) : null}
            </div>
          )
        })}
      </div>

      <Button type="button" variant="outline" size="sm" onClick={() => update([...rows, { port: '', enabled: false }])} disabled={rows.length >= 50}>
        <Plus className="mr-1 h-3.5 w-3.5" />
        Tambah port
      </Button>

      {problems.length > 0 ? (
        <ul className="space-y-0.5 text-[0.6875rem] text-red-600">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      {optionsError ? <p className="text-[0.6875rem] text-gray-500">Daftar Master Port tidak bisa dimuat; nama tetap bisa diketik.</p> : null}
    </div>
  )
}
