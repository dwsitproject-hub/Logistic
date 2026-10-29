import api from '@/lib/api'
import { messageFromPdfBlob } from '@/lib/commercialDocumentFileAccess'

/**
 * Viewing a stored document (PDF, PNG, JPEG) inside the page instead of saving it or opening another tab.
 *
 * The API has one read route, GET /documents/:id/download, which answers with `Content-Disposition: attachment`. The file is fetched as a blob (the request carries the
 * session) and shown from a blob URL whose type is set here, so the browser renders it whatever the server called it. The dialog that shows it is
 * components/shared/DocumentPreviewDialog.tsx. A "View" button used to call the download handler and so saved the file, and the first fix opened a new tab; the user asked
 * for it inside the page, as Shipments and Commercial Documents do.
 */

const PREVIEWABLE = new Set(['application/pdf', 'image/png', 'image/jpeg'])

/** The type to show the file as, or null when a browser cannot render it. The stored mime type first; octet-stream or empty falls back to the extension. */
export function previewMimeType(fileName: string | null | undefined, mimeType?: string | null): string | null {
  const mime = String(mimeType ?? '').toLowerCase().split(';')[0].trim()
  if (PREVIEWABLE.has(mime)) return mime
  const name = String(fileName ?? '').toLowerCase()
  if (name.endsWith('.pdf')) return 'application/pdf'
  if (name.endsWith('.png')) return 'image/png'
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg'
  return null
}

export type DocumentPreviewResult = { url: string; type: string; error?: undefined } | { url: ''; type: ''; error: string }

/** A message for a failed blob answer: the API's own ("Document not found", "File not found on server") when the body is its JSON, else a plain one. */
async function messageFromErrorBlob(data: unknown): Promise<string | null> {
  if (!(data instanceof Blob)) return null
  try {
    const parsed = JSON.parse(await data.text()) as { error?: { message?: string }; message?: string }
    return parsed?.error?.message || parsed?.message || null
  } catch {
    return null
  }
}

/**
 * Fetches a document and makes a blob URL of it for the viewer. Never throws: a failure comes back as `error` text for the viewer to show. The caller owns the URL and
 * revokes it (URL.revokeObjectURL) when it is done with it.
 */
export async function loadDocumentPreview(docId: string, fileName: string, mimeType?: string | null): Promise<DocumentPreviewResult> {
  const type = previewMimeType(fileName, mimeType)
  if (!type) return { url: '', type: '', error: 'This file type cannot be previewed. Use Download.' }
  try {
    const response = await api.get(`/documents/${encodeURIComponent(docId)}/download`, { responseType: 'blob' })
    const raw = response.data instanceof Blob ? response.data : new Blob([response.data])
    if (type === 'application/pdf') {
      const invalid = await messageFromPdfBlob(raw)
      if (invalid) return { url: '', type: '', error: invalid }
    }
    return { url: URL.createObjectURL(new Blob([raw], { type })), type }
  } catch (e) {
    const fromBody = await messageFromErrorBlob((e as { response?: { data?: unknown } })?.response?.data)
    return { url: '', type: '', error: fromBody || 'Failed to open the document. Please try again.' }
  }
}
