import api from '@/lib/api'

function parseApiErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && 'error' in data) {
    const err = (data as { error?: { message?: string } }).error
    if (err?.message) return err.message
  }
  return fallback
}

/** POST /commercial-documents/tanda-terima/download and trigger browser save. */
export async function downloadTandaTerimaPdf(
  contractExtNos: string[],
  sendDateIso: string,
): Promise<void> {
  try {
    const response = await api.post(
      '/commercial-documents/tanda-terima/download',
      { contractExtNos, sendDate: sendDateIso },
      { responseType: 'blob' },
    )

    const blob = response.data as Blob
    if (blob.type.includes('application/json')) {
      const text = await blob.text()
      const parsed = JSON.parse(text) as unknown
      throw new Error(parseApiErrorMessage(parsed, 'Failed to generate PDF'))
    }

    const disposition = response.headers['content-disposition'] as string | undefined
    const match = disposition?.match(/filename="?([^";]+)"?/i)
    const filename = match?.[1] ?? `Tanda_Terima_${sendDateIso}.pdf`

    const url = window.URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    window.URL.revokeObjectURL(url)
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'response' in err) {
      const axiosErr = err as { response?: { data?: Blob } }
      const data = axiosErr.response?.data
      if (data instanceof Blob && data.type.includes('application/json')) {
        const text = await data.text()
        const parsed = JSON.parse(text) as unknown
        throw new Error(parseApiErrorMessage(parsed, 'Failed to generate PDF'))
      }
    }
    throw err instanceof Error ? err : new Error('Failed to generate PDF')
  }
}
