import { describe, expect, it } from 'vitest'
import {
  formatLoadingPortBreakdownTooltip,
  pipelineCardQtyForStage,
  pipelineCountForStage,
  pipelineVesselNamesForStage,
  splitVesselNamesForCard,
  SHIPMENT_PAGE_PIPELINE_CARDS,
} from './shipmentPagePipeline'

describe('shipmentPagePipeline', () => {
  it('defines eight pipeline cards including Preplanned', () => {
    expect(SHIPMENT_PAGE_PIPELINE_CARDS).toHaveLength(8)
    expect(SHIPMENT_PAGE_PIPELINE_CARDS.map((c) => c.status)).toEqual([
      'UNPLANNED',
      'PREPLANNED',
      'PLANNED',
      'AT_LOADING_PORT',
      'SAILED',
      'AT_DISCHARGE_PORT',
      'COMPLETED',
      'CANCELLED',
    ])
  })

  it('resolves pipeline stage counts', () => {
    const counts = {
      unplanned: 10,
      preplanned: 4,
      planned: 32,
      atLoadingPort: 5,
      sailed: 8,
      atDischargePort: 3,
      completed: 83,
      cancelled: 1,
      total: 100,
    }
    expect(pipelineCountForStage('PLANNED', counts)).toBe(32)
    expect(pipelineCountForStage('PREPLANNED', counts)).toBe(4)
    expect(pipelineCountForStage('AT_LOADING_PORT', counts)).toBe(5)
  })

  it('resolves per-card contract vs outstanding qty labels', () => {
    const contractQty = {
      unplanned: 1000,
      preplanned: 2000,
      planned: 3000,
      completed: 4000,
      cancelled: 500,
    }
    const outstandingQty = {
      unplanned: 900,
      preplanned: 1800,
      planned: 2700,
      atLoadingPort: 1100,
      sailed: 2200,
      atDischargePort: 3300,
    }
    expect(pipelineCardQtyForStage('PLANNED', contractQty, outstandingQty)).toEqual({
      label: 'Outstanding Qty',
      kg: 2700,
    })
    expect(pipelineCardQtyForStage('UNPLANNED', contractQty, outstandingQty)).toEqual({
      label: 'Outstanding Qty',
      kg: 900,
    })
    expect(pipelineCardQtyForStage('COMPLETED', contractQty, outstandingQty)).toEqual({
      label: 'Contract Qty',
      kg: 4000,
    })
    expect(pipelineCardQtyForStage('AT_LOADING_PORT', contractQty, outstandingQty)).toEqual({
      label: 'Outstanding Qty',
      kg: 1100,
    })
  })

  it('resolves per-stage distinct vessel names and hides when absent', () => {
    const vessels = {
      unplanned: [],
      preplanned: [],
      planned: ['KM ANDALAS', 'TB. MITRA 1'],
      atLoadingPort: ['SPOB SEJAHTERA'],
      sailed: [],
      atDischargePort: [],
      completed: ['BG CIPTA', 'KM ANDALAS'],
      cancelled: [],
    }
    expect(pipelineVesselNamesForStage('PLANNED', vessels)).toEqual(['KM ANDALAS', 'TB. MITRA 1'])
    expect(pipelineVesselNamesForStage('UNPLANNED', vessels)).toEqual([])
    expect(pipelineVesselNamesForStage('PREPLANNED', vessels)).toEqual([])
    // Older cached summaries have no statusVesselNames — the card hides the vessel list.
    expect(pipelineVesselNamesForStage('PLANNED', undefined)).toBeNull()
  })

  it('splits vessel names into a preview plus a +N more overflow', () => {
    expect(splitVesselNamesForCard(['A', 'B'])).toEqual({ preview: ['A', 'B'], moreCount: 0 })
    expect(splitVesselNamesForCard(['A', 'B', 'C', 'D', 'E'])).toEqual({
      preview: ['A', 'B', 'C'],
      moreCount: 2,
    })
    expect(splitVesselNamesForCard([])).toEqual({ preview: [], moreCount: 0 })
  })

  it('formats loading port breakdown tooltip', () => {
    const text = formatLoadingPortBreakdownTooltip({
      arrived: 2,
      berthed: 1,
      loading: 1,
      completedLoading: 1,
    })
    expect(text).toContain('Arrived: 2')
    expect(text).toContain('Completed Loading: 1')
  })

  it('Completed card tooltip includes PO backlog with remaining OS ≤ 1 MT', () => {
    const completed = SHIPMENT_PAGE_PIPELINE_CARDS.find((c) => c.status === 'COMPLETED')
    expect(completed?.tooltip).toMatch(/1 MT/i)
    expect(completed?.tooltip).toMatch(/no shipment/i)
  })
})
