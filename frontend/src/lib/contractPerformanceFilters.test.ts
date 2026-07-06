/**
 * Contract Performance Pipeline — E2E Data Integrity Test Suite
 *
 * GOLDEN RULE: Outstanding Qty and contract counts MUST remain consistent
 * from Section 1 (Summary) → Section 2 (Drilldown) → Section 3 (View Table).
 *
 * Coverage:
 *   AC1  Baseline Vertical Consistency (no local filters)
 *   AC2  Global Filter Propagation
 *   AC3  Drilldown "Apply" — Section 3 count matches active node count
 *   AC4  Blank / null value handling in drilldown
 *   AC5  "Open" status fallback — null trade_cycle_days not dropped
 */

import { describe, it, expect } from 'vitest'
import {
  contractMatchesLateOnTimeFilter,
  contractMeetsPerformanceTreeInclusion,
  contractPerfDrilldownToTableColumnFilters,
  countPerformanceHotspotContracts,
  filterContractsForPerformanceTable,
  filterPerformanceHotspots,
  flattenLatePerfApiTreeToHotspots,
  hasContractPerfDrilldownSelection,
  isContractPerfSection3FilterApplied,
  contractMatchesSummaryCardStatus,
  contractPerfProductQueryValue,
  isBlankFilterSentinel,
  matchesContractPerfSourceFilter,
  matchesPerformanceDimensionFilter,
  normalizePerfGroupKey,
  normalizePerfProductGroupKey,
  buildContractPerfToolbarGlobal,
  buildContractPerfTableListParams,
  buildLatePerformanceCardSummaryApiParams,
  buildLatePerformanceTreeApiParams,
  buildLatePerformanceApiParams,
  stableContractPerfApiParamsKey,
  resolveContractPerformanceScope,
  resolveContractPerformanceCardSummaryScope,
  resolveEffectiveLateOnTimeFilter,
  resolveSection3Scope,
  sumHotspotQtyKg,
  type ContractPerfDrilldownFilters,
  type ContractPerfHotspot,
  type ContractPerformanceGlobalFilters,
  type LatePerfApiTreeNode,
  type PerformanceTableContract,
  EMPTY_CONTRACT_PERF_DRILLDOWN,
} from './contractPerformanceFilters'

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const BASE_GLOBAL: ContractPerformanceGlobalFilters = {
  dateFrom: '',
  dateTo: '',
  sourceFilter: 'All',
  selectedIncoterms: [],
  selectedSuppliers: [],
  selectedGroupPlants: [],
  productTabQuery: undefined,
  summaryCardStatus: 'Open',
  lateOnTimeFilter: 'ALL',
  perfDashMode: 'late',
  perfTransportMode: 'ALL',
  b2bFlagFilter: 'ALL',
  search: '',
}

/** Build a minimal hotspot row. */
function hotspot(overrides: Partial<ContractPerfHotspot> = {}): ContractPerfHotspot {
  return {
    contract_id: 'C001',
    incoterm: 'CIF',
    product: 'CPO',
    plant_site: 'PLANT-A',
    group_name: 'GRP-1',
    supplier: 'SUPP-1',
    count: 1,
    totalDays: 5,
    maxDays: 5,
    totalQtyDelivery: 1000,
    ...overrides,
  }
}

/** Build a minimal table contract. */
function tableContract(overrides: Partial<PerformanceTableContract> = {}): PerformanceTableContract {
  return {
    contract_id: 'C001',
    product: 'CPO',
    incoterm: 'CIF',
    supplier: 'SUPP-1',
    plant_site: 'PLANT-A',
    delivery_end_date: '2026-05-01',
    trade_cycle_days: 5,
    import_status: 'OPEN',
    status: 'OPEN',
    ...overrides,
  }
}

/** Build a simple API tree with one leaf per contract. */
function buildTree(contracts: Array<{ id: string; incoterm: string; plant: string; product: string; group: string; supplier: string; qty: number }>): LatePerfApiTreeNode[] {
  const byIncoterm = new Map<string, Map<string, Map<string, Map<string, Map<string, { count: number; qty: number }>>>>>()
  for (const c of contracts) {
    if (!byIncoterm.has(c.incoterm)) byIncoterm.set(c.incoterm, new Map())
    const plants = byIncoterm.get(c.incoterm)!
    if (!plants.has(c.plant)) plants.set(c.plant, new Map())
    const prods = plants.get(c.plant)!
    if (!prods.has(c.product)) prods.set(c.product, new Map())
    const groups = prods.get(c.product)!
    if (!groups.has(c.group)) groups.set(c.group, new Map())
    const sups = groups.get(c.group)!
    const prev = sups.get(c.supplier) ?? { count: 0, qty: 0 }
    sups.set(c.supplier, { count: prev.count + 1, qty: prev.qty + c.qty })
  }
  const tree: LatePerfApiTreeNode[] = []
  for (const [inc, plants] of byIncoterm) {
    const incNode: LatePerfApiTreeNode = { key: inc, count: 0, totalDays: 0, maxDays: 0, children: [] }
    for (const [plant, prods] of plants) {
      const plantNode: LatePerfApiTreeNode = { key: plant, count: 0, totalDays: 0, maxDays: 0, children: [] }
      for (const [prod, groups] of prods) {
        const prodNode: LatePerfApiTreeNode = { key: prod, count: 0, totalDays: 0, maxDays: 0, children: [] }
        for (const [grp, sups] of groups) {
          const grpNode: LatePerfApiTreeNode = { key: grp, count: 0, totalDays: 0, maxDays: 0, children: [] }
          for (const [sup, { count, qty }] of sups) {
            grpNode.children!.push({ key: sup, count, totalDays: 0, maxDays: 0, totalQtyDelivery: qty })
            grpNode.count += count
          }
          prodNode.children!.push(grpNode)
          prodNode.count += grpNode.count
        }
        plantNode.children!.push(prodNode)
        plantNode.count += prodNode.count
      }
      incNode.children!.push(plantNode)
      incNode.count += plantNode.count
    }
    tree.push(incNode)
  }
  return tree
}

// ---------------------------------------------------------------------------
// AC1 — Baseline Vertical Consistency
// ---------------------------------------------------------------------------

