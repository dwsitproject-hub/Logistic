import { describe, expect, it } from 'vitest'
import {
  formatLoadingPortBreakdownTooltip,
  pipelineCountForStage,
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
