/**
 * The shared rules of the Master pages in the Users style: the DHM status as a filter and as a chip, the initials in front of a row, and the company options.
 * Pure functions, so they are tested without a page.
 */
import { masterVesselDhmStatusLabel, type DhmStatusLabel, type DhmStatusRow } from '@/lib/masterVesselDhmStatus'
import { multiValueSortKey } from '@/lib/multiValueCell'

/** The filter the list sends to the API as `dhm`. */
export type MasterDhmFilter = 'all' | 'synced' | 'not_synced' | 'failed'

export const MASTER_DHM_FILTERS: ReadonlyArray<{ id: MasterDhmFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'synced', label: 'Synced' },
  { id: 'not_synced', label: 'Not synced' },
  { id: 'failed', label: 'Failed' },
]

export type MasterDhmChipTone = 'ok' | 'idle' | 'bad' | 'warn'

export interface MasterDhmChip {
  label: string
  tone: MasterDhmChipTone
  /** The filter this row falls under (a conflict counts as failed: both need a person). */
  filter: Exclude<MasterDhmFilter, 'all'>
}

const CHIP: Record<DhmStatusLabel, MasterDhmChip> = {
  Sync: { label: 'Synced', tone: 'ok', filter: 'synced' },
  'Not Sync': { label: 'Not synced', tone: 'idle', filter: 'not_synced' },
  'Sync Failed': { label: 'Failed', tone: 'bad', filter: 'failed' },
  Conflict: { label: 'Conflict', tone: 'warn', filter: 'failed' },
}

/** The chip of a row: the same rule as the DHM status icon (an undelivered push wins over the link), in words. */
export function masterDhmChip(row: DhmStatusRow): MasterDhmChip {
  return CHIP[masterVesselDhmStatusLabel(row)]
}

/** One or two letters for the avatar in front of a row: the first letters of the first two words, upper case; "?" for an empty name. */
export function masterInitials(name: string | null | undefined): string {
  const words = String(name ?? '')
    .trim()
    .split(/[\s/_-]+/)
    .filter((w) => /[A-Za-z0-9]/.test(w))
  if (words.length === 0) return '?'
  const letter = (w: string) => (w.match(/[A-Za-z0-9]/) ?? ['?'])[0].toUpperCase()
  return words.length === 1 ? letter(words[0]) + (words[0].replace(/[^A-Za-z0-9]/g, '')[1] ?? '').toUpperCase() : letter(words[0]) + letter(words[1])
}

export interface MasterCompanyOption {
  id: string
  name: string
  sites: number
}

/** The companies of the filter, A-Z with the PT prefix ignored (the same order as the lists in the cells). */
export function sortCompanyOptions<T extends { name: string }>(options: readonly T[]): T[] {
  return [...options].sort((a, b) => {
    const byKey = multiValueSortKey(a.name).localeCompare(multiValueSortKey(b.name), undefined, { numeric: true, sensitivity: 'base' })
    return byKey !== 0 ? byKey : a.name.localeCompare(b.name)
  })
}

/** "Showing 20 of 60 sites" or, with a filter on, "Showing 20 of 14 sites"-style text: how many rows match out of how many exist. */
export function masterCountText(shown: number, matching: number, total: number, noun: string): string {
  const n = (v: number) => v.toLocaleString('en-US')
  if (matching === total) return `Showing ${n(shown)} of ${n(total)} ${noun}`
  return `Showing ${n(shown)} of ${n(matching)} matching ${noun} (${n(total)} in total)`
}