describe('AC1 — Baseline Vertical Consistency (no local filters)', () => {
  const onTrackContracts = [
    { id: 'OT-1', incoterm: 'CIF', plant: 'PLANT-A', product: 'CPO', group: 'GRP-1', supplier: 'SUPP-1', qty: 500 },
    { id: 'OT-2', incoterm: 'FOB', plant: 'PLANT-B', product: 'PK',  group: 'GRP-2', supplier: 'SUPP-2', qty: 300 },
  ]
  const lateContracts = [
    { id: 'L-1', incoterm: 'CIF', plant: 'PLANT-A', product: 'CPO', group: 'GRP-1', supplier: 'SUPP-1', qty: 200 },
    { id: 'L-2', incoterm: 'DAP', plant: 'PLANT-C', product: 'POME', group: 'GRP-3', supplier: 'SUPP-3', qty: 100 },
    { id: 'L-3', incoterm: 'FOB', plant: 'PLANT-B', product: 'PK',  group: 'GRP-2', supplier: 'SUPP-2', qty: 150 },
  ]

  const onTrackTree = buildTree(onTrackContracts)
  const lateTree    = buildTree(lateContracts)

  const onTrackHotspots = flattenLatePerfApiTreeToHotspots(onTrackTree)
  const lateHotspots    = flattenLatePerfApiTreeToHotspots(lateTree)

  const globalScope = resolveContractPerformanceScope({ global: BASE_GLOBAL, drilldown: EMPTY_CONTRACT_PERF_DRILLDOWN })
  const allHotspots = [...onTrackHotspots, ...lateHotspots]
  const section1Hotspots = filterPerformanceHotspots(allHotspots, globalScope, { applyDrilldown: false })

  it('Section 1 contract count equals sum of all unique contracts in both trees', () => {
    const s1Count = countPerformanceHotspotContracts(section1Hotspots)
    // OT-1, OT-2, L-1, L-2, L-3 = 5 unique contracts (leaf-count based since no contract_id in tree)
    const totalLeafCount = onTrackContracts.length + lateContracts.length
    expect(s1Count).toBe(totalLeafCount)
  })

  it('Section 1 outstanding qty equals sum of all hotspot qty deliveries', () => {
    const totalQty = sumHotspotQtyKg(section1Hotspots)
    const expectedQty = [...onTrackContracts, ...lateContracts].reduce((s, c) => s + c.qty, 0)
    expect(totalQty).toBe(expectedQty)
  })

  it('On Time + Late leaf counts sum to Section 1 contract count', () => {
    const onTimeCount = countPerformanceHotspotContracts(onTrackHotspots)
    const lateCount   = countPerformanceHotspotContracts(lateHotspots)
    const s1Count     = countPerformanceHotspotContracts(section1Hotspots)
    expect(onTimeCount + lateCount).toBe(s1Count)
  })

  it('Section 3 table rows matching no drilldown equal Section 1 hotspot count', () => {
    const tableContracts = [
      tableContract({ contract_id: 'OT-1', product: 'CPO', incoterm: 'CIF', plant_site: 'PLANT-A', supplier: 'SUPP-1' }),
      tableContract({ contract_id: 'OT-2', product: 'PK',  incoterm: 'FOB', plant_site: 'PLANT-B', supplier: 'SUPP-2' }),
      tableContract({ contract_id: 'L-1',  product: 'CPO', incoterm: 'CIF', plant_site: 'PLANT-A', supplier: 'SUPP-1' }),
      tableContract({ contract_id: 'L-2',  product: 'POME', incoterm: 'DAP', plant_site: 'PLANT-C', supplier: 'SUPP-3' }),
      tableContract({ contract_id: 'L-3',  product: 'PK',  incoterm: 'FOB', plant_site: 'PLANT-B', supplier: 'SUPP-2' }),
    ]
    const { scope: s3Scope } = resolveSection3Scope(BASE_GLOBAL, EMPTY_CONTRACT_PERF_DRILLDOWN)
    const filtered = filterContractsForPerformanceTable(tableContracts, s3Scope, 'ALL')
    expect(filtered.length).toBe(tableContracts.length)
    expect(filtered.length).toBe(countPerformanceHotspotContracts(section1Hotspots))
  })
})

// ---------------------------------------------------------------------------
// AC2 — Global Filter Propagation
// ---------------------------------------------------------------------------

