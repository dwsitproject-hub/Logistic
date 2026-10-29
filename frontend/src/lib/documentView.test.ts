import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }))
vi.mock('@/lib/api', () => ({ default: { get: getMock } }))

import { loadDocumentPreview, previewMimeType } from './documentView'

describe('previewMimeType', () => {
  it('takes the stored mime type when a browser can show it', () => {
    expect(previewMimeType('x.bin', 'application/pdf')).toBe('application/pdf')
    expect(previewMimeType('x.bin', 'image/png')).toBe('image/png')
    expect(previewMimeType('x.bin', 'image/jpeg')).toBe('image/jpeg')
    expect(previewMimeType('x', 'Application/PDF; charset=binary')).toBe('application/pdf')
  })

  it('falls back to the extension when the type is octet-stream or empty (a dropped PDF sometimes arrives that way)', () => {
    expect(previewMimeType('10.27 DO CKG SSRS - EUP LG 0032 (1000 mt).pdf', 'application/octet-stream')).toBe('application/pdf')
    expect(previewMimeType('SCAN.PDF', '')).toBe('application/pdf')
    expect(previewMimeType('a.png', null)).toBe('image/png')
    expect(previewMimeType('a.JPG')).toBe('image/jpeg')
    expect(previewMimeType('a.jpeg', undefined)).toBe('image/jpeg')
  })

  it('says null for what a browser cannot render', () => {
    expect(previewMimeType('a.xlsx', 'application/vnd.ms-excel')).toBeNull()
    expect(previewMimeType('a.docx')).toBeNull()
    expect(previewMimeType('', '')).toBeNull()
    expect(previewMimeType(null, null)).toBeNull()
  })
})

describe('loadDocumentPreview: the file for the viewer inside the page', () => {
  let created: Blob[]

  beforeEach(() => {
    getMock.mockReset()
    created = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      created.push(b as Blob)
      return `blob:klip/${created.length}`
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('a PDF: fetched from the download route as a blob, shown from a blob URL typed application/pdf', async () => {
    getMock.mockResolvedValue({ data: new Blob(['%PDF-1.4 body'], { type: 'application/octet-stream' }) })
    const out = await loadDocumentPreview('doc 1', 'DO.pdf', 'application/octet-stream')
    expect(getMock).toHaveBeenCalledWith('/documents/doc%201/download', { responseType: 'blob' })
    expect(out).toEqual({ url: 'blob:klip/1', type: 'application/pdf' })
    expect(created[0].type).toBe('application/pdf')
  })

  it('an image needs no PDF signature', async () => {
    getMock.mockResolvedValue({ data: new Blob(['\x89PNG...']) })
    const out = await loadDocumentPreview('d', 'photo.png', 'image/png')
    expect(out).toEqual({ url: 'blob:klip/1', type: 'image/png' })
  })

  it('a "PDF" that is not one says so, and nothing is created', async () => {
    getMock.mockResolvedValue({ data: new Blob(['<html>login page</html>']) })
    const out = await loadDocumentPreview('d', 'a.pdf', 'application/pdf')
    expect(out.error).toContain('not a valid PDF')
    expect(out.url).toBe('')
    expect(created).toHaveLength(0)
  })

  it('a failure shows the API\'s own message when its body is JSON ("File not found on server")', async () => {
    getMock.mockRejectedValue({ response: { data: new Blob([JSON.stringify({ success: false, error: { message: 'File not found on server' } })]) } })
    const out = await loadDocumentPreview('d', 'a.pdf', 'application/pdf')
    expect(out.error).toBe('File not found on server')
  })

  it('any other failure gets a plain message, and never throws', async () => {
    getMock.mockRejectedValue(new Error('Network Error'))
    const out = await loadDocumentPreview('d', 'a.pdf', 'application/pdf')
    expect(out.error).toContain('Failed to open the document')
  })

  it('a file a browser cannot render is not even fetched', async () => {
    const out = await loadDocumentPreview('d', 'sheet.xlsx', 'application/vnd.ms-excel')
    expect(out.error).toContain('cannot be previewed')
    expect(getMock).not.toHaveBeenCalled()
  })
})
