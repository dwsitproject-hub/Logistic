import { describe, expect, it } from 'vitest'
import {
  buildActualsTemplateDateColumns,
  buildTruckingActualsTemplateCsv,
  isActualsTemplateDownloadEnabled,
  isActualsWideTemplateHeader,
} from './truckingActualsTemplate'

describe('truckingActualsTemplate', () => {
  it('enables download only for Planned and In Progress', () => {
    expect(isActualsTemplateDownloadEnabled('PLANNED')).toBe(true)
    expect(isActualsTemplateDownloadEnabled('IN_PROGRESS')).toBe(true)
    expect(isActualsTemplateDownloadEnabled('ALL')).toBe(false)
    expect(isActualsTemplateDownloadEnabled('UNPLANNED')).toBe(false)
    expect(isActualsTemplateDownloadEnabled('COMPLETED')).toBe(false)
    expect(isActualsTemplateDownloadEnabled('CANCELLED')).toBe(false)
  })

  it('detects wide actuals template header with PO column', () => {
    expect(isActualsWideTemplateHeader('Contract Ext No,PO,01/06/2026,02/06/2026')).toBe(true)
    expect(isActualsWideTemplateHeader('Contract Ext No,Date,Qty Delivery')).toBe(false)
  })

  it('builds CSV with dynamic date columns and per-day MT prefill', () => {
    const csv = buildTruckingActualsTemplateCsv([
      {
        contract_ext_no: 'EXT-001',
        po_number: 'PO-1',
        planning_start_date: '2026-06-01',
        planning_end_date: '2026-06-02',
        daily_deliverables: [
          { date: '2026-06-01', quantity_delivered: 25000 },
          { date: '2026-06-02', quantity_delivered: 25000 },
        ],
      },
    ])

    expect(csv).toContain('Contract Ext No,PO,01/06/2026,02/06/2026')
    expect(csv).toContain('EXT-001,PO-1,25,25')
  })

  it('spans date columns from earliest start to latest end across rows', () => {
    const cols = buildActualsTemplateDateColumns([
      {
        planning_start_date: '2026-06-01',
        planning_end_date: '2026-06-02',
      },
      {
        planning_start_date: '2026-06-03',
        planning_end_date: '2026-06-04',
      },
    ])
    expect(cols).toEqual(['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04'])
  })
})
