import { describe, expect, it } from 'vitest'
import { stoOperationIdDisplay, stoOperationIdIsOpenable } from './contractStoOperationLink'

describe('stoOperationIdIsOpenable', () => {
  it('is false when Operation ID is missing', () => {
    expect(stoOperationIdIsOpenable({ operation_id: null, id: 'uuid', status: 'COMPLETED' })).toBe(
      false,
    )
    expect(stoOperationIdIsOpenable({ operation_id: '—', id: 'uuid', status: 'COMPLETED' })).toBe(
      false,
    )
  })

  it('is true when a live entity UUID exists', () => {
    expect(
      stoOperationIdIsOpenable({
        operation_id: 'OP-LAND-140720260033',
        id: '7d1098ff-eee9-4676-8ea5-db2090da69e2',
        status: 'COMPLETED',
      }),
    ).toBe(true)
  })

  it('is true for Unplanned / Preplanned without a UUID (Add / Plot)', () => {
    expect(
      stoOperationIdIsOpenable({
        operation_id: 'OP-LAND-010120260001',
        id: null,
        status: 'UNPLANNED',
      }),
    ).toBe(true)
    expect(
      stoOperationIdIsOpenable({
        operation_id: 'OP-SEA-010120260001',
        id: null,
        status: 'PREPLANNED',
      }),
    ).toBe(true)
  })

  it('hides SAP/ghost Operation IDs that are not Unplanned', () => {
    expect(
      stoOperationIdIsOpenable({
        operation_id: 'OP-LAND-040820260069',
        id: null,
        status: 'COMPLETED',
      }),
    ).toBe(false)
    expect(
      stoOperationIdDisplay({
        operation_id: 'OP-LAND-040820260069',
        id: null,
        status: 'COMPLETED',
      }),
    ).toBe('—')
  })
})
