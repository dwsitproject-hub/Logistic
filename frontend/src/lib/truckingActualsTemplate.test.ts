import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import {
  buildActualsTemplateDateColumns,
  buildActualsTemplateMatrix,
  buildTruckingActualsTemplateCsv,
  buildTruckingActualsTemplateXlsxBlob,
  formatTemplateOutstandingQtyMt,
  isActualsTemplateDownloadEnabled,
  isActualsWideTemplateHeader,
  isActualsWideTemplateHeaderCells,
  isActualsWideTemplateMatrix,
  isDateWithinUnplannedPlanningWindow,
  isUnplannedPlanningTemplateMode,
  parseTruckingWidePlanningTemplateCsv,
  parseTruckingWidePlanningTemplateMatrix,
  resolveUnplannedPlanningWindow,
  shiftIsoDate,
  todayIsoDate,
  UNPLANNED_PLANNING_END_BUFFER_DAYS,
  UNPLANNED_PLANNING_START_BUFFER_DAYS,
  UNPLANNED_TEMPLATE_OUTSTANDING_QTY_HEADER,
} from './truckingActualsTemplate'

describe('truckingActualsTemplate', () => {
  it('enables download for Unplanned, Planned, and In Progress', () => {
    expect(isActualsTemplateDownloadEnabled('UNPLANNED')).toBe(true)
    expect(isActualsTemplateDownloadEnabled('PLANNED')).toBe(true)
    expect(isActualsTemplateDownloadEnabled('IN_PROGRESS')).toBe(true)
    expect(isActualsTemplateDownloadEnabled('ALL')).toBe(false)
    expect(isActualsTemplateDownloadEnabled('COMPLETED')).toBe(false)
    expect(isActualsTemplateDownloadEnabled('CANCELLED')).toBe(false)
  })

  it('flags unplanned planning template mode', () => {
    expect(isUnplannedPlanningTemplateMode('UNPLANNED')).toBe(true)
    expect(isUnplannedPlanningTemplateMode('PLANNED')).toBe(false)
  })

  it('resolves unplanned planning window from today and due end', () => {
    const window = resolveUnplannedPlanningWindow('2026-06-30', '2026-06-10')
    expect(window).toEqual({
      startIso: shiftIsoDate('2026-06-10', -UNPLANNED_PLANNING_START_BUFFER_DAYS),
      endIso: shiftIsoDate('2026-06-30', UNPLANNED_PLANNING_END_BUFFER_DAYS),
    })
    expect(
      isDateWithinUnplannedPlanningWindow(window!.startIso, '2026-06-30', '2026-06-10'),
    ).toBe(true)
    expect(
      isDateWithinUnplannedPlanningWindow(
        shiftIsoDate('2026-06-10', -(UNPLANNED_PLANNING_START_BUFFER_DAYS + 1)),
        '2026-06-30',
        '2026-06-10',
      ),
    ).toBe(false)
  })

  it('detects wide actuals template header with PO column', () => {
    expect(isActualsWideTemplateHeader('Contract Ext No,PO,01/06/2026,02/06/2026')).toBe(true)
    expect(isActualsWideTemplateHeader('Contract Ext No,Date,Qty Delivery')).toBe(false)
    expect(isActualsWideTemplateHeaderCells(['Contract Ext No', 'PO', '01/06/2026'])).toBe(true)
    expect(
      isActualsWideTemplateMatrix([['Contract Ext No', 'PO', '01/06/2026'], ['EXT-1', 'PO-1', '10']]),
    ).toBe(true)
  })

  it('does not use internal contract_number when contract_ext_no is missing', () => {
    const matrix = buildActualsTemplateMatrix([
      {
        contract_number: '1004030707',
        po_number: '1001030707',
        planning_start_date: '2026-06-01',
        planning_end_date: '2026-06-02',
        daily_deliverables: [{ date: '2026-06-01', quantity_delivered: 25000 }],
      },
    ])
    expect(matrix).toHaveLength(1)
    expect(matrix[0]).toEqual(['Contract Ext No', 'PO'])
  })

  it('builds CSV with dynamic date columns and per-day MT prefill for planned rows', () => {
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

  it('builds XLSX blob with same matrix as CSV export', async () => {
    const rows = [
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
    ]
    const matrix = buildActualsTemplateMatrix(rows)
    expect(matrix[0]).toEqual(['Contract Ext No', 'PO', '01/06/2026', '02/06/2026'])
    expect(matrix[1]).toEqual(['EXT-001', 'PO-1', '25', '25'])

    const blob = buildTruckingActualsTemplateXlsxBlob(rows)
    const buf = await blob.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const sheet = wb.Sheets[wb.SheetNames[0]!]
    const readBack = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as string[][]
    expect(readBack[0]).toEqual(['Contract Ext No', 'PO', '01/06/2026', '02/06/2026'])
    expect(readBack[1]).toEqual(['EXT-001', 'PO-1', '25', '25'])
  })

  it('builds unplanned template with outstanding qty column and empty daily qty cells', () => {
    const csv = buildTruckingActualsTemplateCsv([
      {
        contract_ext_no: 'EXT-U1',
        po_number: 'PO-U1',
        delivery_end_date: '2026-06-20',
        outstanding_quantity: 125000,
        templateKind: 'unplanned',
      },
    ])

    const startIso = shiftIsoDate(todayIsoDate(), -UNPLANNED_PLANNING_START_BUFFER_DAYS)
    const endIso = shiftIsoDate('2026-06-20', UNPLANNED_PLANNING_END_BUFFER_DAYS)
    expect(csv).toContain(`Contract Ext No,PO,${UNPLANNED_TEMPLATE_OUTSTANDING_QTY_HEADER}`)
    expect(csv).toContain('EXT-U1,PO-U1,125')
    expect(csv).toContain(`${startIso.slice(8, 10)}/${startIso.slice(5, 7)}/${startIso.slice(0, 4)}`)
    expect(csv).toContain(`${endIso.slice(8, 10)}/${endIso.slice(5, 7)}/${endIso.slice(0, 4)}`)
    expect(formatTemplateOutstandingQtyMt(125000)).toBe('125')
  })

  it('formats template outstanding qty from kg to MT', () => {
    expect(formatTemplateOutstandingQtyMt(25000)).toBe('25')
    expect(formatTemplateOutstandingQtyMt(0)).toBe('0')
    expect(formatTemplateOutstandingQtyMt(null)).toBe('')
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

  it('parses unplanned template with outstanding qty column before date columns', () => {
    const csv =
      'Contract Ext No,PO,Outstanding Qty (MT),01/06/2026,02/06/2026\nEXT-1,PO-1,100,12.5,10\n'
    const parsed = parseTruckingWidePlanningTemplateCsv(csv)
    expect(parsed.rowParseFailures).toEqual([])
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0].entries).toEqual([
      { dateIso: '2026-06-01', qtyMt: 12.5, colIndex: 3 },
      { dateIso: '2026-06-02', qtyMt: 10, colIndex: 4 },
    ])
  })

  it('parses wide planning template CSV with MT quantities', () => {
    const csv = 'Contract Ext No,PO,01/06/2026,02/06/2026\nEXT-1,PO-1,12.5,10\n'
    const parsed = parseTruckingWidePlanningTemplateCsv(csv)
    expect(parsed.rowParseFailures).toEqual([])
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0].entries).toEqual([
      { dateIso: '2026-06-01', qtyMt: 12.5, colIndex: 2 },
      { dateIso: '2026-06-02', qtyMt: 10, colIndex: 3 },
    ])
  })

  it('parses wide planning template matrix with Excel serial date headers', () => {
    const parsed = parseTruckingWidePlanningTemplateMatrix([
      ['Contract Ext No', 'PO', 45292, 45293],
      ['EXT-1', 'PO-1', 12.5, 10],
    ])
    expect(parsed.rowParseFailures).toEqual([])
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0].entries[0]?.dateIso).toBe('2024-01-01')
    expect(parsed.rows[0].entries[0]?.qtyMt).toBe(12.5)
  })
})
