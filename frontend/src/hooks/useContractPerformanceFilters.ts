import { useMemo } from 'react'
import {
  ContractPerformanceGlobalFilters,
  ContractPerfDrilldownFilters,
  ContractPerfHotspot,
  ContractPerformanceScope,
  LatePerfApiTreeNode,
  PerformanceTableContract,
  Section3FilterMode,
  buildContractPerfTableFetchScope,
  buildLatePerformanceCardSummaryApiParams,
  buildLatePerformanceTreeApiParams,
  countPerformanceHotspotContracts,
  filterContractsForPerformanceTable,
  filterPerformanceHotspots,
  flattenLatePerfApiTreeToHotspots,
  resolveContractPerformanceScope,
  resolveEffectiveLateOnTimeFilter,
  resolveSection3Scope,
  sumHotspotQtyKg,
} from '@/lib/contractPerformanceFilters'

export type UseContractPerformanceFiltersInput = {
  global: ContractPerformanceGlobalFilters
  appliedDrilldown: ContractPerfDrilldownFilters
  onTrackTree: LatePerfApiTreeNode[]
  lateTree: LatePerfApiTreeNode[]
  unscheduledTree: LatePerfApiTreeNode[]
  /** Section 3 loaded rows (current page or full set for client guard). */
  tableContracts: PerformanceTableContract[]
  tableTotalFromApi: number
  columnFilters: Record<string, unknown>
}

export type ContractPerformancePipelineDebug = {
  section1Data: ContractPerfHotspot[]
  section2NodeData: ContractPerfHotspot[]
  section3TableData: PerformanceTableContract[]
  section1ContractCount: number
  section2NodeContractCount: number
  section3RowCount: number
  section3ApiTotal: number
  section1QtyKg: number
  section2OnTimeLateQtyKg: number
  /** On Time branch qty under global scope (never drilldown-filtered). */
  onTimeQtyKg: number
  /** Late branch qty under global scope (never drilldown-filtered). */
  lateQtyKg: number
  /** Unscheduled branch qty under global scope. */
  unscheduledQtyKg: number
}

export type UseContractPerformanceFiltersResult = {
  scope: ContractPerformanceScope
  section3Mode: Section3FilterMode
  section3Scope: ContractPerformanceScope
  /** Total unique contracts in the active On Time/Late drilldown tree (Section 2 header). */
  section2TreeContractCount: number
  /** Contracts matching the applied drilldown node (deepest applied path). */
  section2ActiveNodeContractCount: number
  /**
   * Unscheduled contracts in scope (no delivery end or Close without completion).
   * Included in All segment qty; kept for debug/reconciliation.
   */
  unscheduledNodeContractCount: number
  /** Global scope only — Section 1 reconciliation (On Time + Late + Unscheduled). */
  section1Hotspots: ContractPerfHotspot[]
  /** On Time branch under global scope — unified card merge source. */
  onTrackBranchHotspotsGlobal: ContractPerfHotspot[]
  /** Late branch under global scope — unified card merge source. */
  lateBranchHotspotsGlobal: ContractPerfHotspot[]
  /** Unscheduled branch under global scope — merged into All segment qty. */
  unscheduledBranchHotspotsGlobal: ContractPerfHotspot[]
  /** Active branch hotspots after global scope (before drilldown path). */
  activeBranchHotspots: ContractPerfHotspot[]
  /** Active branch after global + optional applied drilldown — Section 3 linked scope only. */
  unifiedFilteredHotspots: ContractPerfHotspot[]
  /** Rows matching the applied drilldown node — must equal Section 3 count. */
  appliedDrilldownNodeHotspots: ContractPerfHotspot[]
  tableFetchScope: ReturnType<typeof buildContractPerfTableFetchScope>
  summaryApiParams: URLSearchParams
  treeApiParams: URLSearchParams
  /** Client-filtered table rows aligned with Section 2 node. */
  alignedTableContracts: PerformanceTableContract[]
  alignedTableTotal: number
  debug: ContractPerformancePipelineDebug
}

