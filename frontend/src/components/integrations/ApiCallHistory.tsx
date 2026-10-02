'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import api from '@/lib/api'
import { Check, Copy, Loader2, RefreshCw } from 'lucide-react'

/**
 * Integrations > JPS | DHM > History: every call KLIP made to the other system, with what was sent and what came back.
 *
 * The list leaves the bodies out; a row loads its own on click. A call that never got a response (a timeout) shows as
 * "no response". Credentials are never part of a record (the DHM private key is replaced before it is stored). Times
 * are WIB.
 */

type IntegrationId = 'jps' | 'dhm'

interface CallRow {
  id: string
  created_at: string
  kind: string
  method: string
  url: string
  /** The STO key (JPS) or the slug (DHM). */
  subject: string | null
  /** The external reference (JPS) or the record code (DHM). */
  reference: string | null
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

const WORDING: Record<IntegrationId, { kinds: string[]; subject: string; reference: string; placeholder: string }> = {
  jps: {
    kinds: ['submit', 'amend', 'poll', 'recover', 'test', 'other'],
    subject: 'STO',
    reference: 'External reference',
    placeholder: 'mis. OP-1004031960 atau req_5ab6',
  },
  dhm: {
    kinds: ['auth', 'push', 'sync', 'catalog', 'lookup', 'other'],
    subject: 'Slug',
    reference: 'Kode record',
    placeholder: 'mis. company, ORG-0003 atau req_5ab6',
  },
}

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

/**
 * Copy to the clipboard, and say whether it worked.
 *
 * SIT is served over plain http, where `navigator.clipboard` does not exist (it is limited to secure contexts), so the
 * first version of the Copy button did nothing and said nothing. The fallback selects the text in a hidden textarea
 * and uses the old `execCommand('copy')`, which still works over http.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the textarea route
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '0'
    area.style.left = '0'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.focus()
    area.select()
    const done = document.execCommand('copy')
    document.body.removeChild(area)
    return done
  } catch {
    return false
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
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null)

  const copy = async () => {
    const done = await copyText(text)
    setCopied(done ? 'ok' : 'failed')
    window.setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{title}</p>
        {text !== '-' ? (
          <button
            type="button"
            className={`inline-flex items-center gap-1 text-[11px] hover:underline ${
              copied === 'failed' ? 'text-red-600' : copied === 'ok' ? 'text-green-700' : 'text-blue-600'
            }`}
            onClick={() => void copy()}
          >
            {copied === 'ok' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied === 'ok' ? 'Tersalin' : copied === 'failed' ? 'Gagal - blok teks lalu Ctrl+C' : 'Copy'}
          </button>
        ) : null}
      </div>
      <pre className="max-h-72 overflow-auto rounded border border-gray-200 bg-gray-50 p-2 text-[11px] leading-snug text-gray-800">
        {text}
      </pre>
    </div>
  )
}

function DetailPanel({ integration, id }: { integration: IntegrationId; id: string }) {
  const [detail, setDetail] = useState<CallDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    setError(null)
    api
      .get(`/integrations/${integration}/calls/${id}`)
      .then((res) => {
        if (!cancelled) setDetail(res.data.data as CallDetail)
      })
      .catch(() => {
        if (!cancelled) setError('Gagal memuat detail panggilan.')
      })
    return () => {
      cancelled = true
    }
  }, [integration, id])

  if (error) return <p className="px-3 py-2 text-xs text-red-600">{error}</p>
  if (!detail) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-gray-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Memuat...
      </div>
    )
  }

  const wording = WORDING[integration]
  return (
    <div className="space-y-3 bg-white px-3 py-3">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs md:grid-cols-2">
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-gray-500">Request ID</dt>
          <dd className="break-all font-mono text-gray-800">{detail.request_id ?? '-'}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-gray-500">{wording.reference}</dt>
          <dd className="break-all font-mono text-gray-800">{detail.reference ?? '-'}</dd>
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

function CallRowView({
  integration,
  row,
  open,
  onToggle,
}: {
  integration: IntegrationId
  row: CallRow
  open: boolean
  onToggle: () => void
}) {
  return (
    <>
      <tr className={`cursor-pointer hover:bg-gray-50 ${open ? 'bg-gray-50' : ''}`} onClick={onToggle}>
        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-gray-700">{formatWib(row.created_at)}</td>
        <td className="px-3 py-2 text-gray-700">{row.kind}</td>
        <td className="px-3 py-2 font-mono text-[11px] text-gray-700">
          <span className="font-semibold">{row.method}</span> {row.url}
        </td>
        <td className="px-3 py-2 font-mono text-[11px] text-gray-700">{row.subject ?? '-'}</td>
        <td className="px-3 py-2 font-mono text-[11px] text-gray-700">
          {integration === 'dhm' ? row.reference ?? '-' : ''}
        </td>
        <td className="px-3 py-2">
          <StatusBadge row={row} />
        </td>
        <td className="px-3 py-2 font-mono text-[11px] text-gray-600">{row.request_id ?? '-'}</td>
        <td className="px-3 py-2 text-right tabular-nums text-gray-600">{row.duration_ms ?? '-'}</td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={8} className="border-t border-gray-100 p-0">
            <DetailPanel integration={integration} id={row.id} />
          </td>
        </tr>
      ) : null}
    </>
  )
}

export function ApiCallHistory({ integration }: { integration: IntegrationId }) {
  const wording = WORDING[integration]
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
      const res = await api.get(`/integrations/${integration}/calls`, {
        params: { limit: PAGE_SIZE, offset, kind, ok: outcome, q: query },
      })
      setItems(res.data.data.items as CallRow[])
      setTotal(Number(res.data.data.pagination.total) || 0)
    } catch {
      setError('Gagal memuat riwayat panggilan.')
    } finally {
      setLoading(false)
    }
  }, [integration, offset, kind, outcome, query])

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
            {wording.kinds.map((k) => (
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
          Cari ({wording.subject}, {wording.reference.toLowerCase()}, request id)
          <Input
            className="mt-0.5 h-8 text-xs"
            value={draftQuery}
            placeholder={wording.placeholder}
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
        <table className="w-full min-w-[60rem] text-left text-xs">
          <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2 font-medium">Waktu (WIB)</th>
              <th className="px-3 py-2 font-medium">Jenis</th>
              <th className="px-3 py-2 font-medium">Request</th>
              <th className="px-3 py-2 font-medium">{wording.subject}</th>
              <th className="px-3 py-2 font-medium">{integration === 'dhm' ? wording.reference : ''}</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Request ID</th>
              <th className="px-3 py-2 text-right font-medium">ms</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.length === 0 && !loading ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-gray-500">
                  Belum ada panggilan yang tercatat.
                </td>
              </tr>
            ) : null}
            {items.map((row) => (
              <CallRowView
                key={row.id}
                integration={integration}
                row={row}
                open={openId === row.id}
                onToggle={() => setOpenId(openId === row.id ? null : row.id)}
              />
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
        Riwayat disimpan 30 hari. Kredensial (API key, private key) tidak pernah ikut tercatat.
        {integration === 'dhm' ? ' Respons bacaan yang berhasil (sync, katalog) hanya disimpan 2.000 karakter pertama.' : ''}
      </p>
    </div>
  )
}
