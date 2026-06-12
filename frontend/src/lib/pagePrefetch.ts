import api from '@/lib/api'
import {
  buildCacheKey,
  prefetchNavigationRequests,
  type PrefetchRequest,
} from '@/lib/clientDataCache'
import {
  buildContractPerfToolbarGlobal,
  buildLatePerformanceCardSummaryApiParams,
} from '@/lib/contractPerformanceFilters'

export function ytdDateRange(): { dateFrom: string; dateTo: string } {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return { dateFrom: `${y}-01-01`, dateTo: `${y}-${m}-${day}` }
}

function prefetchFromUrl(url: string): PrefetchRequest {
  const cacheKey = buildCacheKey('GET', url)
  return {
    cacheKey,
    fetch: () => api.get(url).then((r) => r.data),
  }
}

function buildPagePrefetchRequests(href: string): PrefetchRequest[] {
  const { dateFrom, dateTo } = ytdDateRange()

  switch (href) {
    case '/trucking': {
      const listParams = new URLSearchParams({
        limit: '20',
        page: '1',
        sortKey: 'created_at',
        sortDir: 'desc',
        dateFrom,
        dateTo,
        includeSummary: 'false',
      })
      const listUrl = `/trucking?${listParams}`
      const summaryParams = new URLSearchParams(listParams)
      summaryParams.delete('status')
      summaryParams.set('summaryOnly', 'true')
      summaryParams.set('page', '1')
      summaryParams.set('limit', '1')
      const summaryUrl = `/trucking?${summaryParams}`
      return [prefetchFromUrl(listUrl), prefetchFromUrl(summaryUrl)]
    }
    case '/shipments': {
      const listParams = new URLSearchParams({
        limit: '20',
        page: '1',
        compact: 'true',
        dateFrom,
        dateTo,
        includeSummary: 'false',
        skipSapJoin: 'true',
      })
      const listUrl = `/shipments?${listParams}`
      const summaryParams = new URLSearchParams(listParams)
      summaryParams.delete('status')
      summaryParams.delete('etaLoading')
      summaryParams.delete('etaDischarge')
      summaryParams.set('summaryOnly', 'true')
      summaryParams.delete('includeSummary')
      summaryParams.delete('skipSapJoin')
      const summaryUrl = `/shipments?${summaryParams}`
      return [prefetchFromUrl(listUrl), prefetchFromUrl(summaryUrl)]
    }
    case '/contracts': {
      const params = new URLSearchParams({
        page: '1',
        limit: '20',
        sortKey: 'contract_date',
        sortDir: 'desc',
        dateFrom,
        dateTo,
      })
      return [prefetchFromUrl(`/contracts?${params}`)]
    }
    case '/contract-performance': {
      const toolbar = buildContractPerfToolbarGlobal({
        dateFrom,
        dateTo,
        sourceFilter: 'All',
        selectedIncoterms: [],
        selectedGroupPlants: [],
        productTabQuery: undefined,
        lateOnTimeFilter: 'ALL',
        perfDashMode: 'late',
        perfTransportMode: 'ALL',
        b2bFlagFilter: 'ALL',
        search: '',
      })
      const summaryParams = buildLatePerformanceCardSummaryApiParams(toolbar)
      return [prefetchFromUrl(`/contracts/late-performance/summary?${summaryParams}`)]
    }
    case '/oil-loss':
      return [prefetchFromUrl('/oil-loss')]
    case '/commercial-documents': {
      const ytd = new Date()
      const y = ytd.getFullYear()
      const m = String(ytd.getMonth() + 1).padStart(2, '0')
      const d = String(ytd.getDate()).padStart(2, '0')
      return [prefetchFromUrl(`/commercial-documents?dateFrom=${y}-01-01&dateTo=${y}-${m}-${d}&page=1&limit=50`)]
    }
    case '/shipping-performance':
      return [prefetchFromUrl('/shipments/performance?scope=ytd')]
    default:
      return []
  }
}

/** Hover prefetch for sidebar navigation — respects cache freshness and cooldown. */
export function prefetchNavigationPage(href: string): void {
  const requests = buildPagePrefetchRequests(href)
  if (requests.length === 0) return
  prefetchNavigationRequests(href, requests)
}