export function useContractPerformanceFilters(
  input: UseContractPerformanceFiltersInput,
): UseContractPerformanceFiltersResult {
  const {
    global,
    appliedDrilldown,
    onTrackTree,
    lateTree,
    unscheduledTree,
    tableContracts,
    tableTotalFromApi,
    columnFilters,
  } = input

  const { mode: section3Mode, scope: section3Scope } = useMemo(
    () => resolveSection3Scope(global, appliedDrilldown),
    [global, appliedDrilldown],
  )

  const scope = useMemo(
    () => resolveContractPerformanceScope({ global, drilldown: appliedDrilldown }),
    [global, appliedDrilldown],
  )

  const globalScopeNoDrilldown = useMemo(
    () =>
      resolveContractPerformanceScope({
        global,
        drilldown: { product: null, plant: null, incoterm: null, supplier: null },
      }),
    [global],
  )

  const onTrackHotspots = useMemo(
    () => flattenLatePerfApiTreeToHotspots(onTrackTree),
    [onTrackTree],
  )
  const lateHotspots = useMemo(() => flattenLatePerfApiTreeToHotspots(lateTree), [lateTree])
  const unscheduledHotspots = useMemo(
    () => flattenLatePerfApiTreeToHotspots(unscheduledTree),
    [unscheduledTree],
  )

  /** Section 1: On Time + Late + Unscheduled under global scope (no drilldown path). */
  const section1Hotspots = useMemo(() => {
    const combined = [...onTrackHotspots, ...lateHotspots, ...unscheduledHotspots]
    return filterPerformanceHotspots(combined, globalScopeNoDrilldown, { applyDrilldown: false })
  }, [onTrackHotspots, lateHotspots, unscheduledHotspots, globalScopeNoDrilldown])

  const schedulableHotspotsForBranch = useMemo(() => {
    if (global.lateOnTimeFilter === 'ON_TIME') return onTrackHotspots
    if (global.lateOnTimeFilter === 'LATE') return lateHotspots
    return [...onTrackHotspots, ...lateHotspots, ...unscheduledHotspots]
  }, [global.lateOnTimeFilter, onTrackHotspots, lateHotspots, unscheduledHotspots])

  const activeBranchHotspots = useMemo(() => {
    return filterPerformanceHotspots(schedulableHotspotsForBranch, globalScopeNoDrilldown, {
      applyDrilldown: false,
    })
  }, [schedulableHotspotsForBranch, globalScopeNoDrilldown])

  const onTrackBranchHotspotsGlobal = useMemo(
    () => filterPerformanceHotspots(onTrackHotspots, globalScopeNoDrilldown, { applyDrilldown: false }),
    [onTrackHotspots, globalScopeNoDrilldown],
  )

  const lateBranchHotspotsGlobal = useMemo(
    () => filterPerformanceHotspots(lateHotspots, globalScopeNoDrilldown, { applyDrilldown: false }),
    [lateHotspots, globalScopeNoDrilldown],
  )

  const unscheduledBranchHotspotsGlobal = useMemo(
    () => filterPerformanceHotspots(unscheduledHotspots, globalScopeNoDrilldown, { applyDrilldown: false }),
    [unscheduledHotspots, globalScopeNoDrilldown],
  )

  const unifiedFilteredHotspots = useMemo(() => {
    const treeScope = section3Mode === 'linked' ? scope : globalScopeNoDrilldown
    return filterPerformanceHotspots(schedulableHotspotsForBranch, treeScope, {
      applyDrilldown: section3Mode === 'linked',
    })
  }, [schedulableHotspotsForBranch, scope, globalScopeNoDrilldown, section3Mode])

  const appliedDrilldownNodeHotspots = useMemo(() => {
    if (section3Mode !== 'linked') return unifiedFilteredHotspots
    return filterPerformanceHotspots(unifiedFilteredHotspots, scope, { applyDrilldown: true })
  }, [unifiedFilteredHotspots, scope, section3Mode])

  const tableFetchScope = useMemo(
    () => buildContractPerfTableFetchScope({ columnFilters, scope: section3Scope }),
    [columnFilters, section3Scope],
  )

  /** Card totals API — toolbar globals only; stable when Open/Close tab toggles. */
  const summaryApiParams = useMemo(
    () => buildLatePerformanceCardSummaryApiParams(global),
    [
      global.dateFrom,
      global.dateTo,
      global.sourceFilter,
      global.selectedIncoterms,
      global.selectedGroupPlants,
      global.productTabQuery,
      global.perfTransportMode,
      global.b2bFlagFilter,
      global.search,
    ],
  )

  /** Section 2 tree fetch — never includes applied drilldown; card counts stay at global totals. */
  const treeApiParams = useMemo(
    () => buildLatePerformanceTreeApiParams(global),
    [
      global.dateFrom,
      global.dateTo,
      global.sourceFilter,
      global.selectedIncoterms,
      global.selectedGroupPlants,
      global.productTabQuery,
      global.summaryCardStatus,
      global.perfTransportMode,
      global.b2bFlagFilter,
      global.search,
    ],
  )

  const effectiveLateOnTimeFilter = useMemo(
    () => resolveEffectiveLateOnTimeFilter(global.lateOnTimeFilter, global.perfDashMode),
    [global.lateOnTimeFilter, global.perfDashMode],
  )

  const alignedTableContracts = useMemo(
    () =>
      filterContractsForPerformanceTable(tableContracts, section3Scope, effectiveLateOnTimeFilter),
    [tableContracts, section3Scope, effectiveLateOnTimeFilter],
  )

  const alignedTableTotal = useMemo(() => {
    // Linked mode: backend aligns schedulable + on-time/late with Section 2 tree.
    return tableTotalFromApi
  }, [tableTotalFromApi])

  const section2OnTimeLateQtyKg = useMemo(
    () => sumHotspotQtyKg(section1Hotspots),
    [section1Hotspots],
  )

  // Per-branch qty sums under global scope only — used for qty reconciliation debug panel.
  const onTimeQtyKg = useMemo(
    () =>
      sumHotspotQtyKg(
        filterPerformanceHotspots(onTrackHotspots, globalScopeNoDrilldown, { applyDrilldown: false }),
      ),
    [onTrackHotspots, globalScopeNoDrilldown],
  )
  const lateQtyKg = useMemo(
    () =>
      sumHotspotQtyKg(
        filterPerformanceHotspots(lateHotspots, globalScopeNoDrilldown, { applyDrilldown: false }),
      ),
    [lateHotspots, globalScopeNoDrilldown],
  )
  const unscheduledQtyKg = useMemo(
    () =>
      sumHotspotQtyKg(
        filterPerformanceHotspots(unscheduledHotspots, globalScopeNoDrilldown, { applyDrilldown: false }),
      ),
    [unscheduledHotspots, globalScopeNoDrilldown],
  )

  // Section 2 header total must NOT change when Apply is clicked — it always reflects
  // the full active branch under global scope, independent of any applied drilldown path.
  // The active branch (late or ontrack) is determined by lateOnTimeFilter / perfDashMode.
  // Section 3 shows global data independently until Apply is clicked.
  const section2TreeContractCount = useMemo(
    () => countPerformanceHotspotContracts(activeBranchHotspots),
    [activeBranchHotspots],
  )

  const section2ActiveNodeContractCount = useMemo(
    () => countPerformanceHotspotContracts(appliedDrilldownNodeHotspots),
    [appliedDrilldownNodeHotspots],
  )

  // Closed contracts with no completion date / no delivery end — in unscheduled tree; included in All segment.
  const unscheduledNodeContractCount = useMemo(() => {
    const filteredScope = section3Mode === 'linked' ? scope : globalScopeNoDrilldown
    const applyDD = section3Mode === 'linked'
    return countPerformanceHotspotContracts(
      filterPerformanceHotspots(unscheduledHotspots, filteredScope, { applyDrilldown: applyDD }),
    )
  }, [unscheduledHotspots, scope, globalScopeNoDrilldown, section3Mode])

  const debug = useMemo((): ContractPerformancePipelineDebug => {
    const section1Data = section1Hotspots
    const section2NodeData = appliedDrilldownNodeHotspots
    const section3TableData = alignedTableContracts
    return {
      section1Data,
      section2NodeData,
      section3TableData,
      section1ContractCount: countPerformanceHotspotContracts(section1Data),
      section2NodeContractCount: countPerformanceHotspotContracts(section2NodeData),
      section3RowCount: section3TableData.length,
      section3ApiTotal: tableTotalFromApi,
      section1QtyKg: sumHotspotQtyKg(section1Data),
      section2OnTimeLateQtyKg: section2OnTimeLateQtyKg,
      onTimeQtyKg,
      lateQtyKg,
      unscheduledQtyKg,
    }
  }, [
    section1Hotspots,
    appliedDrilldownNodeHotspots,
    alignedTableContracts,
    tableTotalFromApi,
    section2OnTimeLateQtyKg,
    onTimeQtyKg,
    lateQtyKg,
    unscheduledQtyKg,
  ])

  return {
    scope,
    section3Mode,
    section3Scope,
    section2TreeContractCount,
    section2ActiveNodeContractCount,
    unscheduledNodeContractCount,
    section1Hotspots,
    onTrackBranchHotspotsGlobal,
    lateBranchHotspotsGlobal,
    unscheduledBranchHotspotsGlobal,
    activeBranchHotspots,
    unifiedFilteredHotspots,
    appliedDrilldownNodeHotspots,
    tableFetchScope,
    summaryApiParams,
    treeApiParams,
    alignedTableContracts,
    alignedTableTotal,
    debug,
  }
}
