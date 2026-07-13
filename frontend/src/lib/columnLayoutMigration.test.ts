import { describe, expect, it } from 'vitest'
import {
  dedupeColumnIds,
  mergePreservedColumnOrder,
  migrateSavedColumnLayout,
} from './columnLayoutMigration'

describe('columnLayoutMigration', () => {
  it('dedupeColumnIds keeps first occurrence order', () => {
    expect(dedupeColumnIds(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c'])
  })

  it('mergePreservedColumnOrder keeps user order and appends missing', () => {
    expect(
      mergePreservedColumnOrder(
        ['quantity_delivered', 'vessel_name', 'quantity_receive'],
        ['late_indicator', 'vessel_name', 'quantity_delivered', 'quantity_receive', 'status'],
        ['late_indicator', 'vessel_name', 'status', 'quantity_delivered', 'quantity_receive'],
      ),
    ).toEqual([
      'quantity_delivered',
      'vessel_name',
      'quantity_receive',
      'late_indicator',
      'status',
    ])
  })

  it('migrateSavedColumnLayout remaps obsolete ids and ensures defaults', () => {
    const result = migrateSavedColumnLayout({
      visibleColumnIds: ['qty_delivery', 'supplier'],
      columnOrderIds: ['supplier', 'qty_delivery', 'port_of_loading'],
      obsoleteColumnIds: ['qty_delivery', 'port_of_loading'],
      idRemap: { qty_delivery: 'contract_qty' },
      ensureVisibleIds: ['contract_qty', 'loading_port'],
    })
    expect(result.visibleColumnIds).toEqual(['contract_qty', 'supplier', 'loading_port'])
    expect(result.columnOrderIds).toEqual(['supplier', 'contract_qty'])
  })
})
