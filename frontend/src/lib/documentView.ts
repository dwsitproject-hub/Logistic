import api from '@/lib/api'

/**
 * Viewing a stored document (PDF, PNG, JPEG) in a browser tab instead of saving it.
 *
 * The API has one read route, GET /documents/:id/download, which answers with `Content-Disposition: attachment`. The file is fetched as a blob (the request carries the
 * session) and shown from a blob URL whose type is set here, so the browser renders it whatever the server called it. A "View" button used to call the download
 * handler and so saved the file, not showed it.
 */

const PREVIEWABLE = new Set(['application/pdf', 'image/png', 'image/jpeg'])

/** The type to show the file as, or null when a browser tab cannot render it. The stored mime type first; octet-stream or empty falls back to the extension. */
export function previewMimeType(fileName: string | null | undefined, mimeType?: string | null): string | null {
  const mime = String(mimeType ?? '').toLowerCase().split(';')[0].trim()
  if (PREVIEWABLE.has(mime)) return mime
  const name = String(fileName ?? '').toLowerCase()
  if (name.endsWith('.pdf')) return 'application/pdf'
  if (name.endsWith('.png')) return 'image/png'
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg'
  return null
}

/** How long the blob URL stays valid after the tab has taken it. */
const REVOKE_AFTER_MS = 5 * 60 * 1000

/**
 * Opens the document in a new tab. Call it straight from the click handler: the tab is opened BEFORE the file is fetched, because a window opened after an
 * await is taken for a pop-up and blocked.
 */
export async function openDocumentPreview(docId: string, fileName: string, mimeType?: string | null): Promise<boolean> {
  const type = previewMimeType(fileName, mimeType)
  if (!type) {
    alert('This file type cannot be previewed here. Use Download.')
    return false
  }
  const tab = window.open('', '_blank')
  if (!tab) {
    alert('The browser blocked the new tab. Allow pop-ups for KLIP, or use Download.')
    return false
  }
  try {
    tab.document.title = fileName
    tab.document.body.textContent = 'Loading…'
  } catch {
    /* a tab that will not take a title still takes the file */
  }
  try {
    const response = await api.get(`/documents/${docId}/download`, { responseType: 'blob' })
    const url = URL.createObjectURL(new Blob([response.data], { type }))
    tab.location.href = url
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS)
    return true
  } catch (err) {
    console.error('View document error:', err)
    tab.close()
    alert('Failed to open the document. Please try again.')
    return false
  }
}
