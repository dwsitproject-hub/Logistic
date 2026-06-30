import { describe, expect, it } from 'vitest'
import { resolveShipmentTablePrimaryAction } from './shipmentViewTableActions'

describe('resolveShipmentTablePrimaryAction', () => {
  it('maps Unplanned to add', () => {
    expect(resolveShipmentTablePrimaryAction('UNPLANNED')).toBe('add')
  })

  it('maps Planned through Completed to edit', () => {
    expect(resolveShipmentTablePrimaryAction('PLANNED')).toBe('edit')
    expect(resolveShipmentTablePrimaryAction('SAILED')).toBe('edit')
    expect(resolveShipmentTablePrimaryAction('COMPLETED')).toBe('edit')
  })

  it('maps Cancelled to view', () => {
    expect(resolveShipmentTablePrimaryAction('CANCELLED')).toBe('view')
  })
})
