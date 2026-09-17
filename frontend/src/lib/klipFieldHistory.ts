import { formatDateDMY } from '@/lib/dateFormat'

/** One recorded KLIP edit, as the edit payload sends it. */
export type KlipFieldEditInfo = {
  column: string
  at: string
  by: string | null
}

/**
 * "Budi, 12 Sep 2026" for the KLIP chip's tooltip.
 *
 * Returns null when nothing was recorded, and the caller then shows the chip without a tooltip:
 * the badge is decided by `klip_edited_fields`, and history only adds detail. An absent entry
 * means the edit predates the audit log on that route, never that it did not happen.
 */
export function describeKlipFieldEdit(
  history: Record<string, KlipFieldEditInfo> | undefined | null,
  column: string,
): string | null {
  const entry = history?.[column]
  if (!entry) return null
  const who = String(entry.by ?? '').trim()
  const when = entry.at ? formatDateDMY(String(entry.at).slice(0, 10)) : ''
  if (!who && !when) return null
  if (!who) return when
  return when ? `${who}, ${when}` : who
}
