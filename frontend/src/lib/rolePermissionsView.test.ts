import { describe, expect, it } from 'vitest'
import {
  categoryTitle,
  countPermissionChanges,
  enabledPermissionCount,
  filterPermissionRows,
  groupPermissionsByCategory,
  isAllChecked,
  orderedCategories,
  sortPermissionRows,
  type PermissionRow,
} from './rolePermissionsView'

const row = (over: Partial<PermissionRow>): PermissionRow => ({
  id: 'p1',
  permission_key: 'page.shipments',
  permission_name: 'Shipments',
  description: 'Shipments page',
  category: 'page',
  ...over,
})

describe('categories', () => {
  it('orders the known categories first and any new one after', () => {
    const grouped = groupPermissionsByCategory([row({ category: 'action' }), row({ category: 'zeta' }), row({ category: 'page' }), row({ category: '' })])
    expect(orderedCategories(grouped)).toEqual(['page', 'action', 'other', 'zeta'])
  })

  it('names them for people', () => {
    expect(categoryTitle('page')).toBe('Pages')
    expect(categoryTitle('unknown')).toBe('unknown')
  })
})

describe('rows', () => {
  it('sorts by key then name', () => {
    const sorted = sortPermissionRows([row({ permission_key: 'b', permission_name: 'B' }), row({ permission_key: 'a', permission_name: 'A' })])
    expect(sorted.map((r) => r.permission_key)).toEqual(['a', 'b'])
  })

  it('finds rows by name, key or description', () => {
    const list = [row({ permission_name: 'Trucking', permission_key: 'page.trucking', description: 'Land' }), row({ permission_name: 'Oil Loss', permission_key: 'page.oil_loss', description: 'Loss' })]
    expect(filterPermissionRows(list, 'truck')).toHaveLength(1)
    expect(filterPermissionRows(list, 'OIL_LOSS')).toHaveLength(1)
    expect(filterPermissionRows(list, '')).toHaveLength(2)
  })

  it('knows when all four boxes are ticked and how many rows grant anything', () => {
    const all = row({ can_view: true, can_create: true, can_edit: true, can_delete: true })
    expect(isAllChecked(all)).toBe(true)
    expect(isAllChecked(row({ can_view: true }))).toBe(false)
    expect(enabledPermissionCount([all, row({}), row({ can_view: true })])).toBe(2)
  })
})

describe('countPermissionChanges', () => {
  const saved = [row({ id: '1', can_view: true }), row({ id: '2' }), row({ id: '3', can_view: true, can_edit: true })]

  it('is zero when nothing changed, treating missing and false the same', () => {
    expect(countPermissionChanges(saved, [row({ id: '1', can_view: true }), row({ id: '2', can_edit: false }), row({ id: '3', can_view: true, can_edit: true })])).toBe(0)
  })

  it('counts a row once however many of its boxes changed', () => {
    const now = [row({ id: '1', can_view: false }), row({ id: '2', can_view: true, can_create: true }), row({ id: '3', can_view: true, can_edit: true })]
    expect(countPermissionChanges(saved, now)).toBe(2)
  })

  it('counts a brand new row only when it grants something', () => {
    expect(countPermissionChanges([], [row({ id: 'n1' }), row({ id: 'n2', can_view: true })])).toBe(1)
  })
})
