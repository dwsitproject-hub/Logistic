'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Mail, Plus, Save, Send, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import api from '@/lib/api'

/**
 * Integrations > JPS > Email notifications: the mail sent after Submit to Jetty, one RULE per discharge port plus a Default for every port without its own.
 *
 * A rule holds who receives it (To, cc), the subject, the body and an on/off switch. A port's own rule always wins over the Default, including a port rule that is
 * switched off (that port then sends nothing). The master switch ("Email after Submit to Jetty") is an ordinary setting of the JPS panel and turns all of it off.
 * Outside production every mail goes only to the test address, whatever a rule says; the modal says so.
 */

interface Rule {
  id: string
  port: string | null
  enabled: boolean
  emailTo: string
  emailCc: string
  subject: string
  body: string
  updatedAt: string | null
}

interface RulesData {
  rules: Rule[]
  masterSwitchOn: boolean
  production: boolean
  testRecipient: string | null
}

interface Draft {
  /** null = the default rule. */
  port: string | null
  enabled: boolean
  emailTo: string
  emailCc: string
  subject: string
  body: string
  /** true until the first save of a port rule that is not in the database yet. */
  isNew: boolean
}

const PLACEHOLDERS = '{vessel} {commodity} {shipper} {loading_port} {discharge_port} {qty_kg} {eta} {incoterm} {sto_number} {revision} {revision_note} {po_table}'

const DEFAULT_KEY = '__default__'

function draftOf(rule: Rule): Draft {
  return { port: rule.port, enabled: rule.enabled, emailTo: rule.emailTo, emailCc: rule.emailCc, subject: rule.subject, body: rule.body, isNew: false }
}

function countAddresses(text: string): number {
  return text.split(/[,;\r\n]+/).filter((part) => part.trim() !== '').length
}

function errorMessage(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { error?: { message?: string } } } }
  return e?.response?.data?.error?.message || fallback
}

const fieldClass =
  'w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-300'

