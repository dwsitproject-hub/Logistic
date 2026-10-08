import { describe, expect, it } from 'vitest'
import {
  describeSapFolderRun,
  findRunStartedSince,
  formatSapFolderTime,
  isSapFolderRunFinished,
  type SapFolderRun,
} from './sapFolderSync'

const run = (over: Partial<SapFolderRun>): SapFolderRun => ({
  id: 'r',
  trigger_source: 'manual',
  started_at: '2026-10-08T06:00:00.000Z',
  finished_at: null,
  outcome: 'running',
  detail: null,
  newest_file: null,
  newest_file_mtime: null,
  files_scanned: null,
  files_processed: null,
  files_skipped: null,
  import_id: null,
  ...over,
})

describe('sapFolderSync', () => {
  it('gives every outcome the server can record a label and a tone, and an unknown one a neutral fallback', () => {
    expect(describeSapFolderRun(run({ outcome: 'imported' }))).toEqual({ label: 'New file imported', tone: 'ok' })
    expect(describeSapFolderRun(run({ outcome: 'skipped_in_flight' })).tone).toBe('warn')
    expect(describeSapFolderRun(run({ outcome: 'source_missing' })).tone).toBe('error')
    expect(describeSapFolderRun(run({ outcome: 'something_new' }))).toEqual({ label: 'something_new', tone: 'info' })
  })

  it('finds the run a click started, not an earlier cron run that is still the newest row', () => {
    const click = Date.parse('2026-10-08T08:00:00.000Z')
    const earlierCron = run({ id: 'cron', trigger_source: 'cron', started_at: '2026-10-08T06:00:00.000Z', outcome: 'no_new_file', finished_at: '2026-10-08T06:00:05.000Z' })
    expect(findRunStartedSince([earlierCron], click)).toBeNull()
    const mine = run({ id: 'mine', started_at: '2026-10-08T08:00:01.000Z' })
    expect(findRunStartedSince([mine, earlierCron], click)?.id).toBe('mine')
  })

  it('treats a run as finished only when it has an end time and is no longer running', () => {
    expect(isSapFolderRunFinished(null)).toBe(false)
    expect(isSapFolderRunFinished(run({ outcome: 'running' }))).toBe(false)
    expect(isSapFolderRunFinished(run({ outcome: 'imported', finished_at: null }))).toBe(false)
    expect(isSapFolderRunFinished(run({ outcome: 'imported', finished_at: '2026-10-08T08:02:00.000Z' }))).toBe(true)
  })

  it('shows Jakarta time', () => {
    expect(formatSapFolderTime('2026-10-07T23:00:00.000Z')).toMatch(/08 Oct 2026/)
    expect(formatSapFolderTime(null)).toBe('-')
  })
})
