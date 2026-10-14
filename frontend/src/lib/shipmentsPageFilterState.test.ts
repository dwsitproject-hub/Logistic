import {
  buildShipmentsGlobalScopeKey,
  buildShipmentsListQueryKey,
  normalizePipelineStageFilter,
  togglePipelineStageFilter,
} from './shipmentsPageFilterState'

describe('shipmentsPageFilterState', () => {
  const baseScope = {
    dateFrom: '2026-01-01',
    dateTo: '2026-06-25',
    searchTerm: ' vessel ',
    selectedIncoterms: ['CIF', 'FOB'],
    selectedProducts: ['PALM'],
    selectedGroupPlants: ['TP'],
    selectedDischargePorts: [] as string[],
    lateIndicatorFilter: 'ALL',
    charterTypeFilter: 'ALL',
    // Required on ShipmentsGlobalFilterScope; the fixture predated it, so every key this test
    // built carried `undefined` for it and the assertions never noticed.
    sourceTypeFilter: 'ALL',
    viewOption: 'all',
    viewFilterValue: '',
    columnFiltersJson: '{}',
    urlDelayed: false,
    urlSto: null,
    urlContract: null,
  }

  it('buildShipmentsGlobalScopeKey trims search and sorts multi-selects', () => {
    const key = buildShipmentsGlobalScopeKey(baseScope)
    expect(key).toContain('"q":"vessel"')
    expect(key).toContain('FOB')
    expect(key).toContain('CIF')
  })

  /*
   * The list refetches when this key changes. A Discharge Port left out of it would leave the table and the cards on the old rows while the box
   * reads "1 selected".
   */
  it('a Discharge Port pick changes the key, in any order, and no pick leaves it as the pick-less key', () => {
    const none = buildShipmentsGlobalScopeKey(baseScope)
    const bontang = buildShipmentsGlobalScopeKey({ ...baseScope, selectedDischargePorts: ['BONTANG'] })
    expect(bontang).not.toBe(none)
    expect(buildShipmentsGlobalScopeKey({ ...baseScope, selectedDischargePorts: ['DUMAI', 'BONTANG'] })).toBe(
      buildShipmentsGlobalScopeKey({ ...baseScope, selectedDischargePorts: ['BONTANG', 'DUMAI'] }),
    )
    expect(buildShipmentsGlobalScopeKey({ ...baseScope, selectedDischargePorts: [] })).toBe(none)
    expect(
      buildShipmentsListQueryKey({ ...baseScope, selectedDischargePorts: ['BONTANG'], pipelineStage: 'ALL', page: 1, sortKey: 'created_at', sortDir: 'desc' }),
    ).not.toBe(buildShipmentsListQueryKey({ ...baseScope, pipelineStage: 'ALL', page: 1, sortKey: 'created_at', sortDir: 'desc' }))
  })

  it('buildShipmentsListQueryKey layers pipeline stage and pagination', () => {
    const globalKey = buildShipmentsGlobalScopeKey(baseScope)
    const listKey = buildShipmentsListQueryKey({
      ...baseScope,
      pipelineStage: 'PLANNED',
      page: 2,
      sortKey: 'created_at',
      sortDir: 'desc',
    })
    expect(listKey.startsWith(globalKey)).toBe(true)
    expect(listKey).toContain('st:PLANNED')
    expect(listKey).toContain('p:2')
    expect(listKey).toContain('sk:created_at')
    expect(listKey).toContain('sd:desc')
  })

  it('togglePipelineStageFilter toggles active card modifier', () => {
    expect(togglePipelineStageFilter('ALL', 'SAILED')).toBe('SAILED')
    expect(togglePipelineStageFilter('SAILED', 'SAILED')).toBe('ALL')
  })

  it('normalizePipelineStageFilter maps empty to ALL', () => {
    expect(normalizePipelineStageFilter('')).toBe('ALL')
    expect(normalizePipelineStageFilter('planned')).toBe('PLANNED')
  })
})
