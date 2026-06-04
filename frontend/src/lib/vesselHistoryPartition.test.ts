import { describe, expect, it } from 'vitest'
import {
  isVesselHistoryClosedStatus,
  isVesselHistoryOnGoingStatus,
  partitionVesselHistoryByStatus,
} from './vesselHistoryPartition'

describe('vesselHistoryPartition', () => {
  it('classifies ongoing statuses case-insensitively', () => {
    expect(isVesselHistoryOnGoingStatus('Planned')).toBe(true)
    expect(isVesselHistoryOnGoingStatus('in transit')).toBe(true)
    expect(isVesselHistoryOnGoingStatus('UNLOADING')).toBe(true)
    expect(isVesselHistoryOnGoingStatus('IN_PROGRESS')).toBe(true)
  })

  it('classifies history as Completed or Cancelled only', () => {
    expect(isVesselHistoryClosedStatus('completed')).toBe(true)
    expect(isVesselHistoryClosedStatus('Cancelled')).toBe(true)
    expect(isVesselHistoryClosedStatus('CANCELED')).toBe(true)
    expect(isVesselHistoryClosedStatus('LOADING')).toBe(false)
  })

  it('partitions rows into ongoing vs history', () => {
    const rows = [
      { id: '1', status: 'PLANNED' },
      { id: '2', status: 'COMPLETED' },
      { id: '3', status: 'Cancelled' },
      { id: '4', status: 'UNPLANNED' },
      { id: '5', status: 'Arrived' },
    ]
    const { onGoingShipments, historyShipments } = partitionVesselHistoryByStatus(rows)
    expect(onGoingShipments.map((r) => r.id)).toEqual(['1', '5'])
    expect(historyShipments.map((r) => r.id)).toEqual(['2', '3'])
  })
})
