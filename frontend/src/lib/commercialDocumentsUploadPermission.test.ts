import { describe, expect, it } from 'vitest'
import {
  COMMERCIAL_DOCUMENT_TYPES,
  commercialDocumentUploadPermissionKey,
} from './commercialDocumentsTypes'

describe('Commercial Documents upload permission, one per document type', () => {
  it('uses the key the API checks and the migration seeds', () => {
    expect(commercialDocumentUploadPermissionKey('delivery_order')).toBe('data.commercial_documents.upload.delivery_order')
    expect(commercialDocumentUploadPermissionKey('bea_cukai')).toBe('data.commercial_documents.upload.bea_cukai')
    expect(commercialDocumentUploadPermissionKey('berita_acara')).toBe('data.commercial_documents.upload.berita_acara')
  })

  it('has a distinct key for every document type', () => {
    const keys = COMMERCIAL_DOCUMENT_TYPES.map(commercialDocumentUploadPermissionKey)
    expect(new Set(keys).size).toBe(COMMERCIAL_DOCUMENT_TYPES.length)
  })
})
