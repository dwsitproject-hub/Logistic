import { describe, expect, it } from 'vitest'
import {
  formatLoadingPortBreakdownTooltip,
  pipelineCountForStage,
  pipelineVesselNamesForStage,
  splitVesselNamesForCard,
  SHIPMENT_PAGE_PIPELINE_CARDS,
} from './shipmentPagePipeline'

describe('shipmentPagePipeline', () => {
  it('defines seven pipeline cards', () => {
    expect(SHIPMENT_PAGE_PIPELINE_CARDS).toHaveLength(7)
    expect(SHIPMENT_PAGE_PIPELINE_CARDS.map((c) => c.status)).toEqual([
      'UNPLANNED',
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
      planned: 32,
      atLoadingPort: 5,
      sailed: 8,
      atDischargePort: 3,
      completed: 83,
      cancelled: 1,
      total: 100,
    }
    expect(pipelineCountForStage('PLANNED', counts)).toBe(32)
    expect(pipelineCountForStage('AT_LOADING_PORT', counts)).toBe(5)
  })

  it('resolves per-stage distinct vessel names and hides when absent', () => {
    const vessels = {
      unplanned: [],
      planned: ['KM ANDALAS', 'TB. MITRA 1'],
      atLoadingPort: ['SPOB SEJAHTERA'],
      sailed: [],
      atDischargePort: [],
      completed: ['BG CIPTA', 'KM ANDALAS'],
      cancelled: [],
    }
    expect(pipelineVesselNamesForStage('PLANNED', vessels)).toEqual(['KM ANDALAS', 'TB. MITRA 1'])
    expect(pipelineVesselNamesForStage('UNPLANNED', vessels)).toEqual([])
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
})