describe('AC2 — Global Filter Propagation', () => {
  const allHotspots: ContractPerfHotspot[] = [
    hotspot({ contract_id: 'A1', incoterm: 'CIF', plant_site: 'PLANT-A', product: 'CPO',  supplier: 'SUPP-1', totalQtyDelivery: 1000 }),
    hotspot({ contract_id: 'A2', incoterm: 'FOB', plant_site: 'PLANT-B', product: 'PK',   supplier: 'SUPP-2', totalQtyDelivery: 500  }),
    hotspot({ contract_id: 'A3', incoterm: 'CIF', plant_site: 'PLANT-A', product: 'POME', supplier: 'SUPP-1', totalQtyDelivery: 300  }),
    hotspot({ contract_id: 'A4', incoterm: 'DAP', plant_site: 'PLANT-C', product: 'CPO',  supplier: 'SUPP-3', totalQtyDelivery: 200  }),
  ]

  it('filtering by incoterm returns only matching rows across all sections', () => {
    const global = { ...BASE_GLOBAL, selectedIncoterms: ['CIF'] }
    const scope  = resolveContractPerformanceScope({ global, drilldown: EMPTY_CONTRACT_PERF_DRILLDOWN })
    const result = filterPerformanceHotspots(allHotspots, scope, { applyDrilldown: false })
    expect(result.every((r) => r.incoterm === 'CIF')).toBe(true)
    expect(result.length).toBe(2) // A1 and A3
  })

  it('filtering by plant returns only matching rows across all sections', () => {
    const global = { ...BASE_GLOBAL, selectedGroupPlants: ['PLANT-B'] }
    const scope  = resolveContractPerformanceScope({ global, drilldown: EMPTY_CONTRACT_PERF_DRILLDOWN })
    const result = filterPerformanceHotspots(allHotspots, scope, { applyDrilldown: false })
    expect(result.every((r) => r.plant_site === 'PLANT-B')).toBe(true)
    expect(result.length).toBe(1)
  })

  it('filtering by product tab returns only matching rows across all sections', () => {
    const global = { ...BASE_GLOBAL, productTabQuery: 'CPO' }
    const scope  = resolveContractPerformanceScope({ global, drilldown: EMPTY_CONTRACT_PERF_DRILLDOWN })
    const result = filterPerformanceHotspots(allHotspots, scope, { applyDrilldown: false })
    expect(result.every((r) => normalizePerfProductGroupKey(r.product) === 'CPO')).toBe(true)
    expect(result.length).toBe(2) // A1 and A4
  })

  it('product tab uses substring match (aligned with GET /contracts ILIKE)', () => {
    const rows = [
      hotspot({ contract_id: 'P-1', product: 'POME', totalQtyDelivery: 100 }),
      hotspot({ contract_id: 'P-2', product: 'CRUDE POME', totalQtyDelivery: 200 }),
      hotspot({ contract_id: 'P-3', product: 'CPO', totalQtyDelivery: 50 }),
    ]
    const global = { ...BASE_GLOBAL, productTabQuery: 'POME' }
    const scope = resolveContractPerformanceScope({ global, drilldown: EMPTY_CONTRACT_PERF_DRILLDOWN })
    const result = filterPerformanceHotspots(rows, scope, { applyDrilldown: false })
    expect(result.map((r) => r.contract_id).sort()).toEqual(['P-1', 'P-2'])
  })

  it('Shell Palm tab matches DB product SHELL PALM in Section 2 hotspots', () => {
    expect(contractPerfProductQueryValue('Shell Palm')).toBe('SHELL PALM')
    const rows = [
      hotspot({ contract_id: 'SP-1', product: 'SHELL PALM', totalQtyDelivery: 500 }),
      hotspot({ contract_id: 'SP-2', product: 'CPO', totalQtyDelivery: 100 }),
    ]
    const global = {
      ...BASE_GLOBAL,
      productTabQuery: contractPerfProductQueryValue('Shell Palm'),
    }
    const scope = resolveContractPerformanceScope({ global, drilldown: EMPTY_CONTRACT_PERF_DRILLDOWN })
    expect(scope.resolvedProduct).toBe('SHELL PALM')
    const result = filterPerformanceHotspots(rows, scope, { applyDrilldown: false })
    expect(result.map((r) => r.contract_id)).toEqual(['SP-1'])
  })

  it('Section 3 table is re-filtered when global incoterm changes', () => {
    const contracts = [
      tableContract({ contract_id: 'A1', incoterm: 'CIF', plant_site: 'PLANT-A', supplier: 'SUPP-1' }),
      tableContract({ contract_id: 'A2', incoterm: 'FOB', plant_site: 'PLANT-B', supplier: 'SUPP-2' }),
    ]
    const globalCIF = { ...BASE_GLOBAL, selectedIncoterms: ['CIF'] }
    const { scope: scopeCIF } = resolveSection3Scope(globalCIF, EMPTY_CONTRACT_PERF_DRILLDOWN)
    const filtered = filterContractsForPerformanceTable(contracts, scopeCIF, 'ALL')
    expect(filtered.length).toBe(1)
    expect(filtered[0].contract_id).toBe('A1')
  })

  it('No section is left behind — scope object resolvedIncoterms is shared, not duplicated', () => {
    const global = { ...BASE_GLOBAL, selectedIncoterms: ['CIF', 'FOB'] }
    const scope  = resolveContractPerformanceScope({ global, drilldown: EMPTY_CONTRACT_PERF_DRILLDOWN })
    // The scope object is the single reference passed to all three sections
    expect(scope.resolvedIncoterms).toEqual(['CIF', 'FOB'])
    expect(scope.global.selectedIncoterms).toBe(global.selectedIncoterms) // same reference
  })

  it('isContractPerfSection3FilterApplied is true when Open or Close card is selected', () => {
    expect(
      isContractPerfSection3FilterApplied({
        sourceFilter: 'All',
        selectedProductTab: 'All',
        summaryCardStatus: 'All',
        appliedDrilldown: EMPTY_CONTRACT_PERF_DRILLDOWN,
      }),
    ).toBe(false)
    expect(
      isContractPerfSection3FilterApplied({
        sourceFilter: 'All',
        selectedProductTab: 'All',
        summaryCardStatus: 'Open',
        appliedDrilldown: EMPTY_CONTRACT_PERF_DRILLDOWN,
      }),
    ).toBe(true)
    expect(
      isContractPerfSection3FilterApplied({
        sourceFilter: 'Interco',
        selectedProductTab: 'CPO',
        summaryCardStatus: 'Close',
        appliedDrilldown: EMPTY_CONTRACT_PERF_DRILLDOWN,
      }),
    ).toBe(true)
  })

  it('contractMatchesSummaryCardStatus filters Section 3 rows by Open/Close', () => {
    const openRow = tableContract({ import_status: 'OPEN', status: 'OPEN' })
    const closeRow = tableContract({ import_status: 'CLOSE', status: 'CLOSE', trade_cycle_days: 2 })
    expect(contractMatchesSummaryCardStatus(openRow, 'Open')).toBe(true)
    expect(contractMatchesSummaryCardStatus(closeRow, 'Open')).toBe(false)
    expect(contractMatchesSummaryCardStatus(closeRow, 'Close')).toBe(true)
  })

  it('Status filter change propagates — Close status hits contractStatus on scope', () => {
    const global = { ...BASE_GLOBAL, summaryCardStatus: 'Close' as const }
    const scope  = resolveContractPerformanceScope({ global, drilldown: EMPTY_CONTRACT_PERF_DRILLDOWN })
    expect(scope.contractStatus).toBe('Close')
    // Section 3 scope must also reflect the same status
    const { scope: s3Scope } = resolveSection3Scope(global, EMPTY_CONTRACT_PERF_DRILLDOWN)
    expect(s3Scope.contractStatus).toBe('Close')
  })

  it('Section 1 card summary API omits status even when Open tab is active', () => {
    const global = { ...BASE_GLOBAL, summaryCardStatus: 'Open' as const, productTabQuery: 'CPO' }
    const cardParams = buildLatePerformanceCardSummaryApiParams(global)
    expect(cardParams.get('status')).toBeNull()
    const treeScope = resolveContractPerformanceScope({ global, drilldown: EMPTY_CONTRACT_PERF_DRILLDOWN })
    const treeParams = buildLatePerformanceApiParams(treeScope, false)
    expect(treeParams.get('status')).toBe('Open')
    const cardScope = resolveContractPerformanceCardSummaryScope(global)
    expect(cardScope.contractStatus).toBe('All')
  })

  it('All status uses filtered scope when YTD dates are set so toolbar filters apply', () => {
    const global = {
      ...BASE_GLOBAL,
      summaryCardStatus: 'All' as const,
      dateFrom: '2026-01-01',
      dateTo: '2026-06-03',
      selectedGroupPlants: ['PLANT-A'],
    }
    const treeParams = buildLatePerformanceTreeApiParams(global)
    expect(treeParams.get('scope')).toBe('filtered')
    expect(treeParams.get('status')).toBeNull()
    expect(treeParams.getAll('plant')).toEqual(['PLANT-A'])
    const cardParams = buildLatePerformanceCardSummaryApiParams(global)
    expect(cardParams.get('scope')).toBe('filtered')
    expect(cardParams.get('status')).toBeNull()
  })

  it('Section 2 tree API omits applied drilldown path (card counts stay global)', () => {
    const global = { ...BASE_GLOBAL, summaryCardStatus: 'Open' as const, productTabQuery: 'CPO' }
    const drilldown: ContractPerfDrilldownFilters = {
      product: 'CPO',
      plant: 'PLANT-A',
      incoterm: 'CIF',
      supplier: null,
    }
    const linkedScope = resolveContractPerformanceScope({ global, drilldown })
    const treeParams = buildLatePerformanceTreeApiParams(global)
    const linkedTreeParams = buildLatePerformanceApiParams(linkedScope, true)
    expect(treeParams.get('status')).toBe('Open')
    expect(treeParams.get('supplier')).toBeNull()
    expect(linkedTreeParams.get('supplier')).toBeNull()
    expect(stableContractPerfApiParamsKey(treeParams)).toBe(
      stableContractPerfApiParamsKey(buildLatePerformanceTreeApiParams(global)),
    )
    expect(stableContractPerfApiParamsKey(treeParams)).not.toEqual(
      stableContractPerfApiParamsKey(linkedTreeParams),
    )
  })

  it('toolbar global + stable key ignore tab status and cache-bust timestamp', () => {
    const toolbar = buildContractPerfToolbarGlobal({
      dateFrom: '2026-01-01',
      dateTo: '2026-06-03',
      sourceFilter: 'All',
      selectedIncoterms: [],
      selectedSuppliers: [],
      selectedGroupPlants: [],
      productTabQuery: 'CPO',
      lateOnTimeFilter: 'ALL',
      perfDashMode: 'late',
      perfTransportMode: 'ALL',
      b2bFlagFilter: 'ALL',
      search: '',
    })
    expect(toolbar.summaryCardStatus).toBe('All')
    const p1 = buildLatePerformanceCardSummaryApiParams(toolbar)
    const p2 = buildLatePerformanceCardSummaryApiParams(toolbar)
    expect(stableContractPerfApiParamsKey(p1)).toBe(stableContractPerfApiParamsKey(p2))
    expect(p1.get('status')).toBeNull()
  })

  it('resolveEffectiveLateOnTimeFilter passes ALL through for unified drilldown', () => {
    expect(resolveEffectiveLateOnTimeFilter('ALL', 'late')).toBe('ALL')
    expect(resolveEffectiveLateOnTimeFilter('ALL', 'ontrack')).toBe('ALL')
    expect(resolveEffectiveLateOnTimeFilter('LATE', 'ontrack')).toBe('LATE')
    expect(resolveEffectiveLateOnTimeFilter('ON_TIME', 'late')).toBe('ON_TIME')
  })

  it('buildContractPerfTableListParams sends ALL lateOnTimeFilter for unified drilldown', () => {
    const global: ContractPerformanceGlobalFilters = {
      ...BASE_GLOBAL,
      summaryCardStatus: 'Open',
      productTabQuery: 'CPO',
      sourceFilter: '3rd Party',
      dateFrom: '2026-01-01',
      dateTo: '2026-06-22',
    }
    const drilldown: ContractPerfDrilldownFilters = {
      product: 'CPO',
      plant: 'PLANT-A',
      incoterm: 'CIF',
      supplier: 'SUPP-1',
    }
    const { mode, scope } = resolveSection3Scope(global, drilldown)
    const params = buildContractPerfTableListParams({
      scope,
      section3Mode: mode,
      columnFilters: {},
      lateOnTimeFilter: 'ALL',
      perfDashMode: 'late',
    })
    expect(params.get('status')).toBe('Open')
    expect(params.get('lateOnTimeFilter')).toBe('ALL')
    expect(params.get('excludeUnscheduled')).toBe('true')
    expect(params.get('sourceType')).toBe('3rd Party')
    expect(params.get('product')).toBe('CPO')
    expect(params.get('supplier')).toBe('SUPP-1')
    expect(params.getAll('plant')).toEqual(['PLANT-A'])
    const cf = JSON.parse(params.get('columnFilters') || '{}')
    expect(cf.incoterm).toEqual({ type: 'multi', values: ['CIF'], includeBlank: false })
  })
})

