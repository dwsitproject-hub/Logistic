import { describe, expect, it } from 'vitest'
import { canCancelKlipShipment, cancelKlipShipmentDisabledReason, resolveShipmentRowOpenTarget, resolveShipmentTablePrimaryAction, shipmentRowHasRegisteredPlanning } from './shipmentViewTableActions'

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

describe('shipmentRowHasRegisteredPlanning', () => {
  it('returns false for unplanned rows', () => {
    expect(shipmentRowHasRegisteredPlanning('UNPLANNED')).toBe(false)
    expect(shipmentRowHasRegisteredPlanning('')).toBe(false)
  })

  it('returns true when status is beyond unplanned', () => {
    expect(shipmentRowHasRegisteredPlanning('PLANNED')).toBe(true)
    expect(shipmentRowHasRegisteredPlanning('SAILED')).toBe(true)
  })
})

describe('canCancelKlipShipment', () => {
  it('allows KLIP-only planned shipment without SAP STO', () => {
    expect(
      canCancelKlipShipment({
        status: 'PLANNED',
        row_kind: 'shipment_execution',
        sto_number: null,
        sto_key: 'OP-1700000000',
        operation_id: 'OP-1700000000',
      }),
    ).toBe(true)
  })

  it('blocks SAP STO rows', () => {
    expect(
      canCancelKlipShipment({
        status: 'PLANNED',
        sto_number: '1006018854',
        sto_key: '1006018854',
        operation_id: '1006018854',
      }),
    ).toBe(false)
  })

  it('blocks contract backlog and already cancelled rows', () => {
    expect(
      canCancelKlipShipment({
        status: 'UNPLANNED',
        row_kind: 'contract_backlog',
        sto_number: null,
        operation_id: 'OP-1',
      }),
    ).toBe(false)
    expect(
      canCancelKlipShipment({
        status: 'CANCELLED',
        sto_number: null,
        operation_id: 'OP-1',
      }),
    ).toBe(false)
  })
})

describe('cancelKlipShipmentDisabledReason', () => {
  it('returns null when eligible', () => {
    expect(
      cancelKlipShipmentDisabledReason({
        status: 'PLANNED',
        sto_number: null,
        sto_key: 'OP-1',
        operation_id: 'OP-1',
      }),
    ).toBeNull()
  })

  it('explains SAP STO and cancelled cases', () => {
    expect(
      cancelKlipShipmentDisabledReason({
        status: 'PLANNED',
        sto_number: '1006018854',
      }),
    ).toMatch(/SAP STO/i)
    expect(
      cancelKlipShipmentDisabledReason({
        status: 'CANCELLED',
        sto_number: null,
        operation_id: 'OP-1',
      }),
    ).toMatch(/already cancelled/i)
  })
})

describe('resolveShipmentRowOpenTarget', () => {
  const backlog = { row_kind: 'contract_backlog' }
  const real = { row_kind: 'shipment_execution' }

  it('never sends a backlog row to a shipment-by-id screen', () => {
    // Its `id` is the contract uuid, so /shipments/:id would 404 - the reported bug.
    expect(resolveShipmentRowOpenTarget(backlog, { readOnly: false })).toBe('add_shipment')
    expect(resolveShipmentRowOpenTarget(backlog, { readOnly: true })).toBe('contract_detail')
  })

  it('ignores status on backlog rows', () => {
    // The backlog SQL promotes low-OS rows to COMPLETED; there is still no shipment behind them.
    expect(resolveShipmentRowOpenTarget({ ...backlog }, { readOnly: false })).toBe('add_shipment')
  })

  it('leaves real shipment rows on the edit modal', () => {
    expect(resolveShipmentRowOpenTarget(real, { readOnly: false })).toBe('edit_shipment')
    expect(resolveShipmentRowOpenTarget(real, { readOnly: true })).toBe('edit_shipment')
    expect(resolveShipmentRowOpenTarget({}, {})).toBe('edit_shipment')
  })
})
