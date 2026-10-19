import { describe, expect, it } from 'vitest'
import { klipQtyEditableFromApi, shipmentSaveErrorMessage } from './shipmentEditSave'

describe('klipQtyEditableFromApi', () => {
  it('is false only when the API says so', () => {
    expect(klipQtyEditableFromApi(false)).toBe(false)
    expect(klipQtyEditableFromApi(true)).toBe(true)
  })

  it('treats a missing flag as editable, so an older payload behaves as before', () => {
    expect(klipQtyEditableFromApi(undefined)).toBe(true)
    expect(klipQtyEditableFromApi(null)).toBe(true)
  })
})

describe('shipmentSaveErrorMessage', () => {
  it('shows the message the server gave instead of the generic axios one', () => {
    const err = Object.assign(new Error('Request failed with status code 400'), {
      response: { data: { error: { message: 'No sibling shipment found for contract 1004031718 under this STO / operation' } } },
    })
    expect(shipmentSaveErrorMessage(err)).toBe('No sibling shipment found for contract 1004031718 under this STO / operation')
  })

  it('falls back to the error message, then to the default', () => {
    expect(shipmentSaveErrorMessage(new Error('Remark is required when editing shipment data.'))).toBe('Remark is required when editing shipment data.')
    expect(shipmentSaveErrorMessage({})).toBe('Failed to save shipment')
    expect(shipmentSaveErrorMessage(null, 'Could not save')).toBe('Could not save')
  })
})