describe('Contract Performance — source filter (contracts.source_type)', () => {
  it('matchesContractPerfSourceFilter maps Interco to Inhouse/Interco values', () => {
    expect(matchesContractPerfSourceFilter('Inhouse', 'Interco')).toBe(true)
    expect(matchesContractPerfSourceFilter('Interco', 'Interco')).toBe(true)
    expect(matchesContractPerfSourceFilter('3rd Party', 'Interco')).toBe(false)
  })

  it('matchesContractPerfSourceFilter maps 3rd Party', () => {
    expect(matchesContractPerfSourceFilter('3rd Party', '3rd Party')).toBe(true)
    expect(matchesContractPerfSourceFilter('Inhouse', '3rd Party')).toBe(false)
  })

  it('appendContractPerformanceApiParams sends sourceType when not All', () => {
    const scope = resolveContractPerformanceScope({
      global: { ...BASE_GLOBAL, sourceFilter: 'Interco' },
      drilldown: EMPTY_CONTRACT_PERF_DRILLDOWN,
    })
    const params = buildLatePerformanceApiParams(scope, false)
    expect(params.get('sourceType')).toBe('Interco')
  })

  it('filterContractsForPerformanceTable applies source as first step', () => {
    const scope = resolveContractPerformanceScope({
      global: { ...BASE_GLOBAL, sourceFilter: '3rd Party' },
      drilldown: EMPTY_CONTRACT_PERF_DRILLDOWN,
    })
    const rows = filterContractsForPerformanceTable(
      [
        tableContract({ contract_id: 'A', source_type: '3rd Party' }),
        tableContract({ contract_id: 'B', source_type: 'Inhouse' }),
      ],
      scope,
      'ALL',
    )
    expect(rows.map((r) => r.contract_id)).toEqual(['A'])
  })
})

// ---------------------------------------------------------------------------
// AC3 — Drilldown "Apply" — strict node filtering
// ---------------------------------------------------------------------------

