import { describe, expect, it } from 'vitest'
import { previewMimeType } from './documentView'

describe('previewMimeType', () => {
  it('takes the stored mime type when a browser tab can show it', () => {
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

  it('says null for what a tab cannot render', () => {
    expect(previewMimeType('a.xlsx', 'application/vnd.ms-excel')).toBeNull()
    expect(previewMimeType('a.docx')).toBeNull()
    expect(previewMimeType('', '')).toBeNull()
    expect(previewMimeType(null, null)).toBeNull()
  })
})
