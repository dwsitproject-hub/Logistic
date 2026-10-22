import { describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { COMMERCIAL_DOCS_COLUMN_BY_ID, DocStatusCell } from './commercialDocumentsColumns'
import { COMMERCIAL_DOCUMENT_TYPES, type CommercialDocumentRow } from './commercialDocumentsTypes'

/**
 * A checked document cell of the Commercial Documents table opens that document (view + download). The cells are plain function
 * components, so they are called directly and the element they return is inspected: no DOM needed.
 */
const asEl = (node: unknown) => node as ReactElement<Record<string, unknown>>

describe('DocStatusCell', () => {
  it('a checked cell with a handler is a button that calls it, named after the document', () => {
    const onOpen = vi.fn()
    const el = asEl(DocStatusCell({ checked: true, onOpen, title: 'View Contract' }))
    expect(el.type).toBe('button')
    expect(el.props['aria-label']).toBe('View Contract')
    expect(el.props.type).toBe('button')
    ;(el.props.onClick as () => void)()
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('a checked cell with no handler stays a plain check (nothing to click)', () => {
    const el = asEl(DocStatusCell({ checked: true }))
    expect(el.type).not.toBe('button')
    expect(el.props['aria-label']).toBe('Checked')
  })

  it('an unchecked cell is a dash and is never clickable, even with a handler', () => {
    const onOpen = vi.fn()
    const el = asEl(DocStatusCell({ checked: false, onOpen }))
    expect(el.type).toBe('span')
    expect(el.props.onClick).toBeUndefined()
    expect(onOpen).not.toHaveBeenCalled()
  })
})

describe('the document columns hand the row and the document type to the page', () => {
  const row = { id: 'r1', po_number: '1001032563', contract_ext_no: '1172000000550', doc_contract: true, doc_draft_contract: false } as unknown as CommercialDocumentRow

  it('every document column opens its own type', () => {
    const columnIds: Record<string, string> = {
      draft_contract: 'doc_draft_contract',
      contract: 'doc_contract',
      addendum_contract: 'doc_addendum_contract',
      berita_acara: 'doc_berita_acara',
      bea_cukai: 'doc_bea_cukai',
      delivery_order: 'doc_delivery_order',
      invoice_fp_dp: 'doc_invoice_fp_dp',
      invoice_fp_payoff: 'doc_invoice_fp_payoff',
      invoice_fp_full: 'doc_invoice_fp_full',
    }
    for (const type of COMMERCIAL_DOCUMENT_TYPES) {
      const onOpenDocument = vi.fn()
      const col = COMMERCIAL_DOCS_COLUMN_BY_ID[columnIds[type] as keyof typeof COMMERCIAL_DOCS_COLUMN_BY_ID]
      const checkedRow = { ...row, [columnIds[type]]: true } as unknown as CommercialDocumentRow
      const cell = asEl(col.render(checkedRow, { onOpenDocument }))
      ;(cell.props.onOpen as () => void)()
      expect(onOpenDocument).toHaveBeenCalledWith(checkedRow, type)
    }
  })

  it('without a render context the columns render exactly as before (a check, no button)', () => {
    const cell = asEl(COMMERCIAL_DOCS_COLUMN_BY_ID.doc_contract.render(row))
    expect(cell.props.onOpen).toBeUndefined()
  })

  it('a text column ignores the context', () => {
    expect(() => COMMERCIAL_DOCS_COLUMN_BY_ID.po_number.render(row, { onOpenDocument: vi.fn() })).not.toThrow()
  })
})
