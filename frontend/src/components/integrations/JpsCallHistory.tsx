'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import api from '@/lib/api'
import { Copy, Loader2, RefreshCw } from 'lucide-react'

/**
 * Integrations > JPS > History: every call KLIP made to JPS, with what was sent and what came back.
 *
 * The list leaves the bodies out; a row loads its own on click. A call that never got a response (a timeout) shows as
 * "no response". The API key is never part of a record. Times are WIB.
 */

interface CallRow {
  id: string
  created_at: string
  kind: string
  method: string
  url: string
  sto_key: string | null
  external_reference: string | null
  response_status: number
  ok: boolean
  error_code: string | null
  error_message: string | null
  request_id: string | null
  duration_ms: number | null
}

interface CallDetail extends CallRow {
  request_params: unknown
  request_body: unknown
  response_body: unknown
}

const PAGE_SIZE = 25
const KINDS = ['submit', 'amend', 'poll', 'recover', 'test', 'other']

function formatWib(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString('en-GB', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function pretty(value: unknown): string {
  if (value === null || value === undefined) return '-'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Clipboard can be blocked (plain http, permissions); the text is still on screen to select.
  }
}

function StatusBadge({ row }: { row: CallRow }) {
  const label = row.response_status ? String(row.response_status) : 'no response'
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
        row.ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
      }`}
      title={row.error_code ? `${row.error_code}${row.error_message ? `: ${row.error_message}` : ''}` : undefined}
    >
      {label}
    </span>
  )
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  const text = pretty(value)
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{title}</p>
        {text !== '-' ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline"
            onClick={() => void copyText(text)}
          >
            <Copy className="h-3 w-3" />
            Copy
          </button>
        ) : null}
      </div>
      <pre className="max-h-72 overflow-auto rounded border border-gray-200 bg-gray-50 p-2 text-[11px] leading-snug text-gray-800">
        {text}
      </pre>
    </div>
  )
}

function DetailPanel({ id }: { id: string }) {
  const [detail, setDetail] = useState<CallDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    setError(null)
    api
      .get(`/integrations/jps/calls/${id}`)
      .then((res) => {
        if (!cancelled) setDetail(res.data.data as CallDetail)
      })
      .catch(() => {
        if (!cancelled) setError('Gagal memuat detail panggilan.')
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (error) return <p className="px-3 py-2 text-xs text-red-600">{error}</p>
  if (!detail) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-gray-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Memuat...
      </div>
    )
  }

  return (
    <div className="space-y-3 bg-white px-3 py-3">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs md:grid-cols-2">
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-gray-500">Request ID (JPS)</dt>
          <dd className="break-all font-mono text-gray-800">{detail.request_id ?? '-'}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-gray-500">External reference</dt>
          <dd className="break-all font-mono text-gray-800">{detail.external_reference ?? '-'}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-gray-500">Error</dt>
          <dd className="break-words text-gray-800">
            {detail.error_code ? `${detail.error_code}: ${detail.error_message ?? ''}` : '-'}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-gray-500">Durasi</dt>
          <dd className="text-gray-800">{detail.duration_ms != null ? `${detail.duration_ms} ms` : '-'}</dd>
        </div>
      </dl>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="space-y-3">
          <JsonBlock title="Request params" value={detail.request_params} />
          <JsonBlock title="Request body" value={detail.request_body} />
        </div>
        <JsonBlock title={`Response${detail.response_status ? ` (${detail.response_status})` : ''}`} value={detail.response_body} />
      </div>
    </div>
  )
}

export function JpsCallHistory() {
  const [items, setItems] = useState<CallRow[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [kind, setKind] = useState('')
  const [outcome, setOutcome] = useState('')
  const [draftQuery, setDraftQuery] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/integrations/jps/calls', {
        params: { limit: PAGE_SIZE, offset, kind, ok: outcome, q: query },
      })
      setItems(res.data.data.items as CallRow[])
      setTotal(Number(res.data.data.pagination.total) || 0)
    } catch {
      setError('Gagal memuat riwayat panggilan JPS.')
    } finally {
      setLoading(false)
    }
  }, [offset, kind, outcome, query])

  useEffect(() => {
    void load()
  }, [load])

  const changeFilter = (apply: () => void) => {
    setOffset(0)
    setOpenId(null)
    apply()
  }

  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(offset + PAGE_SIZE, total)

  return (
    <div className="space-y-3 rounded border border-gray-200 bg-gray-50/60 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11px] text-gray-500">
          Jenis
          <select
            className="mt-0.5 block h-8 rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-800"
            value={kind}
            onChange={(e) => changeFilter(() => setKind(e.target.value))}
          >
            <option value="">Semua</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px] text-gray-500">
          Hasil
          <select
            className="mt-0.5 block h-8 rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-800"
            value={outcome}
            onChange={(e) => changeFilter(() => setOutcome(e.target.value))}
          >
            <option value="">Semua</option>
            <option value="true">Berhasil</option>
            <option value="false">Gagal</option>
          </select>
        </label>
        <label className="min-w-[14rem] flex-1 text-[11px] text-gray-500">
          Cari (STO, reference, request id)
          <Input
            className="mt-0.5 h-8 text-xs"
            value={draftQuery}
            placeholder="mis. OP-1004031960 atau req_5ab6"
            onChange={(e) => setDraftQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') changeFilter(() => setQuery(draftQuery.trim()))
            }}
          />
        </label>
        <Button variant="outline" size="sm" onClick={() => changeFilter(() => setQuery(draftQuery.trim()))}>
          Cari
        </Button>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
          Refresh
        </Button>
      </div>

      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      <div className="overflow-x-auto rounded border border-gray-200 bg-white">
        <table className="w-full min-w-[56rem] text-left text-xs">
          <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2 font-medium">Waktu (WIB)</th>
              <th className="px-3 py-2 font-medium">Jenis</th>
              <th className="px-3 py-2 font-medium">Request</th>
              <th className="px-3 py-2 font-medium">STO</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Request ID</th>
              <th className="px-3 py-2 text-right font-medium">ms</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.length === 0 && !loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                  Belum ada panggilan yang tercatat.
                </td>
              </tr>
            ) : null}
            {items.map((row) => (
              <FragmentRow key={row.id} row={row} open={openId === row.id} onToggle={() => setOpenId(openId === row.id ? null : row.id)} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
        <span>
          {from}-{to} dari {total}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0 || loading}
            onClick={() => changeFilter(() => setOffset(Math.max(0, offset - PAGE_SIZE)))}
          >
            Sebelumnya
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={offset + PAGE_SIZE >= total || loading}
            onClick={() => {
              setOpenId(null)
              setOffset(offset + PAGE_SIZE)
            }}
          >
            Berikutnya
          </Button>
        </div>
      </div>
      <p className="text-[11px] text-gray-400">
        Riwayat disimpan 30 hari. API key tidak pernah ikut tercatat.
      </p>
    </div>
  )
}

function FragmentRow({ row, open, onToggle }: { row: CallRow; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className={`cursor-pointer hover:bg-gray-50 ${open ? 'bg-gray-50' : ''}`} onClick={onToggle}>
        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-gray-700">{formatWib(row.created_at)}</td>
        <td className="px-3 py-2 text-gray-700">{row.kind}</td>
        <td className="px-3 py-2 font-mono text-[11px] text-gray-700">
          <span className="font-semibold">{row.method}</span> {row.url}
        </td>
        <td className="px-3 py-2 font-mono text-[11px] text-gray-700">{row.sto_key ?? '-'}</td>
        <td className="px-3 py-2">
          <StatusBadge row={row} />
        </td>
        <td className="px-3 py-2 font-mono text-[11px] text-gray-600">{row.request_id ?? '-'}</td>
        <td className="px-3 py-2 text-right tabular-nums text-gray-600">{row.duration_ms ?? '-'}</td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={7} className="border-t border-gray-100 p-0">
            <DetailPanel id={row.id} />
          </td>
        </tr>
      ) : null}
    </>
  )
}