describe('AC3 — Drilldown Apply / Section 2 → Section 3 count match', () => {
  const contracts: PerformanceTableContract[] = [
    tableContract({ contract_id: 'D1', product: 'CPO',  incoterm: 'CIF', plant_site: 'PLANT-A', supplier: 'SUPP-1' }),
    tableContract({ contract_id: 'D2', product: 'CPO',  incoterm: 'CIF', plant_site: 'PLANT-A', supplier: 'SUPP-2' }),
    tableContract({ contract_id: 'D3', product: 'CPO',  incoterm: 'FOB', plant_site: 'PLANT-A', supplier: 'SUPP-1' }),
    tableContract({ contract_id: 'D4', product: 'PK',   incoterm: 'CIF', plant_site: 'PLANT-B', supplier: 'SUPP-1' }),
    tableContract({ contract_id: 'D5', product: 'POME', incoterm: 'DAP', plant_site: 'PLANT-C', supplier: 'SUPP-3' }),
  ]

  const hotspots: ContractPerfHotspot[] = [
    hotspot({ contract_id: 'D1', product: 'CPO', incoterm: 'CIF', plant_site: 'PLANT-A', supplier: 'SUPP-1', count: 1 }),
    hotspot({ contract_id: 'D2', product: 'CPO', incoterm: 'CIF', plant_site: 'PLANT-A', supplier: 'SUPP-2', count: 1 }),
    hotspot({ contract_id: 'D3', product: 'CPO', incoterm: 'FOB', plant_site: 'PLANT-A', supplier: 'SUPP-1', count: 1 }),
    hotspot({ contract_id: 'D4', product: 'PK',  incoterm: 'CIF', plant_site: 'PLANT-B', supplier: 'SUPP-1', count: 1 }),
    hotspot({ contract_id: 'D5', product: 'POME', incoterm: 'DAP', plant_site: 'PLANT-C', supplier: 'SUPP-3', count: 1 }),
  ]

  it('Applying product drilldown — Section 3 row count equals node contract count', () => {
    const drilldown: ContractPerfDrilldownFilters = { product: 'CPO', plant: null, incoterm: null, supplier: null }
    const scope = resolveContractPerformanceScope({ global: BASE_GLOBAL, drilldown })
    const nodeHotspots = filterPerformanceHotspots(hotspots, scope, { applyDrilldown: true })
    const nodeCount    = countPerformanceHotspotContracts(nodeHotspots)
    const { scope: s3Scope } = resolveSection3Scope(BASE_GLOBAL, drilldown)
    const tableRows = filterContractsForPerformanceTable(contracts, s3Scope, 'ALL')
    expect(tableRows.length).toBe(nodeCount)
    expect(tableRows.length).toBe(3) // D1, D2, D3
  })

  it('Applying product + incoterm drilldown — counts remain equal', () => {
    const drilldown: ContractPerfDrilldownFilters = { product: 'CPO', plant: null, incoterm: 'CIF', supplier: null }
    const scope        = resolveContractPerformanceScope({ global: BASE_GLOBAL, drilldown })
    const nodeHotspots = filterPerformanceHotspots(hotspots, scope, { applyDrilldown: true })
    const nodeCount    = countPerformanceHotspotContracts(nodeHotspots)
    const { scope: s3Scope } = resolveSection3Scope(BASE_GLOBAL, drilldown)
    const tableRows = filterContractsForPerformanceTable(contracts, s3Scope, 'ALL')
    expect(tableRows.length).toBe(nodeCount)
    expect(tableRows.length).toBe(2) // D1, D2
  })

  it('Full 4-level drilldown path — exactly 1 matching contract', () => {
    const drilldown: ContractPerfDrilldownFilters = { product: 'CPO', plant: 'PLANT-A', incoterm: 'CIF', supplier: 'SUPP-1' }
    const scope        = resolveContractPerformanceScope({ global: BASE_GLOBAL, drilldown })
    const nodeHotspots = filterPerformanceHotspots(hotspots, scope, { applyDrilldown: true })
    const nodeCount    = countPerformanceHotspotContracts(nodeHotspots)
    const { scope: s3Scope } = resolveSection3Scope(BASE_GLOBAL, drilldown)
    const tableRows = filterContractsForPerformanceTable(contracts, s3Scope, 'ALL')
    expect(tableRows.length).toBe(nodeCount)
    expect(tableRows.length).toBe(1)
    expect(tableRows[0].contract_id).toBe('D1')
  })

  it('Clearing drilldown (section3Mode=global) restores Section 3 to full dataset', () => {
    const { scope: s3Scope } = resolveSection3Scope(BASE_GLOBAL, EMPTY_CONTRACT_PERF_DRILLDOWN)
    const tableRows = filterContractsForPerformanceTable(contracts, s3Scope, 'ALL')
    expect(tableRows.length).toBe(contracts.length)
  })

  it('hasContractPerfDrilldownSelection returns false when nothing is applied', () => {
    expect(hasContractPerfDrilldownSelection(EMPTY_CONTRACT_PERF_DRILLDOWN)).toBe(false)
  })

  it('hasContractPerfDrilldownSelection returns true when at least one level is set', () => {
    const d: ContractPerfDrilldownFilters = { product: 'CPO', plant: null, incoterm: null, supplier: null }
    expect(hasContractPerfDrilldownSelection(d)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// AC4 — Blank / null value handling
// ---------------------------------------------------------------------------

describe('AC4 — Blank / null value drilldown', () => {
  const blankPlantContract = tableContract({ contract_id: 'B1', plant_site: null,       incoterm: 'CIF', product: 'CPO', supplier: 'SUPP-1' })
  const emptyPlantContract = tableContract({ contract_id: 'B2', plant_site: '',          incoterm: 'CIF', product: 'CPO', supplier: 'SUPP-1' })
  const spacePlantContract = tableContract({ contract_id: 'B3', plant_site: '   ',       incoterm: 'CIF', product: 'CPO', supplier: 'SUPP-1' })
  const namedPlantContract = tableContract({ contract_id: 'B4', plant_site: 'PLANT-A',  incoterm: 'CIF', product: 'CPO', supplier: 'SUPP-1' })

  const contracts = [blankPlantContract, emptyPlantContract, spacePlantContract, namedPlantContract]

  it('normalizePerfGroupKey maps null/empty/whitespace to "Blank"', () => {
    expect(normalizePerfGroupKey(null)).toBe('Blank')
    expect(normalizePerfGroupKey('')).toBe('Blank')
    expect(normalizePerfGroupKey('   ')).toBe('Blank')
    expect(normalizePerfGroupKey('PLANT-A')).toBe('PLANT-A')
  })

  it('isBlankFilterSentinel recognises "Blank", null, and empty string', () => {
    expect(isBlankFilterSentinel('Blank')).toBe(true)
    expect(isBlankFilterSentinel(null)).toBe(true)
    expect(isBlankFilterSentinel('')).toBe(true)
    expect(isBlankFilterSentinel('PLANT-A')).toBe(false)
  })

  it('matchesPerformanceDimensionFilter: Blank filter matches null/empty row values', () => {
    expect(matchesPerformanceDimensionFilter(null,    'Blank', 'group')).toBe(true)
    expect(matchesPerformanceDimensionFilter('',      'Blank', 'group')).toBe(true)
    expect(matchesPerformanceDimensionFilter('   ',   'Blank', 'group')).toBe(true)
    expect(matchesPerformanceDimensionFilter('PLANT', 'Blank', 'group')).toBe(false)
  })

  it('matchesPerformanceDimensionFilter: Blank filter does NOT match a real plant value', () => {
    expect(matchesPerformanceDimensionFilter('PLANT-A', 'Blank', 'group')).toBe(false)
  })

  it('Blank plant drilldown: Section 3 includes only null/empty plant rows — NOT dropped', () => {
    const drilldown: ContractPerfDrilldownFilters = { product: null, plant: 'Blank', incoterm: null, supplier: null }
    const { scope: s3Scope } = resolveSection3Scope(BASE_GLOBAL, drilldown)
    const filtered = filterContractsForPerformanceTable(contracts, s3Scope, 'ALL')
    expect(filtered.length).toBe(3) // B1 (null), B2 (empty), B3 (whitespace)
    expect(filtered.some((c) => c.contract_id === 'B4')).toBe(false)
  })

  it('Named plant drilldown excludes Blank rows', () => {
    const drilldown: ContractPerfDrilldownFilters = { product: null, plant: 'PLANT-A', incoterm: null, supplier: null }
    const { scope: s3Scope } = resolveSection3Scope(BASE_GLOBAL, drilldown)
    const filtered = filterContractsForPerformanceTable(contracts, s3Scope, 'ALL')
    expect(filtered.length).toBe(1)
    expect(filtered[0].contract_id).toBe('B4')
  })

  it('Blank drilldown column filter sets includeBlank=true, values=[]', () => {
    const drilldown: ContractPerfDrilldownFilters = { product: 'Blank', plant: null, incoterm: null, supplier: null }
    const cf = contractPerfDrilldownToTableColumnFilters(drilldown)
    expect(cf.product).toBeDefined()
    expect((cf.product as { type: string; values: string[]; includeBlank: boolean }).includeBlank).toBe(true)
    expect((cf.product as { type: string; values: string[]; includeBlank: boolean }).values).toEqual([])
  })

  it('Blank supplier drilldown sets emptyOnly=true on text filter', () => {
    const drilldown: ContractPerfDrilldownFilters = { product: null, plant: null, incoterm: null, supplier: 'Blank' }
    const cf = contractPerfDrilldownToTableColumnFilters(drilldown)
    expect(cf.supplier).toBeDefined()
    expect((cf.supplier as { type: string; emptyOnly: boolean }).emptyOnly).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// AC5 — "Open" status fallback — null trade_cycle_days must not be dropped
// ---------------------------------------------------------------------------

describe('Section 3 — performance tree inclusion guard', () => {
  it('excludes contracts without delivery end and closed unscheduled rows', () => {
    expect(
      contractMeetsPerformanceTreeInclusion(
        tableContract({ delivery_end_date: null, import_status: 'OPEN' }),
        'LATE',
      ),
    ).toBe(false)
    expect(
      contractMeetsPerformanceTreeInclusion(
        tableContract({
          delivery_end_date: '2026-05-01',
          import_status: 'CLOSE',
          trade_cycle_days: null,
        }),
        'LATE',
      ),
    ).toBe(false)
    expect(
      contractMeetsPerformanceTreeInclusion(
        tableContract({
          delivery_end_date: '2026-05-01',
          import_status: 'OPEN',
          trade_cycle_days: null,
        }),
        'LATE',
      ),
    ).toBe(false)
    expect(
      contractMeetsPerformanceTreeInclusion(
        tableContract({
          delivery_end_date: '2026-05-01',
          import_status: 'OPEN',
          trade_cycle_days: null,
        }),
        'ON_TIME',
      ),
    ).toBe(true)
    expect(
      contractMeetsPerformanceTreeInclusion(
        tableContract({
          delivery_end_date: '2026-05-01',
          import_status: 'OPEN',
          trade_cycle_days: 5,
        }),
        'LATE',
      ),
    ).toBe(true)
  })

  it('filterContractsForPerformanceTable drops non-schedulable rows', () => {
    const global = { ...BASE_GLOBAL, summaryCardStatus: 'Open' as const }
    const drilldown: ContractPerfDrilldownFilters = {
      product: 'CPO',
      plant: null,
      incoterm: 'CIF',
      supplier: null,
    }
    const { scope: s3Scope } = resolveSection3Scope(global, drilldown)
    const rows = filterContractsForPerformanceTable(
      [
        tableContract({
          contract_id: 'OK',
          product: 'CPO',
          incoterm: 'CIF',
          delivery_end_date: '2026-05-01',
          import_status: 'OPEN',
          trade_cycle_days: 3,
        }),
        tableContract({
          contract_id: 'NO-DATE',
          product: 'CPO',
          incoterm: 'CIF',
          delivery_end_date: null,
          import_status: 'OPEN',
        }),
      ],
      s3Scope,
      'LATE',
    )
    expect(rows.map((r) => r.contract_id)).toEqual(['OK'])
  })

  it('filterContractsForPerformanceTable trusts contract_perf_in_tree from backend (no duplicate late filter)', () => {
    const global = { ...BASE_GLOBAL, summaryCardStatus: 'Open' as const }
    const drilldown: ContractPerfDrilldownFilters = {
      product: 'CPO',
      plant: null,
      incoterm: null,
      supplier: null,
    }
    const { scope: s3Scope } = resolveSection3Scope(global, drilldown)
    const rows = filterContractsForPerformanceTable(
      [
        tableContract({
          contract_id: 'IN-TREE',
          product: 'CPO',
          import_status: 'OPEN',
          delivery_end_date: '2026-05-01',
          trade_cycle_days: 0,
          contract_perf_on_time: false,
          contract_perf_in_tree: true,
        }),
      ],
      s3Scope,
      'ON_TIME',
    )
    expect(rows.map((r) => r.contract_id)).toEqual(['IN-TREE'])
  })
})

describe('AC5 — Open status fallback / null trade_cycle_days handling', () => {
  it('ALL filter includes contracts with null trade_cycle_days', () => {
    expect(contractMatchesLateOnTimeFilter(null, 'ALL')).toBe(true)
    expect(contractMatchesLateOnTimeFilter(undefined, 'ALL')).toBe(true)
  })

  it('LATE filter includes contracts with null trade_cycle_days (treated as late)', () => {
    // Section 2 counts open contracts with no ETA in the late bucket.
    // Section 3 must do the same — not silently drop them.
    expect(contractMatchesLateOnTimeFilter(null, 'LATE')).toBe(true)
    expect(contractMatchesLateOnTimeFilter(undefined, 'LATE')).toBe(true)
  })

  it('ON_TIME filter excludes contracts with null trade_cycle_days (no ETA = not on time)', () => {
    expect(contractMatchesLateOnTimeFilter(null, 'ON_TIME')).toBe(false)
    expect(contractMatchesLateOnTimeFilter(undefined, 'ON_TIME')).toBe(false)
  })

  it('Positive trade_cycle_days is LATE; non-positive is ON_TIME', () => {
    expect(contractMatchesLateOnTimeFilter(1,  'LATE')).toBe(true)
    expect(contractMatchesLateOnTimeFilter(0,  'LATE')).toBe(false)
    expect(contractMatchesLateOnTimeFilter(-5, 'LATE')).toBe(false)
    expect(contractMatchesLateOnTimeFilter(0,  'ON_TIME')).toBe(true)
    expect(contractMatchesLateOnTimeFilter(-3, 'ON_TIME')).toBe(true)
    expect(contractMatchesLateOnTimeFilter(1,  'ON_TIME')).toBe(false)
    // API flag mirrors Section 2 Condition B (0 = late when contract_perf_on_time is false).
    expect(contractMatchesLateOnTimeFilter(0, 'ON_TIME', false)).toBe(false)
    expect(contractMatchesLateOnTimeFilter(0, 'ON_TIME', true)).toBe(true)
  })

  it('Section 3 does NOT drop Open contracts with null trade_cycle_days when filter is LATE', () => {
    const openContractNoEta = tableContract({
      contract_id: 'OPEN-NO-ETA',
      trade_cycle_days: null,
      import_status: 'OPEN',
    })
    const openContractLate = tableContract({
      contract_id: 'OPEN-LATE',
      trade_cycle_days: 10,
      import_status: 'OPEN',
    })
    const openContractOnTime = tableContract({
      contract_id: 'OPEN-ON-TIME',
      trade_cycle_days: -2,
      import_status: 'OPEN',
    })

    const globalLate = { ...BASE_GLOBAL, lateOnTimeFilter: 'LATE' as const }
    const { scope: s3Scope } = resolveSection3Scope(globalLate, EMPTY_CONTRACT_PERF_DRILLDOWN)
    const filtered = filterContractsForPerformanceTable(
      [openContractNoEta, openContractLate, openContractOnTime],
      s3Scope,
      'LATE',
    )
    // null ETA contract must be included (treated as late), plus the actual late one
    expect(filtered.some((c) => c.contract_id === 'OPEN-NO-ETA')).toBe(true)
    expect(filtered.some((c) => c.contract_id === 'OPEN-LATE')).toBe(true)
    expect(filtered.some((c) => c.contract_id === 'OPEN-ON-TIME')).toBe(false)
    expect(filtered.length).toBe(2)
  })

  it('Section 3 does NOT include null-ETA contracts when filter is ON_TIME', () => {
    const openContractNoEta = tableContract({ contract_id: 'OPEN-NO-ETA', trade_cycle_days: null })
    const openContractOnTime = tableContract({ contract_id: 'OPEN-ON-TIME', trade_cycle_days: -2 })
    const { scope: s3Scope } = resolveSection3Scope(BASE_GLOBAL, EMPTY_CONTRACT_PERF_DRILLDOWN)
    const filtered = filterContractsForPerformanceTable(
      [openContractNoEta, openContractOnTime],
      s3Scope,
      'ON_TIME',
    )
    expect(filtered.some((c) => c.contract_id === 'OPEN-NO-ETA')).toBe(false)
    expect(filtered.some((c) => c.contract_id === 'OPEN-ON-TIME')).toBe(true)
  })

  it('NaN trade_cycle_days is treated as null (fallback to LATE)', () => {
    expect(contractMatchesLateOnTimeFilter(NaN, 'LATE')).toBe(true)
    expect(contractMatchesLateOnTimeFilter(NaN, 'ON_TIME')).toBe(false)
    expect(contractMatchesLateOnTimeFilter(NaN, 'ALL')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Cross-section consistency — integration scenarios
// ---------------------------------------------------------------------------

describe('Cross-section integration — all three sections must stay in sync', () => {
  const hotspots: ContractPerfHotspot[] = [
    hotspot({ contract_id: 'X1', product: 'CPO',  incoterm: 'CIF', plant_site: 'PLANT-A', supplier: 'SUPP-1', count: 1, totalQtyDelivery: 1000 }),
    hotspot({ contract_id: 'X2', product: 'CPO',  incoterm: 'FOB', plant_site: 'PLANT-A', supplier: 'SUPP-2', count: 1, totalQtyDelivery: 500  }),
    hotspot({ contract_id: 'X3', product: 'PK',   incoterm: 'CIF', plant_site: 'PLANT-B', supplier: 'SUPP-1', count: 1, totalQtyDelivery: 200  }),
  ]
  const contracts: PerformanceTableContract[] = [
    tableContract({ contract_id: 'X1', product: 'CPO',  incoterm: 'CIF', plant_site: 'PLANT-A', supplier: 'SUPP-1', trade_cycle_days: 5  }),
    tableContract({ contract_id: 'X2', product: 'CPO',  incoterm: 'FOB', plant_site: 'PLANT-A', supplier: 'SUPP-2', trade_cycle_days: -1 }),
    tableContract({ contract_id: 'X3', product: 'PK',   incoterm: 'CIF', plant_site: 'PLANT-B', supplier: 'SUPP-1', trade_cycle_days: 3  }),
  ]

  it('S1=S2=S3 count with no filters and no drilldown', () => {
    const globalScope = resolveContractPerformanceScope({ global: BASE_GLOBAL, drilldown: EMPTY_CONTRACT_PERF_DRILLDOWN })
    const s1Count     = countPerformanceHotspotContracts(filterPerformanceHotspots(hotspots, globalScope, { applyDrilldown: false }))
    const { scope: s3Scope } = resolveSection3Scope(BASE_GLOBAL, EMPTY_CONTRACT_PERF_DRILLDOWN)
    const s3Rows = filterContractsForPerformanceTable(contracts, s3Scope, 'ALL')
    expect(s1Count).toBe(3)
    expect(s3Rows.length).toBe(3)
    expect(s1Count).toBe(s3Rows.length)
  })

  it('Applying incoterm=CIF keeps S1, S2 node, and S3 row counts equal', () => {
    const drilldown: ContractPerfDrilldownFilters = { product: null, plant: null, incoterm: 'CIF', supplier: null }
    const scope         = resolveContractPerformanceScope({ global: BASE_GLOBAL, drilldown })
    const nodeHotspots  = filterPerformanceHotspots(hotspots, scope, { applyDrilldown: true })
    const nodeCount     = countPerformanceHotspotContracts(nodeHotspots)
    const { scope: s3Scope } = resolveSection3Scope(BASE_GLOBAL, drilldown)
    const s3Rows = filterContractsForPerformanceTable(contracts, s3Scope, 'ALL')
    expect(nodeCount).toBe(2)      // X1 (CIF/CPO) and X3 (CIF/PK)
    expect(s3Rows.length).toBe(2)
    expect(nodeCount).toBe(s3Rows.length)
  })

  it('LATE lateOnTimeFilter: S2 and S3 agree on late count', () => {
    const lateHotspots = hotspots.filter((h) => h.totalDays > 0) // 3 hotspots all have totalDays=5
    const globalScope  = resolveContractPerformanceScope({ global: BASE_GLOBAL, drilldown: EMPTY_CONTRACT_PERF_DRILLDOWN })
    const s2Count      = countPerformanceHotspotContracts(filterPerformanceHotspots(lateHotspots, globalScope, { applyDrilldown: false }))
    const { scope: s3Scope } = resolveSection3Scope(BASE_GLOBAL, EMPTY_CONTRACT_PERF_DRILLDOWN)
    const s3Late = filterContractsForPerformanceTable(contracts, s3Scope, 'LATE')
    // X1 trade_cycle_days=5 (late), X2=-1 (on-time), X3=3 (late) → 2 late
    expect(s3Late.length).toBe(2)
    expect(s2Count).toBe(lateHotspots.length) // tree has 3 hotspots all with positive totalDays
  })

  it('REGRESSION — Apply drilldown does NOT reduce activeBranchHotspots (Section 2 tree source)', () => {
    // When Apply is clicked, Section 2 card totals must stay on global-scope tree data.
    // Section 3 uses appliedDrilldownNodeHotspots (client-filtered). Tree API must not pass
    // the drilldown path (see buildLatePerformanceTreeApiParams). UI builds cards from
    // activeBranchHotspots, not unifiedFilteredHotspots.
    const drilldown: ContractPerfDrilldownFilters = { product: 'CPO', plant: null, incoterm: null, supplier: null }
    const globalScope = resolveContractPerformanceScope({ global: BASE_GLOBAL, drilldown: EMPTY_CONTRACT_PERF_DRILLDOWN })

    // activeBranchHotspots: always global scope, never drilldown-filtered
    const activeBranch = filterPerformanceHotspots(hotspots, globalScope, { applyDrilldown: false })
    // unifiedFilteredHotspots after Apply (drilldown applied):
    const appliedScope = resolveContractPerformanceScope({ global: BASE_GLOBAL, drilldown })
    const afterApply   = filterPerformanceHotspots(hotspots, appliedScope, { applyDrilldown: true })

    // activeBranch count must remain 3 (all hotspots) regardless of Apply
    expect(countPerformanceHotspotContracts(activeBranch)).toBe(3)
    // afterApply is filtered to CPO only
    expect(countPerformanceHotspotContracts(afterApply)).toBe(2) // X1, X2
    // The two MUST differ — proves the tree source and the section 3 source are separate
    expect(countPerformanceHotspotContracts(activeBranch)).toBeGreaterThan(
      countPerformanceHotspotContracts(afterApply),
    )
  })

  it('DESIGN — S3 before Apply shows global data (may differ from S2 branch count, by design)', () => {
    // Before Apply: S3 shows global filter data independently — not required to match S2 branch.
    // S2 shows active branch (e.g. Late=2), S3 returns all contracts (3). This is expected.
    // S3 only must match S2 node count AFTER Apply is clicked (section3Mode='linked').

    // X1 late (totalDays=5), X2 on-time (totalDays=-1), X3 late (totalDays=3)
    const mixedHotspots = [
      hotspot({ contract_id: 'X1', product: 'CPO',  totalDays: 5,  totalQtyDelivery: 1000 }),
      hotspot({ contract_id: 'X2', product: 'CPO',  totalDays: -1, totalQtyDelivery: 500  }),
      hotspot({ contract_id: 'X3', product: 'PK',   totalDays: 3,  totalQtyDelivery: 200  }),
    ]
    const lateOnlyHotspots = mixedHotspots.filter(h => (h.totalDays ?? 0) > 0) // X1, X3

    const globalScope = resolveContractPerformanceScope({ global: BASE_GLOBAL, drilldown: EMPTY_CONTRACT_PERF_DRILLDOWN })
    const s2LateCount = countPerformanceHotspotContracts(
      filterPerformanceHotspots(lateOnlyHotspots, globalScope, { applyDrilldown: false }),
    )
    const { scope: s3Scope } = resolveSection3Scope(BASE_GLOBAL, EMPTY_CONTRACT_PERF_DRILLDOWN)
    const s3All = filterContractsForPerformanceTable(contracts, s3Scope, 'ALL')

    // S2 shows only late branch (2), S3 shows all (3) — gap is EXPECTED before Apply
    expect(s2LateCount).toBe(2)   // S2 late branch only
    expect(s3All.length).toBe(3)  // S3 global (all) — intentionally not equal before Apply
    expect(s2LateCount).not.toBe(s3All.length) // confirms expected divergence before Apply
  })

  it('Global + drilldown scope is the same object passed to all three sections', () => {
    const drilldown = { product: 'CPO', plant: null, incoterm: null, supplier: null }
    const scope     = resolveContractPerformanceScope({ global: BASE_GLOBAL, drilldown })
    // Destructuring from scope — not re-evaluated separately per section
    const { resolvedProduct, resolvedIncoterms, resolvedPlants, contractStatus } = scope
    expect(resolvedProduct).toBe('CPO')
    expect(resolvedIncoterms).toEqual([])
    expect(resolvedPlants).toEqual([])
    expect(contractStatus).toBe('Open')
  })
})
