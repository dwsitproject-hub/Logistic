export interface DhmSaveBody {
  dhmConflict?: boolean
  dhmCode?: string | null
  dhmError?: string
}

export async function saveWithDhmConfirm(
  persist: (overwrite: boolean) => Promise<{ data?: { data?: DhmSaveBody } }>,
  noun: string,
): Promise<void> {
  const first = await persist(false)
  let dhm = first.data?.data
  if (dhm?.dhmConflict) {
    const updateDhm = window.confirm(`DHM already has this ${noun}. Update DHM with the KLIP values?`)
    if (updateDhm) {
      const overwritten = await persist(true)
      dhm = overwritten.data?.data ?? dhm
    }
  }
  if (dhm?.dhmError && !dhm.dhmConflict) {
    alert(`Saved in KLIP, but DHM was not linked: ${dhm.dhmError}`)
  } else if (dhm?.dhmCode) {
    alert(`Saved. DHM code: ${dhm.dhmCode}`)
  }
}
