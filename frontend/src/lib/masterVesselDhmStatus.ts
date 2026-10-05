/** What a Master list row carries about DHM: the link, and - when the last push to DHM did not go through - why. */
export type DhmStatusRow = {
  dhm_id?: string | null
  dhm_code?: string | null
  code_dhm?: string | null
  /** 'FAILED' | 'CONFLICT' while the last push of this row is undelivered (dhm_push_state); absent otherwise. */
  dhm_push_status?: string | null
  dhm_push_error?: string | null
  dhm_push_attempts?: number | null
  dhm_push_next_attempt_at?: string | null
}

/** DHM replica is linked when the hub assigned an id or a code. */
export function isMasterVesselDhmSynced(row: DhmStatusRow): boolean {
  return Boolean(
    String(row.dhm_id ?? '').trim() ||
      String(row.dhm_code ?? '').trim() ||
      String(row.code_dhm ?? '').trim(),
  )
}

export type DhmStatusLabel = 'Sync' | 'Not Sync' | 'Sync Failed' | 'Conflict'

/**
 * "Sync" used to mean only "this row was linked to DHM once". An edit that never reached DHM left it reading "Sync",
 * so the Master looked delivered while DHM held the old values. An undelivered push now wins over the link.
 */
export function masterVesselDhmStatusLabel(row: DhmStatusRow): DhmStatusLabel {
  const push = String(row.dhm_push_status ?? '').toUpperCase()
  if (push === 'CONFLICT') return 'Conflict'
  if (push === 'FAILED') return 'Sync Failed'
  return isMasterVesselDhmSynced(row) ? 'Sync' : 'Not Sync'
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' })
}

/** The tooltip of the badge: what is wrong and what happens next. Empty when there is nothing to say. */
export function dhmStatusHint(row: DhmStatusRow): string {
  const push = String(row.dhm_push_status ?? '').toUpperCase()
  const code = String(row.code_dhm || row.dhm_code || '').trim()
  if (push === 'CONFLICT') {
    return (
      'DHM sudah punya data yang berbeda dengan nama atau kode ini. ' +
      'Simpan ulang master ini dan pilih overwrite kalau data KLIP yang benar.' +
      (row.dhm_push_error ? ` (${row.dhm_push_error})` : '')
    )
  }
  if (push === 'FAILED') {
    const reason = row.dhm_push_error ? `Perubahan terakhir belum sampai ke DHM: ${row.dhm_push_error}.` : 'Perubahan terakhir belum sampai ke DHM.'
    const attempts = row.dhm_push_attempts ? ` Percobaan ke-${row.dhm_push_attempts}.` : ''
    const next = row.dhm_push_next_attempt_at ? formatWhen(row.dhm_push_next_attempt_at) : ''
    return `${reason}${attempts} ${next ? `Dicoba lagi otomatis sekitar ${next}.` : 'Percobaan otomatis habis; coba lagi dari Integrations > DHM.'}`
  }
  return code ? `DHM: ${code}` : ''
}
