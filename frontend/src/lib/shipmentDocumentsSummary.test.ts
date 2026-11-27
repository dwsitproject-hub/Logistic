import { describe, expect, it } from 'vitest'
import { shipmentDocumentsSummary } from './shipmentDocumentsSummary'

describe('shipmentDocumentsSummary', () => {
  it('counts each type in the order of the cards and leaves out the ones with no file', () => {
    const docs = [
      { document_type: 'BL' },
      { document_type: 'CONTRACT' },
      { document_type: 'SLD' },
      { document_type: 'SLD' },
      { document_type: 'si' },
    ]
    expect(shipmentDocumentsSummary(docs)).toBe('Contract 1 · SI 1 · BL 1 · Loading 2')
  })

  it('adds the Contracts uploaded in Commercial Documents to the Contract count, and shows them even when KLIP has none', () => {
    expect(shipmentDocumentsSummary([{ document_type: 'CONTRACT' }], 2)).toBe('Contract 3')
    expect(shipmentDocumentsSummary([], 1)).toBe('Contract 1')
  })

  it('says so when there is nothing, and ignores a type the cards do not know', () => {
    expect(shipmentDocumentsSummary([])).toBe('No documents yet')
    expect(shipmentDocumentsSummary([{ document_type: 'QUANTITY_ADJUSTMENT' }, { document_type: null }, {}])).toBe('No documents yet')
  })

  it('names Discharge and Others', () => {
    expect(shipmentDocumentsSummary([{ document_type: 'SDD' }, { document_type: 'OTHER' }, { document_type: 'OTHER' }])).toBe('Discharge 1 · Others 2')
  })
})
