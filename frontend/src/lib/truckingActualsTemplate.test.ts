import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import {
  buildActualsTemplateDateColumns,
  buildActualsTemplateMatrix,
  buildFailedUnplannedUploadRetemplateXlsx,
  buildTruckingActualsTemplateCsv,
  buildTruckingActualsTemplateXlsxBlob,
  compareTruckingActualsTemplateRows,
  formatTemplateOutstandingQtyMt,
  formatTemplateOsQtyMtFromKg,
  formatTemplateQtyMtFromKg,
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
  truckingTemplateSourceSortRank,
  UNPLANNED_PLANNING_FORWARD_DAYS,
  UNPLANNED_TEMPLATE_METADATA_HEADERS,
  UNPLANNED_TEMPLATE_OS_QTY_HEADER,
} from './truckingActualsTemplate'
import { formatPlanningTemplateDateHeader } from './planningTemplateDateFormat'

const REF_TODAY = '2026-06-10'

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

  it('resolves unplanned planning window from today through +60 days', () => {
    const window = resolveUnplannedPlanningWindow('', REF_TODAY)
    expect(window).toEqual({
      startIso: REF_TODAY,
      endIso: shiftIsoDate(REF_TODAY, UNPLANNED_PLANNING_FORWARD_DAYS),
    })
    expect(isDateWithinUnplannedPlanningWindow(REF_TODAY, '', REF_TODAY)).toBe(true)
    expect(
      isDateWithinUnplannedPlanningWindow(
        shiftIsoDate(REF_TODAY, UNPLANNED_PLANNING_FORWARD_DAYS),
        '',
        REF_TODAY,
      ),
    ).toBe(true)
    expect(
      isDateWithinUnplannedPlanningWindow(
        shiftIsoDate(REF_TODAY, UNPLANNED_PLANNING_FORWARD_DAYS + 1),
        '',
        REF_TODAY,
      ),
    ).toBe(false)
  })

  it('detects wide actuals template header with PO column', () => {
    expect(isActualsWideTemplateHeader('Contract Ext No,PO,1-Jun,2-Jun')).toBe(true)
    expect(isActualsWideTemplateHeader('Contract Ext No,Date,Qty Delivery')).toBe(false)
    expect(isActualsWideTemplateHeaderCells(['Contract Ext No', 'PO', '1-Jun'])).toBe(true)
    expect(
      isActualsWideTemplateMatrix([['Contract Ext No', 'PO', '1-Jun'], ['EXT-1', 'PO-1', '10']]),
    ).toBe(true)
    // Legacy DD/MM/YYYY headers still detected via upload parse path
    expect(isActualsWideTemplateHeader('Contract Ext No,PO,01/06/2026,02/06/2026')).toBe(true)
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

  it('builds CSV with dynamic date columns and per-day kg prefill for legacy planned rows', () => {
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

    expect(csv).toContain('Contract Ext No,PO,1-Jun,2-Jun')
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
    expect(matrix[0]).toEqual(['Contract Ext No', 'PO', '1-Jun', '2-Jun'])
    expect(matrix[1]).toEqual(['EXT-001', 'PO-1', '25', '25'])

    const blob = buildTruckingActualsTemplateXlsxBlob(rows)
    const buf = await blob.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const sheet = wb.Sheets[wb.SheetNames[0]!]
    const readBack = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as string[][]
    expect(readBack[0]).toEqual(['Contract Ext No', 'PO', '1-Jun', '2-Jun'])
    expect(readBack[1]).toEqual(['EXT-001', 'PO-1', '25', '25'])
  })

  it('truckingTemplateSourceSortRank orders 3rd Party before Interco/Inhouse', () => {
    expect(truckingTemplateSourceSortRank('3rd Party')).toBeLessThan(truckingTemplateSourceSortRank('Interco'))
    expect(truckingTemplateSourceSortRank('Interco')).toBe(truckingTemplateSourceSortRank('Inhouse'))
    expect(truckingTemplateSourceSortRank('3rd Party')).toBeLessThan(truckingTemplateSourceSortRank('Other'))
  })

  it('compareTruckingActualsTemplateRows sorts source then supplier then PO', () => {
    const rows = [
      {
        source_type: 'Interco',
        supplier: 'Alpha',
        po_number: '100',
      },
      {
        source_type: '3rd Party',
        supplier: 'Beta',
        po_number: '200',
      },
      {
        source_type: '3rd Party',
        supplier: 'Alpha',
        po_number: '50',
      },
    ]
    const sorted = [...rows].sort(compareTruckingActualsTemplateRows)
    expect(sorted.map((r) => `${r.source_type}|${r.supplier}|${r.po_number}`)).toEqual([
      '3rd Party|Alpha|50',
      '3rd Party|Beta|200',
      'Interco|Alpha|100',
    ])
  })

  it('builds unplanned template sorted by source then supplier then PO', () => {
    const matrix = buildActualsTemplateMatrix(
      [
        {
          contract_ext_no: 'EXT-B',
          po_number: 'PO-200',
          supplier: 'Beta Mills',
          group_name: 'G2',
          source_type: 'Interco',
          contract_date: '2026-05-01',
          outstanding_quantity: 50000,
          templateKind: 'unplanned',
        },
        {
          contract_ext_no: 'EXT-A',
          po_number: 'PO-100',
          supplier: 'Alpha Mills',
          group_name: 'G1',
          source_type: '3rd Party',
          contract_date: '2026-04-15',
          outstanding_quantity: 125000,
          templateKind: 'unplanned',
        },
        {
          contract_ext_no: 'EXT-C',
          po_number: 'PO-050',
          supplier: 'Alpha Mills',
          group_name: 'G1',
          source_type: '3rd Party',
          contract_date: '2026-04-10',
          outstanding_quantity: 80000,
          templateKind: 'unplanned',
        },
      ],
      REF_TODAY,
    )

    expect(matrix[1]?.[2]).toBe('3rd Party')
    expect(matrix[1]?.[1]).toBe('Alpha Mills')
    expect(matrix[1]?.[5]).toBe('PO-050')
    expect(matrix[2]?.[2]).toBe('3rd Party')
    expect(matrix[2]?.[5]).toBe('PO-100')
    expect(matrix[3]?.[2]).toBe('Interco')
    expect(matrix[3]?.[1]).toBe('Beta Mills')
  })

  it('builds unplanned template with empty daily qty cells and OS Qty header', () => {
    const csv = buildTruckingActualsTemplateCsv(
      [
        {
          contract_ext_no: 'EXT-U1',
          po_number: 'PO-U1',
          supplier: 'Sup A',
          group_name: 'Vendor G',
          source_type: '3rd Party',
          contract_date: '2026-05-20',
          outstanding_quantity: 125000,
          templateKind: 'unplanned',
        },
      ],
      REF_TODAY,
    )

    const endIso = shiftIsoDate(REF_TODAY, UNPLANNED_PLANNING_FORWARD_DAYS)
    expect(csv).toContain(UNPLANNED_TEMPLATE_OS_QTY_HEADER)
    expect(csv).toContain('Vendor G,Sup A,3rd Party')
    expect(csv).toContain('EXT-U1,PO-U1,Unplanned,125')
    expect(csv).toContain(formatPlanningTemplateDateHeader(REF_TODAY))
    expect(csv).toContain(formatPlanningTemplateDateHeader(endIso))
  })

  it('formats template qty in MT from kg', () => {
    expect(formatTemplateQtyMtFromKg(25000)).toBe('25')
    expect(formatTemplateQtyMtFromKg(0)).toBe('0')
    expect(formatTemplateQtyMtFromKg(null)).toBe('')
  })

  it('rounds OS Qty (MT) to nearest whole ton', () => {
    expect(formatTemplateOsQtyMtFromKg(24050)).toBe('24') // 24.05 → 24
    expect(formatTemplateOsQtyMtFromKg(24550)).toBe('25') // 24.55 → 25
    expect(formatTemplateOsQtyMtFromKg(24500)).toBe('25') // 24.5 → 25
    expect(formatTemplateOsQtyMtFromKg(0)).toBe('0')
    expect(formatTemplateOsQtyMtFromKg(null)).toBe('')
  })

  it('spans date columns from earliest start to latest end across planned rows', () => {
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

  it('parses new unplanned template with metadata columns before date columns', () => {
    const csv =
      'Group,Supplier,Source,Contract Date,Contract Ext No,PO,OS Qty (MT),Plan Qty (MT),1-Jun-2026,2-Jun-2026\nG1,Sup,3rd Party,1-May-2026,EXT-1,PO-1,100,,12.5,10\n'
    const parsed = parseTruckingWidePlanningTemplateCsv(csv)
    expect(parsed.rowParseFailures).toEqual([])
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0].entries).toEqual([
      { dateIso: '2026-06-01', qtyMt: 12500, colIndex: 8 },
      { dateIso: '2026-06-02', qtyMt: 10000, colIndex: 9 },
    ])
  })

  it('parses legacy DD/MM/YYYY date headers on upload', () => {
    const csv =
      'Group,Supplier,Source,Contract Date,Contract Ext No,PO,OS Qty (MT),Plan Qty (MT),01/06/2026,02/06/2026\nG1,Sup,3rd Party,01/05/2026,EXT-1,PO-1,100,,12.5,10\n'
    const parsed = parseTruckingWidePlanningTemplateCsv(csv)
    expect(parsed.rowParseFailures).toEqual([])
    expect(parsed.rows[0].entries).toEqual([
      { dateIso: '2026-06-01', qtyMt: 12500, colIndex: 8 },
      { dateIso: '2026-06-02', qtyMt: 10000, colIndex: 9 },
    ])
  })

  it('parses legacy unplanned template with outstanding qty column before date columns', () => {
    const csv =
      'Contract Ext No,PO,Outstanding Qty (MT),01/06/2026,02/06/2026\nEXT-1,PO-1,100,12.5,10\n'
    const parsed = parseTruckingWidePlanningTemplateCsv(csv)
    expect(parsed.rowParseFailures).toEqual([])
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0].entries).toEqual([
      { dateIso: '2026-06-01', qtyMt: 12500, colIndex: 3 },
      { dateIso: '2026-06-02', qtyMt: 10000, colIndex: 4 },
    ])
  })

  it('parses legacy kg template headers without converting daily qty', () => {
    const csv =
      'Group,Supplier,Source,Contract Date,Contract Ext No,PO,OS Qty (kg),Plan Qty (kg),1-Jun-2026\nG1,Sup,3rd Party,1-May-2026,EXT-1,PO-1,100000,,25000\n'
    const parsed = parseTruckingWidePlanningTemplateCsv(csv)
    expect(parsed.rows[0].entries).toEqual([
      { dateIso: '2026-06-01', qtyMt: 25000, colIndex: 8 },
    ])
  })

  it('parses wide planning template CSV with MT quantities', () => {
    const csv = 'Contract Ext No,PO,1-Jun-2026,2-Jun-2026\nEXT-1,PO-1,12.5,10\n'
    const parsed = parseTruckingWidePlanningTemplateCsv(csv)
    expect(parsed.rowParseFailures).toEqual([])
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0].entries).toEqual([
      { dateIso: '2026-06-01', qtyMt: 12500, colIndex: 2 },
      { dateIso: '2026-06-02', qtyMt: 10000, colIndex: 3 },
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
    expect(parsed.rows[0].entries[0]?.qtyMt).toBe(12500)
  })

  it('adds Plan Qty SUM formula in unplanned XLSX export', async () => {
    const blob = buildTruckingActualsTemplateXlsxBlob(
      [
        {
          contract_ext_no: 'EXT-U1',
          po_number: 'PO-U1',
          supplier: 'Sup A',
          group_name: 'G1',
          source_type: '3rd Party',
          contract_date: '2026-05-20',
          outstanding_quantity: 1000000,
          templateKind: 'unplanned',
        },
      ],
      REF_TODAY,
    )
    const buf = await blob.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array', cellFormula: true })
    const sheet = wb.Sheets[wb.SheetNames[0]!]
    const planQtyCell = sheet.I2
    expect(planQtyCell?.f).toMatch(/^SUM\(J2:/)
    expect(planQtyCell?.t).toBe('n')
    expect(planQtyCell?.v).toBe(0)
  })

  it('exports planned template daily qty as numbers so Plan Qty SUM works', async () => {
    const blob = buildTruckingActualsTemplateXlsxBlob(
      [
        {
          contract_ext_no: 'EXT-P1',
          po_number: 'PO-P1',
          supplier: 'Sup A',
          group_name: 'G1',
          source_type: '3rd Party',
          contract_date: '2026-05-20',
          outstanding_quantity: 100000,
          templateKind: 'planned',
          daily_deliverables: [
            { date: REF_TODAY, quantity_delivered: 25000 },
            { date: shiftIsoDate(REF_TODAY, 1), quantity_delivered: 15000 },
          ],
        },
      ],
      REF_TODAY,
    )
    const buf = await blob.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array', cellFormula: true })
    const sheet = wb.Sheets[wb.SheetNames[0]!]
    const planQtyCell = sheet.I2
    expect(planQtyCell?.f).toMatch(/^SUM\(J2:/)
    expect(planQtyCell?.t).toBe('n')
    expect(planQtyCell?.v).toBe(40)
    expect(sheet.J2?.t).toBe('n')
    expect(sheet.J2?.v).toBe(25)
    expect(sheet.K2?.t).toBe('n')
    expect(sheet.K2?.v).toBe(15)
    expect(sheet.H2?.t).toBe('n')
    expect(sheet.H2?.v).toBe(100)
    expect(sheet.G2?.v).toBe('Planned')
  })

  it('includes Status before OS Qty and parses both Status-present and legacy templates', () => {
    const matrix = buildActualsTemplateMatrix(
      [
        {
          contract_ext_no: 'EXT-U',
          po_number: 'PO-U',
          supplier: 'Sup',
          group_name: 'G',
          source_type: '3rd Party',
          contract_date: '2026-05-01',
          outstanding_quantity: 50000,
          templateKind: 'unplanned',
        },
        {
          contract_ext_no: 'EXT-P',
          po_number: 'PO-P',
          supplier: 'Sup',
          group_name: 'G',
          source_type: '3rd Party',
          contract_date: '2026-05-01',
          outstanding_quantity: 80000,
          templateKind: 'planned',
          daily_deliverables: [{ date: REF_TODAY, quantity_delivered: 10000 }],
        },
      ],
      REF_TODAY,
    )
    expect(matrix[0]?.[6]).toBe('Status')
    expect(matrix[0]?.[7]).toBe(UNPLANNED_TEMPLATE_OS_QTY_HEADER)
    expect(matrix[1]?.[6]).toBe('Planned')
    expect(matrix[2]?.[6]).toBe('Unplanned')
  })

  it('builds failed upload re-template with Reason column at the end', async () => {
    const blob = buildFailedUnplannedUploadRetemplateXlsx({
      uploadHeaderRow: [
        'Group',
        'Supplier',
        'Source',
        'Contract Date',
        'Contract Ext No',
        'PO',
        'OS Qty (MT)',
        'Plan Qty (MT)',
        '10/06/2026',
      ],
      failedRows: [
        {
          cells: ['G1', 'Sup A', '3rd Party', '01/05/2026', 'EXT-1', 'PO-1', '100', '', '40'],
          reason: 'Total daily planning qty (40 MT) is less than Outstanding Qty (100 MT)',
        },
      ],
    })
    const buf = await blob.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array', cellFormula: true })
    const sheet = wb.Sheets[wb.SheetNames[0]!]
    const readBack = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as string[][]
    expect(readBack[0]?.[readBack[0].length - 1]).toBe('Reason')
    expect(readBack[1]?.[readBack[1].length - 1]).toContain('less than Outstanding Qty')
  })
})
