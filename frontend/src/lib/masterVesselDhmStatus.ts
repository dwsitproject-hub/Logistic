/** DHM replica is linked when the hub assigned an id or VSL code. */
export function isMasterVesselDhmSynced(row: {
  dhm_id?: string | null
  dhm_code?: string | null
}): boolean {
  return Boolean(String(row.dhm_id ?? '').trim() || String(row.dhm_code ?? '').trim())
}

export function masterVesselDhmStatusLabel(row: {
  dhm_id?: string | null
  dhm_code?: string | null
}): 'Sync' | 'Not Sync' {
  return isMasterVesselDhmSynced(row) ? 'Sync' : 'Not Sync'
}
