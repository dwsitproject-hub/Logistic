import { describe, expect, it } from 'vitest'
import { perfDataModeFromCard } from './shippingPerformanceLabels'
import {
  applyShippingPerfCardFilter,
  countUniqueShippingPerfStoKeys,
  shippingPerfRowMatchesCard,
  type ShippingPerfCardRow,
} from './shippingPerformanceCardFilter'

function row(partial: Partial<ShippingPerfCardRow>): ShippingPerfCardRow {
  return {
    id: '1',
    shipment_id: 'S1',
    sto_number: 'STO-1',
    import_status: 'Open',
    status: 'PLANNED',
    ...partial,
  }
}

describe('perfDataModeFromCard', () => {
  it('maps On Going to ETA data keys and Close to ATA', () => {
    expect(perfDataModeFromCard('all')).toBe('eta')
    expect(perfDataModeFromCard('ongoing')).toBe('eta')
    expect(perfDataModeFromCard('close')).toBe('ata')
  })
})

describe('shippingPerfRowMatchesCard', () => {
  it('routes COMPLETED status to Close regardless of ETA/ATA presence', () => {
    const completed = row({
      status: 'COMPLETED',
      loading_eta_arrival: null,
      loading_ata_arrival: null,
    })
    expect(shippingPerfRowMatchesCard(completed, 'close')).toBe(true)
    expect(shippingPerfRowMatchesCard(completed, 'ongoing')).toBe(false)
  })

  it('includes PLANNED with or without ETA in On Going', () => {
    const plannedNoEta = row({ status: 'PLANNED', loading_eta_arrival: null })
    const plannedWithEta = row({ status: 'PLANNED', loading_eta_arrival: '2026-01-01' })
    expect(shippingPerfRowMatchesCard(plannedNoEta, 'ongoing')).toBe(true)
    expect(shippingPerfRowMatchesCard(plannedWithEta, 'ongoing')).toBe(true)
    expect(shippingPerfRowMatchesCard(plannedNoEta, 'close')).toBe(false)
  })

  it('includes pre-COMPLETED statuses in On Going', () => {
    const unloadingWithEta = row({
      status: 'UNLOADING',
      loading_eta_arrival: '2026-01-01',
      loading_ata_arrival: '2026-01-02',
    })
    expect(shippingPerfRowMatchesCard(unloadingWithEta, 'ongoing')).toBe(true)
    expect(shippingPerfRowMatchesCard(unloadingWithEta, 'close')).toBe(false)
  })

  it('keeps COMPLETED_LOADING in On Going (not Close)', () => {
    const completedLoading = row({
      status: 'COMPLETED_LOADING',
      loading_eta_arrival: '2026-01-01',
    })
    expect(shippingPerfRowMatchesCard(completedLoading, 'ongoing')).toBe(true)
    expect(shippingPerfRowMatchesCard(completedLoading, 'close')).toBe(false)
  })

  it('excludes UNPLANNED and CANCELLED from cards', () => {
    expect(shippingPerfRowMatchesCard(row({ status: 'UNPLANNED' }), 'ongoing')).toBe(false)
    expect(shippingPerfRowMatchesCard(row({ status: 'CANCELLED' }), 'ongoing')).toBe(false)
    expect(shippingPerfRowMatchesCard(row({ status: 'CANCELLED' }), 'close')).toBe(false)
  })

  it('filters per row so COMPLETED sibling does not pull PLANNED into Close', () => {
    const rows = [
      row({ id: 'a', sto_number: 'STO-A', status: 'PLANNED' }),
      row({
        id: 'b',
        sto_number: 'STO-B',
        status: 'COMPLETED',
        loading_eta_arrival: '2026-01-01',
      }),
    ]
    expect(applyShippingPerfCardFilter(rows, 'ongoing').map((r) => r.sto_number)).toEqual([
      'STO-A',
    ])
    expect(applyShippingPerfCardFilter(rows, 'close').map((r) => r.sto_number)).toEqual(['STO-B'])
  })

  it('counts unique STO keys from filtered rows', () => {
    const rows = [
      row({ id: '1', sto_number: 'STO-1' }),
      row({ id: '2', sto_number: 'STO-1' }),
      row({ id: '3', sto_number: 'STO-2' }),
    ]
    expect(countUniqueShippingPerfStoKeys(rows)).toBe(2)
  })

  it('counts two STOs on the same vessel name as two vessels', () => {
    const rows = [
      row({ id: '1', sto_number: '1001', shipment_id: '1001' }),
      row({ id: '2', sto_number: '1002', shipment_id: '1002' }),
    ]
    expect(countUniqueShippingPerfStoKeys(rows)).toBe(2)
  })

  it('falls back to KLIP operation_id when STO is missing', () => {
    const rows = [
      row({ id: '1', sto_number: null, sto_key: null, operation_id: 'OP-LAND-1', shipment_id: 'MNL-1' }),
      row({ id: '2', sto_number: '', sto_key: '', operation_id: 'OP-LAND-1', shipment_id: 'MNL-2' }),
      row({ id: '3', sto_number: null, sto_key: null, operation_id: 'OP-LAND-2', shipment_id: 'MNL-3' }),
    ]
    expect(countUniqueShippingPerfStoKeys(rows)).toBe(2)
  })
})