export function JpsNotifyButton() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<RulesData | null>(null)
  const [portOptions, setPortOptions] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<string>(DEFAULT_KEY)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState<'save' | 'test' | 'delete' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newPort, setNewPort] = useState('')

  const select = useCallback((rules: Rule[], key: string) => {
    const rule = rules.find((r) => (r.port ?? DEFAULT_KEY) === key) ?? rules.find((r) => r.port === null) ?? null
    setSelected(rule ? (rule.port ?? DEFAULT_KEY) : DEFAULT_KEY)
    setDraft(rule ? draftOf(rule) : null)
    setDirty(false)
  }, [])

  const load = useCallback(
    async (keepKey?: string) => {
      setLoading(true)
      setError(null)
      try {
        const [rulesRes, portsRes] = await Promise.all([
          api.get('/integrations/jps/notify-rules'),
          api.get('/integrations/jps/port-options').catch(() => null),
        ])
        const next = rulesRes.data?.data as RulesData
        setData(next)
        const ports = (portsRes?.data?.data?.ports ?? []) as Array<{ port: string }>
        setPortOptions(ports.map((p) => p.port))
        select(next.rules, keepKey ?? DEFAULT_KEY)
      } catch (err) {
        setError(errorMessage(err, 'Gagal memuat aturan email.'))
      } finally {
        setLoading(false)
      }
    },
    [select],
  )

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const rules = data?.rules ?? []
  const defaultRule = rules.find((r) => r.port === null) ?? null
  const portsWithoutRule = useMemo(() => portOptions.filter((p) => !rules.some((r) => r.port === p)), [portOptions, rules])

  const change = (patch: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d))
    setDirty(true)
    setMessage(null)
  }

  const choose = (key: string) => {
    if (dirty && !window.confirm('Perubahan belum disimpan akan hilang. Lanjut pindah?')) return
    setMessage(null)
    setError(null)
    select(rules, key)
  }

  const addPortRule = () => {
    const port = newPort.trim().toUpperCase()
    if (!port) return
    if (dirty && !window.confirm('Perubahan belum disimpan akan hilang. Lanjut?')) return
    // A new port rule starts from the Default's wording, with nobody to send to yet.
    setSelected(port)
    setDraft({ port, enabled: false, emailTo: '', emailCc: '', subject: defaultRule?.subject ?? '', body: defaultRule?.body ?? '', isNew: true })
    setDirty(true)
    setNewPort('')
    setMessage('Aturan baru untuk ' + port + ': isi penerima lalu simpan. Judul dan isi disalin dari Default.')
    setError(null)
  }

  const save = async () => {
    if (!draft) return
    setBusy('save')
    setMessage(null)
    setError(null)
    try {
      await api.put('/integrations/jps/notify-rules', {
        port: draft.port,
        enabled: draft.enabled,
        emailTo: draft.emailTo,
        emailCc: draft.emailCc,
        subject: draft.subject,
        body: draft.body,
      })
      await load(draft.port ?? DEFAULT_KEY)
      setMessage('Tersimpan.')
    } catch (err) {
      setError(errorMessage(err, 'Gagal menyimpan aturan.'))
    } finally {
      setBusy(null)
    }
  }

  const sendTest = async () => {
    if (!draft) return
    setBusy('test')
    setMessage(null)
    setError(null)
    try {
      const res = await api.post('/integrations/jps/notify-rules/test', { port: draft.port, subject: draft.subject, body: draft.body })
      setMessage(`Email uji dikirim ke ${String(res.data?.data?.sentTo ?? 'alamat Anda')} (data contoh, bukan pengiriman sebenarnya).`)
    } catch (err) {
      setError(errorMessage(err, 'Gagal mengirim email uji.'))
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    const rule = rules.find((r) => r.port === draft?.port)
    if (!draft || !rule || draft.port === null) return
    if (!window.confirm(`Hapus aturan ${draft.port}? Pelabuhan ini lalu memakai aturan Default.`)) return
    setBusy('delete')
    setMessage(null)
    setError(null)
    try {
      await api.delete(`/integrations/jps/notify-rules/${rule.id}`)
      await load(DEFAULT_KEY)
      setMessage('Aturan dihapus.')
    } catch (err) {
      setError(errorMessage(err, 'Gagal menghapus aturan.'))
    } finally {
      setBusy(null)
    }
  }

  const ruleLabel = (rule: Rule) => (rule.port === null ? 'Default (pelabuhan lain)' : rule.port)

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} title="Penerima dan isi email setelah Submit to Jetty, per pelabuhan">
        <Mail className="mr-1 h-3.5 w-3.5" />
        Email notifications
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90vh] max-w-6xl flex-col gap-3">
          <DialogHeader>
            <DialogTitle>Email setelah Submit to Jetty</DialogTitle>
            <DialogDescription>
              Satu aturan per pelabuhan tujuan, ditambah aturan Default untuk pelabuhan yang belum punya aturan sendiri. Aturan pelabuhan selalu menang atas Default, termasuk
              kalau aturan itu dimatikan (pelabuhan itu lalu tidak mengirim email). Email dikirim hanya saat tombol Submit to Jetty ditekan dan JPS menerima instruksinya.
            </DialogDescription>
          </DialogHeader>

          {data && !data.masterSwitchOn ? (
            <p className="flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Saklar utama &quot;Email after Submit to Jetty&quot; di pengaturan JPS sedang mati, jadi tidak ada email yang terkirim walau aturan di bawah aktif.
            </p>
          ) : null}
          {data && !data.production ? (
            <p className="flex items-center gap-2 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-900">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Ini bukan produksi: semua email hanya dikirim ke {data.testRecipient ?? 'alamat uji'} (diberi awalan [TEST]), apa pun isi Email to dan cc.
            </p>
          ) : null}
          {error ? <p className="text-xs text-red-700">{error}</p> : null}

          {loading && !data ? (
            <p className="flex items-center gap-2 text-sm text-gray-600">
              <Loader2 className="h-4 w-4 animate-spin" /> Memuat...
            </p>
          ) : (
            <div className="grid min-h-0 flex-1 gap-4 overflow-auto md:grid-cols-[16rem_minmax(0,1fr)]">
              <div className="space-y-2">
                <ul className="space-y-1">
                  {rules.map((rule) => {
                    const key = rule.port ?? DEFAULT_KEY
                    const recipients = countAddresses(rule.emailTo) + countAddresses(rule.emailCc)
                    return (
                      <li key={rule.id}>
                        <button
                          type="button"
                          onClick={() => choose(key)}
                          className={`w-full rounded-md border px-3 py-2 text-left text-xs ${
                            selected === key ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'
                          }`}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="font-medium text-gray-900">{ruleLabel(rule)}</span>
                            <span className={`rounded-full px-1.5 py-0.5 text-[0.625rem] font-medium ${rule.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'}`}>
                              {rule.enabled ? 'Aktif' : 'Mati'}
                            </span>
                          </span>
                          <span className="mt-0.5 block text-gray-500">{recipients > 0 ? `${recipients} penerima` : 'Belum ada penerima'}</span>
                        </button>
                      </li>
                    )
                  })}
                  {draft?.isNew && draft.port ? (
                    <li>
                      <div className="w-full rounded-md border border-dashed border-blue-300 bg-blue-50 px-3 py-2 text-xs">
                        <span className="font-medium text-gray-900">{draft.port}</span>
                        <span className="mt-0.5 block text-gray-500">Baru, belum disimpan</span>
                      </div>
                    </li>
                  ) : null}
                </ul>

                <div className="space-y-1.5 rounded-md border border-gray-200 p-2">
                  <label className="block text-[0.6875rem] font-medium text-gray-600" htmlFor="jps-notify-new-port">
                    Tambah aturan pelabuhan
                  </label>
                  <select
                    id="jps-notify-new-port"
                    className="h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-xs"
                    value={newPort}
                    onChange={(e) => setNewPort(e.target.value)}
                  >
                    <option value="">Pilih pelabuhan...</option>
                    {portsWithoutRule.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <Button variant="outline" size="sm" className="w-full" onClick={addPortRule} disabled={!newPort}>
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Tambah
                  </Button>
                </div>
              </div>

              {draft ? (
                <div className="min-w-0 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-gray-900">{draft.port === null ? 'Default (semua pelabuhan tanpa aturan sendiri)' : draft.port}</h3>
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-700">
                      <input type="checkbox" checked={draft.enabled} onChange={(e) => change({ enabled: e.target.checked })} />
                      Aturan aktif
                    </label>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="jps-notify-to">
                        Email to
                      </label>
                      <textarea id="jps-notify-to" className={fieldClass} rows={4} spellCheck={false} value={draft.emailTo} onChange={(e) => change({ emailTo: e.target.value })} />
                      <p className="mt-0.5 text-[0.6875rem] text-gray-500">{countAddresses(draft.emailTo)} alamat. Pisahkan dengan koma atau baris baru.</p>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="jps-notify-cc">
                        Email cc
                      </label>
                      <textarea id="jps-notify-cc" className={fieldClass} rows={4} spellCheck={false} value={draft.emailCc} onChange={(e) => change({ emailCc: e.target.value })} />
                      <p className="mt-0.5 text-[0.6875rem] text-gray-500">{countAddresses(draft.emailCc)} alamat. Boleh kosong.</p>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="jps-notify-subject">
                      Subjek
                    </label>
                    <Input id="jps-notify-subject" className="h-9 font-mono text-xs" value={draft.subject} onChange={(e) => change({ subject: e.target.value })} />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="jps-notify-body">
                      Isi email
                    </label>
                    <textarea id="jps-notify-body" className={fieldClass} rows={14} spellCheck={false} value={draft.body} onChange={(e) => change({ body: e.target.value })} />
                    <p className="mt-0.5 text-[0.6875rem] text-gray-500">
                      Placeholder: <span className="font-mono">{PLACEHOLDERS}</span>. {'{po_table}'} adalah tabel Shipper / Kontrak / PO / Qty beserta TOTAL; {'{revision_note}'} kosong untuk
                      pengiriman pertama dan terbaca &quot; (Revisi R2)&quot; saat Resubmit. Kosongkan subjek atau isi untuk memakai format bawaan.
                    </p>
                  </div>

                  {message ? (
                    <p className="flex items-center gap-1.5 text-xs text-emerald-800">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {message}
                    </p>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={() => void save()} disabled={busy !== null || !dirty}>
                      {busy === 'save' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
                      Simpan
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void sendTest()} disabled={busy !== null} title="Kirim email contoh ke alamat akun Anda saja, bukan ke penerima aturan ini">
                      {busy === 'test' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5" />}
                      Kirim uji ke saya
                    </Button>
                    {draft.port !== null && !draft.isNew ? (
                      <Button variant="outline" size="sm" onClick={() => void remove()} disabled={busy !== null} className="ml-auto text-red-700 hover:bg-red-50">
                        {busy === 'delete' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1 h-3.5 w-3.5" />}
                        Hapus aturan
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
