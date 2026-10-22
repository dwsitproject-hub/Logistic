import api from '@/lib/api'

/**
 * Opening and downloading one uploaded commercial document, shared by Document Checking (edit) and the read-only View Document modal.
 * Both endpoints stream the file, so with responseType 'blob' a failure ("Document not found", "File not found on server") arrives as a JSON Blob.
 */

/** A message when the blob is not a PDF (a JSON/HTML error body, or a file that is not a PDF); null when it is a PDF. */
export async function messageFromPdfBlob(blob: Blob): Promise<string | null> {
  const type = String(blob.type || '').toLowerCase()
  if (type.includes('json') || type.includes('text') || type.includes('html')) {
    try {
      const text = await blob.text()
      const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string }
      return parsed?.error?.message || parsed?.message || 'Failed to load document preview'
    } catch {
      return 'Failed to load document preview'
    }
  }
  const sig = new TextDecoder().decode(await blob.slice(0, 5).arrayBuffer())
  if (!sig.startsWith('%PDF')) {
    return 'This file is not a valid PDF and cannot be previewed.'
  }
  return null
}

export function revokePreviewUrl(url: string | null | undefined): void {
  if (url) window.URL.revokeObjectURL(url)
}

export type CommercialDocumentPreviewResult = { url: string; error?: undefined } | { url: ''; error: string }

/** Fetch a document for the inline viewer. Never throws: a failure comes back as `error` text for the viewer to show. */
export async function loadCommercialDocumentPreview(fileId: string): Promise<CommercialDocumentPreviewResult> {
  try {
    const response = await api.get(`/commercial-documents/file/${encodeURIComponent(fileId)}/view`, {
      responseType: 'blob',
    })
    const raw = response.data instanceof Blob ? response.data : new Blob([response.data])
    const invalid = await messageFromPdfBlob(raw)
    if (invalid) return { url: '', error: invalid }
    return { url: window.URL.createObjectURL(new Blob([raw], { type: 'application/pdf' })) }
  } catch (e) {
    const data = (e as { response?: { data?: Blob } })?.response?.data
    const fromBlob = data instanceof Blob ? await messageFromPdfBlob(data) : null
    return { url: '', error: fromBlob || 'Failed to load document preview' }
  }
}

/** Download one document. Returns null on success, or the message to show. Never throws. */
export async function downloadCommercialDocument(fileId: string, fileName: string): Promise<string | null> {
  try {
    const response = await api.get(`/commercial-documents/file/${encodeURIComponent(fileId)}/download`, {
      responseType: 'blob',
    })
    const url = window.URL.createObjectURL(new Blob([response.data]))
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    window.URL.revokeObjectURL(url)
    return null
  } catch (e) {
    const data = (e as { response?: { data?: unknown } })?.response?.data
    const fromBlob = data instanceof Blob ? await messageFromPdfBlob(data) : null
    return `Could not download "${fileName}": ${fromBlob || 'download failed. Please try again.'}`
  }
}
