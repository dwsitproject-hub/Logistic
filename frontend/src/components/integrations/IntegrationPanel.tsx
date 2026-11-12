'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, Pencil, PlugZap, Save, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ApiCallHistory } from '@/components/integrations/ApiCallHistory'
import { DhmFailedPushButton } from '@/components/integrations/DhmPushPanel'
import { KmapsWebhookButton } from '@/components/integrations/KmapsWebhookPanel'
import { SettingRow } from '@/components/integrations/SettingRow'
import api from '@/lib/api'
import {
  buildSaveValues,
  countSettingChanges,
  groupSettings,
  initialDraft,
  isSettingChanged,
  type IntegrationTestResult,
  type IntegrationView,
  type IntegrationsPayload,
} from '@/lib/integrationSettings'

function problemsFrom(error: unknown): string[] {
  const data = (error as { response?: { data?: { error?: { message?: string; problems?: string[] } } } })?.response?.data?.error
  if (data?.problems?.length) return data.problems
  return [data?.message || 'Gagal menyimpan.']
}

interface Props {
  integration: IntegrationView
  secretsKeyConfigured: boolean
  onSaved: (next: IntegrationsPayload) => void
  /** Tells the page whether there are unsaved changes, so it can ask before the user switches to another integration. */
  onDirtyChange: (dirty: boolean) => void
}

type PanelTab = 'settings' | 'history'

/**
 * One integration: its actions, a Settings tab (grouped, view or edit) and a History tab of the calls it made.
 * Secrets stay write-only: a typed secret is dropped from state as soon as it is saved, and a blank secret field means "keep the current one".
 */
export function IntegrationPanel({ integration, secretsKeyConfigured, onSaved, onDirtyChange }: Props) {
  const [tab, setTab] = useState<PanelTab>('settings')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [revert, setRevert] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<IntegrationTestResult | null>(null)

  const changeCount = editing ? countSettingChanges(integration.settings, draft, revert) : 0

  useEffect(() => {
    onDirtyChange(changeCount > 0)
  }, [changeCount, onDirtyChange])

  const startEdit = () => {
    setDraft(initialDraft(integration.settings))
    setRevert(new Set())
    setProblems([])
    setTab('settings')
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
    const values = buildSaveValues(integration.settings, draft, revert)
    if (Object.keys(values).length === 0 && revert.size === 0) {
      setProblems(['Tidak ada perubahan.'])
      return
    }
    setSaving(true)
    setProblems([])
    try {
      const res = await api.put(`/integrations/${integration.id}`, { values, revert: [...revert] })
      onSaved(res.data.data as IntegrationsPayload)
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
      setTest(res.data.data as IntegrationTestResult)
    } catch {
      setTest({ ok: false, message: 'Permintaan tes gagal.', elapsedMs: 0 })
    } finally {
      setTesting(false)
    }
  }

  const groups = groupSettings(integration.settings)

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white" aria-label={integration.name}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-gray-900">{integration.name}</h3>
          <p className="mt-0.5 text-sm text-gray-500">{integration.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {integration.id === 'dhm' ? <DhmFailedPushButton /> : null}
          {integration.id === 'kmaps' ? <KmapsWebhookButton /> : null}
          <Button variant="outline" size="sm" onClick={() => void runTest()} disabled={testing || editing}>
            {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <PlugZap className="mr-2 h-4 w-4" aria-hidden />}
            Test connection
          </Button>
          {!editing ? (
            <Button size="sm" onClick={startEdit}>
              <Pencil className="mr-2 h-4 w-4" aria-hidden />
              Edit
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex gap-1 border-b border-gray-200 px-4" role="tablist" aria-label={`${integration.name} sections`}>
        {(
          [
            ['settings', 'Settings'],
            ['history', 'History'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={
              tab === id
                ? 'border-b-2 border-blue-600 px-3 py-2 text-sm font-medium text-blue-700'
                : 'border-b-2 border-transparent px-3 py-2 text-sm text-gray-600 hover:text-gray-900'
            }
          >
            {label}
          </button>
        ))}
      </div>

      {test ? (
        <div
          className={`mx-5 mt-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
            test.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'
          }`}
          role="status"
        >
          {test.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
          <span>
            {test.message}
            {test.elapsedMs ? <span className="ml-1 text-gray-500">({test.elapsedMs} ms)</span> : null}
          </span>
        </div>
      ) : null}

      {tab === 'history' ? (
        <div className="p-5">
          <ApiCallHistory integration={integration.id} />
        </div>
      ) : (
        <div>
          {problems.length > 0 ? (
            <div className="mx-5 mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              <p className="font-medium">Tidak disimpan - perbaiki dulu:</p>
              <ul className="mt-1 list-disc pl-5">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {groups.map((group) => (
            <div key={group.id}>
              <h4 className="px-5 pb-1 pt-4 text-[0.6875rem] font-semibold uppercase tracking-wide text-gray-400">{group.title}</h4>
              <div className="divide-y divide-gray-100 border-y border-gray-100">
                {group.settings.map((setting) => (
                  <SettingRow
                    key={setting.key}
                    setting={setting}
                    editing={editing}
                    secretsKeyConfigured={secretsKeyConfigured}
                    draft={draft[setting.key] ?? ''}
                    onDraft={(value) => setDraft((d) => ({ ...d, [setting.key]: value }))}
                    changed={editing && (revert.has(setting.key) || isSettingChanged(setting, draft[setting.key]))}
                    reverting={revert.has(setting.key)}
                    onToggleRevert={() => toggleRevert(setting.key)}
                  />
                ))}
              </div>
            </div>
          ))}

          {editing ? (
            <div
              className={`sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3 ${
                changeCount > 0 ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'
              }`}
              role="status"
              aria-live="polite"
            >
              <p className={changeCount > 0 ? 'flex items-center gap-1.5 text-xs text-amber-800' : 'text-xs text-gray-500'}>
                {changeCount > 0 ? <AlertCircle className="h-4 w-4 shrink-0" aria-hidden /> : null}
                {changeCount > 0
                  ? `${changeCount} perubahan belum disimpan`
                  : 'Belum ada perubahan. Kosongkan credential untuk tetap memakai yang lama.'}
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={cancel} disabled={saving}>
                  Cancel
                </Button>
                <Button type="button" size="sm" onClick={() => void save()} disabled={saving || changeCount === 0}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Save className="mr-2 h-4 w-4" aria-hidden />}
                  {saving ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="h-4" />
          )}
        </div>
      )}
    </section>
  )
}
