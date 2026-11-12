import { describe, expect, it } from 'vitest'
import {
  buildSaveValues,
  countSettingChanges,
  groupSettings,
  initialDraft,
  isSettingChanged,
  summarizeIntegration,
  type SettingView,
} from './integrationSettings'

const setting = (over: Partial<SettingView>): SettingView => ({
  key: 'X',
  label: 'X',
  kind: 'text',
  requiresRestart: false,
  source: 'env',
  value: 'a',
  hint: null,
  updatedByName: null,
  updatedAt: null,
  error: null,
  ...over,
})

describe('groupSettings', () => {
  it('puts credentials and URLs together, switches apart, and the rest last, keeping the server order', () => {
    const groups = groupSettings([
      setting({ key: 'CRON', kind: 'cron' }),
      setting({ key: 'KEY', kind: 'secret' }),
      setting({ key: 'AUTO', kind: 'boolean' }),
      setting({ key: 'URL', kind: 'url' }),
      setting({ key: 'PORTS', kind: 'ports' }),
    ])
    expect(groups.map((g) => g.id)).toEqual(['connection', 'switches', 'options'])
    expect(groups[0].settings.map((s) => s.key)).toEqual(['KEY', 'URL'])
    expect(groups[2].settings.map((s) => s.key)).toEqual(['CRON', 'PORTS'])
  })

  it('leaves out a group with nothing in it', () => {
    expect(groupSettings([setting({ kind: 'boolean' })]).map((g) => g.id)).toEqual(['switches'])
  })
})

describe('summarizeIntegration', () => {
  it('counts the unset ones and the ones saved through KLIP', () => {
    const s = summarizeIntegration([setting({ source: 'unset' }), setting({ source: 'database' }), setting({ source: 'env' })])
    expect(s).toEqual({ total: 3, unset: 1, fromKlip: 1 })
  })
})

describe('what Save sends', () => {
  const settings = [
    setting({ key: 'URL', kind: 'url', value: 'https://a' }),
    setting({ key: 'KEY', kind: 'secret', value: null, hint: 'jps_...ab12' }),
    setting({ key: 'AUTO', kind: 'boolean', value: 'false' }),
  ]

  it('starts a secret blank and the rest at their current value', () => {
    expect(initialDraft(settings)).toEqual({ URL: 'https://a', KEY: '', AUTO: 'false' })
  })

  it('sends nothing for an untouched form', () => {
    expect(buildSaveValues(settings, initialDraft(settings), new Set())).toEqual({})
    expect(countSettingChanges(settings, initialDraft(settings), new Set())).toBe(0)
  })

  it('keeps the current secret while its field is blank, and sends a typed one', () => {
    expect(isSettingChanged(settings[1], '')).toBe(false)
    expect(buildSaveValues(settings, { ...initialDraft(settings), KEY: 'new-key' }, new Set())).toEqual({ KEY: 'new-key' })
  })

  it('sends only what differs from the stored value', () => {
    const draft = { ...initialDraft(settings), AUTO: 'true' }
    expect(buildSaveValues(settings, draft, new Set())).toEqual({ AUTO: 'true' })
  })

  it('never sends a value that is being reverted to .env, and counts the revert as a change', () => {
    const draft = { ...initialDraft(settings), AUTO: 'true' }
    const revert = new Set(['AUTO'])
    expect(buildSaveValues(settings, draft, revert)).toEqual({})
    expect(countSettingChanges(settings, draft, revert)).toBe(1)
  })

  it('counts every changed setting once', () => {
    const draft = { URL: 'https://b', KEY: 'k', AUTO: 'true' }
    expect(countSettingChanges(settings, draft, new Set())).toBe(3)
  })
})
