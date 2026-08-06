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
    lateIndicatorFilter: 'ALL',
    charterTypeFilter: 'ALL',
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
