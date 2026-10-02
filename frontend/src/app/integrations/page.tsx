'use client'

import { useCallback, useEffect, useState } from 'react'
import Layout from '@/components/Layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ApiCallHistory } from '@/components/integrations/ApiCallHistory'
import api from '@/lib/api'
import { AlertTriangle, CheckCircle2, History, Loader2, Plug, RotateCcw, XCircle } from 'lucide-react'

/**
 * Integrations (ADMIN only): DHM and JPS settings and credentials.
 *
 * Secrets are write-only. The API never returns one - only a hint (prefix, last four, length) - and
 * a secret typed here is dropped from state as soon as it is saved. Leaving a secret field blank
 * means "keep the current one".
 */

type SettingKind = 'secret' | 'url' | 'boolean' | 'integer' | 'cron' | 'text'
type SettingSource = 'database' | 'env' | 'unset'

interface SettingView {
  key: string
  label: string
  kind: SettingKind
  help?: string
  requiresRestart: boolean
  min?: number
  prefix?: string
  source: SettingSource
  value: string | null
  hint: string | null
  updatedByName: string | null
  updatedAt: string | null
  error: string | null
}

interface IntegrationView {
  id: 'dhm' | 'jps'
  name: string
  description: string
  settings: SettingView[]
}

interface Payload {
  secretsKeyConfigured: boolean
  integrations: IntegrationView[]
}

type TestResult = { ok: boolean; message: string; elapsedMs: number }

const SOURCE_BADGE: Record<SettingSource, { label: string; className: string; title: string }> = {
  database: {
    label: 'KLIP',
    className: 'bg-blue-50 text-blue-700',
    title: 'Disimpan lewat menu ini; menggantikan nilai di .env',
  },
  env: { label: '.env', className: 'bg-gray-100 text-gray-600', title: 'Dibaca dari .env di server' },
  unset: { label: 'Belum diisi', className: 'bg-amber-50 text-amber-700', title: 'Tidak ada di menu ini maupun .env' },
}

