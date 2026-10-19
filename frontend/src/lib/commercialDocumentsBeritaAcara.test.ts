import { describe, expect, it } from 'vitest'
import {
  COMMERCIAL_DOCS_ALL_COLUMNS,
  COMMERCIAL_DOCS_COLUMN_BY_ID,
  withBeritaAcaraColumn,
} from './commercialDocumentsColumns'
import {
  COMMERCIAL_DOCUMENT_LABELS,
  COMMERCIAL_DOCUMENT_TYPES,
  canonicalCommercialDocumentType,
  docCheckedField,
  documentTypesForCategory,
} from './commercialDocumentsTypes'

describe('Berita Acara (BA) in Commercial Documents', () => {
  it('is a document category listed right after Addendum Contract, so the cards, the checklist and the filter follow that order', () => {
    expect(COMMERCIAL_DOCUMENT_TYPES.indexOf('berita_acara')).toBe(COMMERCIAL_DOCUMENT_TYPES.indexOf('addendum_contract') + 1)
    expect(COMMERCIAL_DOCUMENT_LABELS.berita_acara).toBe('Berita Acara (BA)')
    expect(canonicalCommercialDocumentType('berita_acara')).toBe('berita_acara')
    expect(documentTypesForCategory('berita_acara')).toEqual(['berita_acara'])
    expect(docCheckedField('berita_acara')).toBe('doc_berita_acara')
  })

  it('has a table column, visible by default, right after the Addendum Contract column', () => {
    const column = COMMERCIAL_DOCS_COLUMN_BY_ID.doc_berita_acara
    expect(column.label).toBe('Berita Acara (BA)')
    expect(column.defaultVisible).toBe(true)
    const ids = COMMERCIAL_DOCS_ALL_COLUMNS.map((c) => c.id)
    expect(ids.indexOf('doc_berita_acara')).toBe(ids.indexOf('doc_addendum_contract') + 1)
  })

  it('shows a check for a contract with the BA uploaded and a dash otherwise', () => {
    const column = COMMERCIAL_DOCS_COLUMN_BY_ID.doc_berita_acara
    const base = { doc_berita_acara: true } as never
    expect(column.getSortValue?.(base)).toBe(1)
    expect(column.getSortValue?.({ doc_berita_acara: false } as never)).toBe(0)
  })
})

describe('a saved column list from before Berita Acara', () => {
  it('gets the column right after Addendum Contract', () => {
    expect(withBeritaAcaraColumn(['po_number', 'doc_contract', 'doc_addendum_contract', 'doc_bea_cukai'])).toEqual([
      'po_number',
      'doc_contract',
      'doc_addendum_contract',
      'doc_berita_acara',
      'doc_bea_cukai',
    ])
  })

  it('is left alone when the user hid Addendum Contract, or already has the column', () => {
    expect(withBeritaAcaraColumn(['po_number', 'doc_contract'])).toEqual(['po_number', 'doc_contract'])
    expect(withBeritaAcaraColumn(['doc_berita_acara', 'doc_addendum_contract'])).toEqual(['doc_berita_acara', 'doc_addendum_contract'])
  })
})
