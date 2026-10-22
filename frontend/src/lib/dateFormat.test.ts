import { describe, expect, it } from 'vitest'
import { formatDateDMY, formatDateTimeDMY, formatTimeHMS } from './dateFormat'

const pad = (n: number) => String(n).padStart(2, '0')
const localHm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const localDmy = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`

/**
 * "Latest activity" listed every row at 22/10/2026 00:00: parseForDisplay keeps only the calendar day of any YYYY-MM-DD... string, which is
 * right for a date column and wrong for an event timestamp (audit log, upload, import).
 */
describe('formatDateTimeDMY keeps the time of an event timestamp', () => {
  it('an ISO instant shows its time, in the viewer\'s timezone', () => {
    const iso = '2026-10-22T07:58:14.000Z'
    const d = new Date(iso)
    expect(formatDateTimeDMY(iso)).toBe(`${localDmy(d)} ${localHm(d)}`)
    // not the 00:00 the calendar-day parse produced (only equal when the local time really is midnight)
    if (localHm(d) !== '00:00') expect(formatDateTimeDMY(iso)).not.toMatch(/ 00:00$/)
  })

  it('a timestamp with an offset or a space separator keeps its time too', () => {
    const withOffset = '2026-10-22T14:58:14+07:00'
    const d = new Date(withOffset)
    expect(formatDateTimeDMY(withOffset)).toBe(`${localDmy(d)} ${localHm(d)}`)
    expect(formatDateTimeDMY('2026-10-22 14:58:14')).toBe('22/10/2026 14:58')
  })

  it('a date without a time part is still a calendar day, with no timezone shift', () => {
    expect(formatDateTimeDMY('2026-10-22')).toBe('22/10/2026 00:00')
    expect(formatDateDMY('2026-10-22')).toBe('22/10/2026')
    expect(formatDateDMY('2026-10-22T00:00:00.000Z')).toBe('22/10/2026')
  })

  it('empty and unparseable input', () => {
    expect(formatDateTimeDMY(null)).toBe('-')
    expect(formatDateTimeDMY('')).toBe('-')
    expect(formatDateTimeDMY('not a date')).toBe('-')
  })

  it('formatTimeHMS reads the time of the same timestamp', () => {
    expect(formatTimeHMS('2026-10-22 14:58:14')).toBe('14:58:14')
    const iso = '2026-10-22T07:58:14.000Z'
    const d = new Date(iso)
    expect(formatTimeHMS(iso)).toBe(`${localHm(d)}:${pad(d.getSeconds())}`)
  })
})