function formatWhen(value: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

function problemsFrom(error: unknown): string[] {
  const data = (error as { response?: { data?: { error?: { message?: string; problems?: string[] } } } })
    ?.response?.data?.error
  if (data?.problems?.length) return data.problems
  return [data?.message || 'Gagal menyimpan.']
}

function IntegrationCard({
  integration,
  secretsKeyConfigured,
  onSaved,
}: {
  integration: IntegrationView
  secretsKeyConfigured: boolean
  onSaved: (next: Payload) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [revert, setRevert] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<TestResult | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  const startEdit = () => {
    const initial: Record<string, string> = {}
    for (const s of integration.settings) {
      // Secrets start blank: "blank = keep". Everything else starts at its current value.
      initial[s.key] = s.kind === 'secret' ? '' : s.value ?? ''
    }
    setDraft(initial)
    setRevert(new Set())
    setProblems([])
    setEditing(true)
  }

  const cancel = () => {
    setDraft({})
    setRevert(new Set())
    setProblems([])
    setEditing(false)
  }

  const toggleRevert = (key: string) => {
    setRevert((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const save = async () => {
    const values: Record<string, string> = {}
    for (const s of integration.settings) {
      if (revert.has(s.key)) continue
      const v = draft[s.key] ?? ''
      if (s.kind === 'secret') {
        if (v !== '') values[s.key] = v
      } else if (v !== (s.value ?? '')) {
        values[s.key] = v
      }
    }
    if (Object.keys(values).length === 0 && revert.size === 0) {
      setProblems(['Tidak ada perubahan.'])
      return
    }
    setSaving(true)
    setProblems([])
    try {
      const res = await api.put(`/integrations/${integration.id}`, { values, revert: [...revert] })
      onSaved(res.data.data as Payload)
      // Drop every typed secret now that it is stored.
      setDraft({})
      setRevert(new Set())
      setEditing(false)
      setTest(null)
    } catch (error) {
      setProblems(problemsFrom(error))
    } finally {
      setSaving(false)
    }
  }

  const runTest = async () => {
    setTesting(true)
    setTest(null)
    try {
      const res = await api.post(`/integrations/${integration.id}/test`)
      setTest(res.data.data as TestResult)
    } catch {
      setTest({ ok: false, message: 'Permintaan tes gagal.', elapsedMs: 0 })
    } finally {
      setTesting(false)
    }
  }

  const needsRestart = integration.settings.some((s) => s.requiresRestart)

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Plug className="h-4 w-4 text-gray-500" />
            {integration.name}
          </CardTitle>
          <p className="mt-1 text-xs text-gray-500">{integration.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setHistoryOpen((open) => !open)}>
            <History className="mr-1 h-3.5 w-3.5" />
            {historyOpen ? 'Hide history' : 'History'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void runTest()} disabled={testing || editing}>
            {testing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            Test connection
          </Button>
          {!editing ? (
            <Button size="sm" onClick={startEdit}>
              Edit
            </Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={cancel} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void save()} disabled={saving}>
                {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                Save
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {historyOpen ? <ApiCallHistory integration={integration.id} /> : null}

        {test ? (
          <div
            className={`flex items-start gap-2 rounded border px-3 py-2 text-xs ${
              test.ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            {test.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            <span>
              {test.message}
              {test.elapsedMs ? <span className="ml-1 text-gray-500">({test.elapsedMs} ms)</span> : null}
            </span>
          </div>
        ) : null}

        {problems.length > 0 ? (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <p className="font-medium">Tidak disimpan - perbaiki dulu:</p>
            <ul className="mt-1 list-disc pl-4">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {needsRestart ? (
          <p className="text-[11px] text-gray-500">
            Field bertanda <span className="font-medium text-amber-700">restart</span> dibaca sekali saat backend
            start - perubahan baru berlaku setelah backend di-restart.
          </p>
        ) : null}

        <div className="divide-y divide-gray-100 rounded border border-gray-100">
          {integration.settings.map((s) => {
            const badge = SOURCE_BADGE[s.source]
            const reverting = revert.has(s.key)
            const secretBlocked = s.kind === 'secret' && !secretsKeyConfigured
            return (
              <div key={s.key} className="grid grid-cols-1 gap-2 px-3 py-2.5 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-medium text-gray-800">{s.label}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${badge.className}`}
                      title={badge.title}
                    >
                      {badge.label}
                    </span>
                    {s.requiresRestart ? (
                      <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700">
                        restart
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 font-mono text-[10px] text-gray-400">{s.key}</p>
                </div>

                <div className="min-w-0 space-y-1">
                  {!editing ? (
                    <p className="break-all font-mono text-xs text-gray-700">
                      {s.kind === 'secret' ? s.hint ?? '-' : s.value ?? '-'}
                    </p>
                  ) : reverting ? (
                    <p className="text-xs italic text-gray-500">Akan dikembalikan ke nilai .env saat disimpan.</p>
                  ) : s.kind === 'boolean' ? (
                    <select
                      className="h-8 rounded-md border border-gray-300 bg-white px-2 text-xs"
                      value={draft[s.key] ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))}
                    >
                      <option value="">-</option>
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : (
                    <Input
                      className="h-8 font-mono text-xs"
                      type={s.kind === 'secret' ? 'password' : s.kind === 'integer' ? 'number' : 'text'}
                      // Keep the browser's saved passwords out of an API-key field.
                      autoComplete={s.kind === 'secret' ? 'new-password' : 'off'}
                      min={s.min}
                      disabled={secretBlocked}
                      placeholder={
                        s.kind === 'secret'
                          ? secretBlocked
                            ? 'INTEGRATION_SECRETS_KEY belum dikonfigurasi'
                            : s.hint
                              ? `Kosongkan untuk tetap memakai ${s.hint}`
                              : s.prefix
                                ? `Diawali ${s.prefix}`
                                : 'Masukkan nilai baru'
                          : ''
                      }
                      value={draft[s.key] ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))}
                    />
                  )}

                  {s.help ? <p className="text-[11px] text-gray-500">{s.help}</p> : null}
                  {s.error ? (
                    <p className="flex items-center gap-1 text-[11px] text-red-600">
                      <AlertTriangle className="h-3 w-3" />
                      Nilai tersimpan tidak bisa dibaca ({s.error}) - sementara memakai .env.
                    </p>
                  ) : null}
                  {s.source === 'database' && s.updatedAt ? (
                    <p className="text-[10px] text-gray-400">
                      Diubah {formatWhen(s.updatedAt)}
                      {s.updatedByName ? ` oleh ${s.updatedByName}` : ''}
                    </p>
                  ) : null}
                  {editing && s.source === 'database' ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline"
                      onClick={() => toggleRevert(s.key)}
                    >
                      <RotateCcw className="h-3 w-3" />
                      {reverting ? 'Batal kembalikan' : 'Kembalikan ke .env'}
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

export default function IntegrationsPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await api.get('/integrations')
      setData(res.data.data as Payload)
    } catch {
      setLoadError('Gagal memuat konfigurasi integrasi.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <p className="text-sm text-gray-500">
            Konfigurasi integrasi dengan sistem lain. Nilai yang disimpan di sini menggantikan nilai di .env server;
            credential disimpan terenkripsi dan tidak pernah ditampilkan kembali.
          </p>
        </div>

        {data && !data.secretsKeyConfigured ? (
          <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <span className="font-medium">INTEGRATION_SECRETS_KEY belum dikonfigurasi di server.</span> Credential
              (private key, API key, webhook secret) belum bisa disimpan dari menu ini. Setting lain tetap bisa
              diubah.
            </span>
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Memuat...
          </div>
        ) : loadError ? (
          <div className="space-y-2">
            <p className="text-sm text-red-600">{loadError}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Coba lagi
            </Button>
          </div>
        ) : (
          data?.integrations.map((integration) => (
            <IntegrationCard
              key={integration.id}
              integration={integration}
              secretsKeyConfigured={data.secretsKeyConfigured}
              onSaved={setData}
            />
          ))
        )}
      </div>
    </Layout>
  )
}
