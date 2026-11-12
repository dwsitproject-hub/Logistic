/**
 * The Integrations page's view of a setting: how the settings of one integration are grouped, how many are unset, and exactly what a Save sends.
 * Pure functions, so the "blank secret = keep the current one" rule and the change count are tested without the page.
 */

export type SettingKind = 'secret' | 'url' | 'boolean' | 'integer' | 'cron' | 'text' | 'ports'
export type SettingSource = 'database' | 'env' | 'unset'

export interface SettingView {
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

export interface IntegrationView {
  id: 'dhm' | 'jps' | 'kmaps'
  name: string
  description: string
  settings: SettingView[]
}

export interface SettingGroup {
  id: 'connection' | 'switches' | 'options'
  title: string
  settings: SettingView[]
}

const GROUP_OF_KIND: Record<SettingKind, SettingGroup['id']> = {
  secret: 'connection',
  url: 'connection',
  boolean: 'switches',
  integer: 'options',
  cron: 'options',
  text: 'options',
  ports: 'options',
}

const GROUP_TITLE: Record<SettingGroup['id'], string> = {
  connection: 'Koneksi dan credential',
  switches: 'Sakelar',
  options: 'Pilihan dan batas',
}

/** The settings of one integration in three groups (connection and credentials, switches, the rest), each keeping the server's order; empty groups are left out. */
export function groupSettings(settings: SettingView[]): SettingGroup[] {
  const order: SettingGroup['id'][] = ['connection', 'switches', 'options']
  return order
    .map((id) => ({ id, title: GROUP_TITLE[id], settings: settings.filter((s) => GROUP_OF_KIND[s.kind] === id) }))
    .filter((group) => group.settings.length > 0)
}

export interface IntegrationSummary {
  total: number
  /** Nothing in KLIP and nothing in .env. */
  unset: number
  /** Saved through this page (they replace .env). */
  fromKlip: number
}

export function summarizeIntegration(settings: SettingView[]): IntegrationSummary {
  return {
    total: settings.length,
    unset: settings.filter((s) => s.source === 'unset').length,
    fromKlip: settings.filter((s) => s.source === 'database').length,
  }
}

/** Has the user typed something different for this setting? A secret counts once anything is typed (blank means keep the current one). */
export function isSettingChanged(setting: SettingView, draftValue: string | undefined): boolean {
  const v = draftValue ?? ''
  return setting.kind === 'secret' ? v !== '' : v !== (setting.value ?? '')
}

/** What Save sends: the changed values, never one that is being reverted to .env. */
export function buildSaveValues(
  settings: SettingView[],
  draft: Record<string, string>,
  revert: ReadonlySet<string>,
): Record<string, string> {
  const values: Record<string, string> = {}
  for (const setting of settings) {
    if (revert.has(setting.key)) continue
    if (isSettingChanged(setting, draft[setting.key])) values[setting.key] = draft[setting.key] ?? ''
  }
  return values
}

/** Settings changed or reverted: the number the save bar shows. */
export function countSettingChanges(
  settings: SettingView[],
  draft: Record<string, string>,
  revert: ReadonlySet<string>,
): number {
  return Object.keys(buildSaveValues(settings, draft, revert)).length + revert.size
}

/** The draft a setting starts editing with: secrets blank (blank = keep), everything else at its current value. */
export function initialDraft(settings: SettingView[]): Record<string, string> {
  const draft: Record<string, string> = {}
  for (const setting of settings) draft[setting.key] = setting.kind === 'secret' ? '' : (setting.value ?? '')
  return draft
}

/** What GET /integrations (and a successful save) returns. */
export interface IntegrationsPayload {
  secretsKeyConfigured: boolean
  integrations: IntegrationView[]
}

export type IntegrationTestResult = { ok: boolean; message: string; elapsedMs: number }
