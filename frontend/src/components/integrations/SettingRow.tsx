'use client'

import { AlertTriangle, Lock, RotateCcw } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { JpsPortsEditor, JpsPortsSummary } from '@/components/integrations/JpsPortsField'
import type { SettingSource, SettingView } from '@/lib/integrationSettings'

const SOURCE: Record<SettingSource, { label: string; className: string; title: string }> = {
  database: { label: 'KLIP', className: 'bg-blue-50 text-blue-700', title: 'Disimpan lewat menu ini; menggantikan nilai di .env' },
  env: { label: '.env', className: 'bg-gray-100 text-gray-600', title: 'Dibaca dari .env di server' },
  unset: { label: 'Belum diisi', className: 'bg-amber-50 text-amber-700', title: 'Tidak ada di menu ini maupun .env' },
}

function formatWhen(value: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

/** A small on/off switch. Read-only (disabled) in view mode. */
function Switch({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange?: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-default ${
        on ? 'bg-emerald-500' : 'bg-gray-300'
      }`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? 'left-[1.125rem]' : 'left-0.5'}`} />
    </button>
  )
}

interface Props {
  setting: SettingView
  editing: boolean
  secretsKeyConfigured: boolean
  /** The value typed so far (edit mode). */
  draft: string
  onDraft: (value: string) => void
  changed: boolean
  reverting: boolean
  onToggleRevert: () => void
}

/** One setting: its name and explanation on the left, its value (or its input, while editing) on the right. */
export function SettingRow({ setting: s, editing, secretsKeyConfigured, draft, onDraft, changed, reverting, onToggleRevert }: Props) {
  const source = SOURCE[s.source]
  const secretBlocked = s.kind === 'secret' && !secretsKeyConfigured
  const isOn = (v: string | null) => String(v ?? '').toLowerCase() === 'true'

  let value
  if (!editing) {
    if (s.kind === 'ports') value = <JpsPortsSummary value={s.value} />
    else if (s.kind === 'boolean')
      value = (
        <span className="flex items-center gap-2 text-sm text-gray-700">
          <Switch on={isOn(s.value)} disabled label={s.label} />
          {s.value == null ? '-' : isOn(s.value) ? 'Aktif' : 'Mati'}
        </span>
      )
    else if (s.kind === 'secret')
      value = (
        <span className="flex items-center gap-1.5 break-all font-mono text-xs text-gray-700">
          <Lock className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
          {s.hint ?? '-'}
        </span>
      )
    else value = <span className="break-all font-mono text-xs text-gray-700">{s.value ?? '-'}</span>
  } else if (reverting) {
    value = <p className="text-xs italic text-gray-500">Akan dikembalikan ke nilai .env saat disimpan.</p>
  } else if (s.kind === 'ports') {
    value = <JpsPortsEditor value={draft} onChange={onDraft} />
  } else if (s.kind === 'boolean') {
    value = (
      <span className="flex items-center gap-2 text-sm text-gray-700">
        <Switch on={isOn(draft)} onChange={(next) => onDraft(next ? 'true' : 'false')} label={s.label} />
        {draft === '' ? 'Belum diatur' : isOn(draft) ? 'Aktif' : 'Mati'}
      </span>
    )
  } else {
    value = (
      <Input
        className="h-9 font-mono text-xs"
        type={s.kind === 'secret' ? 'password' : s.kind === 'integer' ? 'number' : 'text'}
        // Keep the browser's saved passwords out of an API-key field.
        autoComplete={s.kind === 'secret' ? 'new-password' : 'off'}
        min={s.min}
        disabled={secretBlocked}
        aria-label={s.label}
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
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
      />
    )
  }

  return (
    <div className={`grid grid-cols-1 gap-2 px-5 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:gap-6 ${changed ? 'bg-blue-50/40' : ''}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium text-gray-900" title={s.key}>
            {s.label}
          </span>
          <span className={`rounded-full px-1.5 py-0.5 text-[0.625rem] font-medium ${source.className}`} title={source.title}>
            {source.label}
          </span>
          {s.requiresRestart ? (
            <span
              className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[0.625rem] font-medium text-gray-600"
              title="Dibaca sekali saat backend start; perubahan berlaku setelah backend di-restart."
            >
              perlu restart
            </span>
          ) : null}
          {changed ? <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[0.625rem] font-medium text-blue-700">diubah</span> : null}
        </div>
        {s.help ? <p className="mt-0.5 text-xs text-gray-500">{s.help}</p> : null}
      </div>

      <div className="min-w-0 space-y-1">
        {value}
        {s.error ? (
          <p className="flex items-center gap-1 text-[0.6875rem] text-red-600">
            <AlertTriangle className="h-3 w-3" aria-hidden />
            Nilai tersimpan tidak bisa dibaca ({s.error}) - sementara memakai .env.
          </p>
        ) : null}
        {!editing && s.source === 'database' && s.updatedAt ? (
          <p className="text-[0.6875rem] text-gray-400">
            Diubah {formatWhen(s.updatedAt)}
            {s.updatedByName ? ` oleh ${s.updatedByName}` : ''}
          </p>
        ) : null}
        {editing && s.source === 'database' ? (
          <button type="button" className="inline-flex items-center gap-1 text-[0.6875rem] text-blue-600 hover:underline" onClick={onToggleRevert}>
            <RotateCcw className="h-3 w-3" aria-hidden />
            {reverting ? 'Batal kembalikan' : 'Kembalikan ke .env'}
          </button>
        ) : null}
      </div>
    </div>
  )
}
