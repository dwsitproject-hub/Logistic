import { describe, expect, it } from 'vitest'
import {
  aggregateShippingPerfVesselModalBySto,
  partitionShippingPerfVesselModalRows,
  resolveShippingPerfVesselModalAggregateKey,
} from './shippingPerformanceVesselModal'

const baseRow = {
  id: '1',
  shipment_id: 'SHP-1',
  sto_number: 'STO-100',
  operation_id: 'OP-SEA-1',
  contract_date: '2025-01-01',
  contract_ext_no: 'EXT-1',
  po_number: 'PO-1',
  product: 'Palm',
  incoterm: 'FOB',
  supplier: 'Supplier A',
  loading_port: 'Port A',
  discharge_port: 'Port B',
  delivered_qty: 1000,
  received_qty: 900,
  status: 'PLANNED',
  vessel_name: 'Vessel X',
  loading_delta_eta_etr_days: 5,
  loading_delta_eta_etb_days: 2,
  loading_delta_etb_etc_days: 1,
  discharge_delta_eta_etb_days: 3,
  discharge_delta_etb_etc_days: 4,
  ata_loading_delta_eta_etr_days: 6,
  ata_loading_delta_eta_etb_days: null,
  ata_loading_delta_etb_etc_days: null,
  ata_discharge_delta_eta_etb_days: null,
  ata_discharge_delta_etb_etc_days: null,
}

describe('shippingPerformanceVesselModal', () => {
  it('partitions rows into planned, active ongoing, and history', () => {
    const rows = [
      { ...baseRow, id: '1', status: 'PLANNED' },
      { ...baseRow, id: '2', status: 'IN_PROGRESS' },
      { ...baseRow, id: '3', status: 'UNLOADING' },
      { ...baseRow, id: '4', status: 'COMPLETED' },
      { ...baseRow, id: '5', status: 'CANCELLED' },
      { ...baseRow, id: '6', status: 'UNPLANNED' },
    ]
    const { nextShipment, onGoing, history } = partitionShippingPerfVesselModalRows(rows)
    expect(nextShipment.map((r) => r.id)).toEqual(['1'])
    expect(onGoing.map((r) => r.id)).toEqual(['2', '3'])
    expect(history.map((r) => r.id)).toEqual(['4', '5'])
  })

  it('maps granular shipment pipeline statuses to on-going', () => {
    const rows = [
      { ...baseRow, id: 'lp', status: 'ARRIVED_LP' },
      { ...baseRow, id: 'sail', status: 'SAILED' },
      { ...baseRow, id: 'hist', status: 'COMPLETED' },
    ]
    const { nextShipment, onGoing, history } = partitionShippingPerfVesselModalRows(rows)
    expect(nextShipment).toHaveLength(0)
    expect(onGoing.map((r) => r.id)).toEqual(['lp', 'sail'])
    expect(history.map((r) => r.id)).toEqual(['hist'])
  })

  it('groups multiple PO rows under the same STO', () => {
    const rows = [
      { ...baseRow, id: '1', po_number: 'PO-1', delivered_qty: 1000 },
      { ...baseRow, id: '2', po_number: 'PO-2', delivered_qty: 2000 },
    ]
    const aggregated = aggregateShippingPerfVesselModalBySto(rows)
    expect(aggregated).toHaveLength(1)
    expect(aggregated[0]?.po_number).toBe('PO-1, PO-2')
    expect(aggregated[0]?.delivered_qty).toBe(3000)
    expect(aggregated[0]?.sto).toBe('STO-100')
    expect(aggregated[0]?.shipment_id).toBe('SHP-1')
  })

  it('falls back to operation_id for grouping when STO is synthetic', () => {
    const row = { ...baseRow, sto_number: 'OP-SEA-1', operation_id: 'OP-SEA-1' }
    expect(resolveShippingPerfVesselModalAggregateKey(row)).toBe('op:OP-SEA-1')
    const aggregated = aggregateShippingPerfVesselModalBySto([row])
    expect(aggregated[0]?.sto).toBeNull()
    expect(aggregated[0]?.shipment_id).toBe('SHP-1')
  })

  it('averages delta days when multiple PO rows share one STO', () => {
    const rows = [
      { ...baseRow, id: '1', po_number: 'PO-1', loading_delta_eta_etr_days: 4 },
      { ...baseRow, id: '2', po_number: 'PO-2', loading_delta_eta_etr_days: 6 },
    ]
    const aggregated = aggregateShippingPerfVesselModalBySto(rows)
    expect(aggregated[0]?.loading_delta_eta_etr_days).toBe(5)
  })
})
