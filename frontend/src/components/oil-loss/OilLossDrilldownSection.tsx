'use client'

import { useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { OilLossSourceRow } from '@/lib/oilLossAllContractColumns'
import { formatOilLossMtFromKg } from '@/lib/oilLossFormat'
import {
  buildOilLossDrilldownTree,
  countUniqueOilLossContracts,
  displayOilLossGroupLabel,
  OIL_LOSS_DRILLDOWN_CATEGORIES,
  OIL_LOSS_DRILLDOWN_LEVEL_STYLES,
  oilLossDrilldownColumnSubtitle,
  sumOilLossKgFromRows,
  type OilLossDrilldownCategory,
  type OilLossDrilldownFilters,
  type OilLossDrilldownTreeNode,
} from '@/lib/oilLossDrilldown'

type OilLossDrilldownSectionProps = {
  rows: OilLossSourceRow[]
  filters: OilLossDrilldownFilters
  onFiltersChange: (filters: OilLossDrilldownFilters) => void
  onReset: () => void
  drilldownScopedRowCount: number
  loading?: boolean
  dataFetching?: boolean
}

function formatOilLossMtSuffix(kg: number): string {
  return `${formatOilLossMtFromKg(kg)} MT`
}

export default function OilLossDrilldownSection({
  rows,
  filters,
  onFiltersChange,
  onReset,
  drilldownScopedRowCount,
  loading = false,
  dataFetching = false,
}: OilLossDrilldownSectionProps) {
  const tree = useMemo(() => buildOilLossDrilldownTree(rows), [rows])
  const scopeContractCount = useMemo(() => countUniqueOilLossContracts(rows), [rows])
  const scopeTotalKg = useMemo(() => sumOilLossKgFromRows(rows), [rows])

  const productNode = tree.find((n) => n.key === filters.product)
  const plantNode = productNode?.children.find((n) => n.key === filters.plant)
  const incotermNode = plantNode?.children.find((n) => n.key === filters.incoterm)
  const transporterNode = incotermNode?.children.find((n) => n.key === filters.transporter)

  const applyClick = (next: Partial<OilLossDrilldownFilters>) => {
    onFiltersChange({
      product: 'product' in next ? (next.product ?? null) : filters.product,
      plant: 'plant' in next ? (next.plant ?? null) : filters.plant,
      incoterm: 'incoterm' in next ? (next.incoterm ?? null) : filters.incoterm,
      transporter: 'transporter' in next ? (next.transporter ?? null) : filters.transporter,
      supplier: 'supplier' in next ? (next.supplier ?? null) : filters.supplier,
    })
  }

  const showBlocking = loading && rows.length === 0
  const isRefreshing = dataFetching && rows.length > 0
  const denom = Math.abs(scopeTotalKg) > 0 ? Math.abs(scopeTotalKg) : 1

  const renderCard = (
    node: OilLossDrilldownTreeNode,
    level: OilLossDrilldownCategory,
    selected: boolean,
    onClick: () => void,
  ) => {
    const style = OIL_LOSS_DRILLDOWN_LEVEL_STYLES[level]
    const pct = Math.max(1, Math.round((Math.abs(node.totalOilLossKg) / denom) * 100))
    const itemClass = `w-full text-left rounded-lg border px-3 py-2 hover:bg-gray-50 focus:outline-none ${
      selected ? `bg-white border-2 ${style.selectedBorder}` : 'bg-white border-gray-200'
    }`

    return (
      <button key={node.key} type="button" className={itemClass} onClick={onClick}>
        <div className="text-sm font-semibold text-gray-900 truncate" title={displayOilLossGroupLabel(node.label)}>
          {displayOilLossGroupLabel(node.label)}
        </div>
        <div className="mt-1 h-1 rounded bg-gray-100 overflow-hidden">
          <div className={`h-full ${style.bar}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] leading-tight">
          <span className="text-gray-600 shrink-0">
            Contract:{' '}
            <span className="font-semibold text-gray-900 tabular-nums">
              {node.contractCount.toLocaleString('en-US')}
            </span>
          </span>
          <span className="font-semibold tabular-nums text-red-600 shrink-0">
            {formatOilLossMtSuffix(node.totalOilLossKg)}
          </span>
        </div>
      </button>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <span>Oil Loss Drilldown</span>
          {isRefreshing ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" aria-hidden />
          ) : null}
        </CardTitle>
        <div className="text-sm text-gray-600 mt-1">
          Navigate as a tree:{' '}
          <span className="font-medium">Product → Plant → Incoterm → Transporter → Supplier</span>. Click a card to
          filter the table below.
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        {showBlocking ? (
          <div className="text-sm text-gray-500">Loading drilldown…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-gray-500">No oil loss rows for the current filters.</div>
        ) : (
          <div
            className={`rounded-xl border bg-white p-4 transition-opacity duration-200 ${
              isRefreshing ? 'opacity-65' : 'opacity-100'
            }`}
          >
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <div>
                <div className="text-sm font-semibold text-gray-900">Drilldown</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  <span className="font-semibold text-gray-800 tabular-nums">
                    {scopeContractCount.toLocaleString('en-US')}
                  </span>{' '}
                  unique contracts (global scope)
                  <span className="text-gray-400 mx-1" aria-hidden>
                    ·
                  </span>
                  <span className="tabular-nums">{drilldownScopedRowCount.toLocaleString('en-US')}</span> rows in table
                  scope
                  <span className="text-gray-400 mx-1" aria-hidden>
                    ·
                  </span>
                  <span className="font-semibold text-slate-800 tabular-nums">{formatOilLossMtSuffix(scopeTotalKg)}</span>{' '}
                  total oil loss
                </div>
              </div>
              <button type="button" onClick={onReset} className="text-sm text-blue-700 hover:underline shrink-0">
                Reset selection
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
              {OIL_LOSS_DRILLDOWN_CATEGORIES.map(({ level, title }) => {
                const style = OIL_LOSS_DRILLDOWN_LEVEL_STYLES[level]
                const subtitle = oilLossDrilldownColumnSubtitle(level, filters)

                const body = (() => {
                  if (level === 'product') {
                    return (
                      <div className="space-y-2">
                        {tree.map((node) =>
                          renderCard(node, level, filters.product === node.key, () => {
                            applyClick({
                              product: node.key,
                              plant: null,
                              incoterm: null,
                              transporter: null,
                              supplier: null,
                            })
                          }),
                        )}
                      </div>
                    )
                  }
                  if (level === 'plant') {
                    if (!filters.product) {
                      return <div className="text-sm text-gray-500">Select a product to see plants.</div>
                    }
                    return (
                      <div className="space-y-2">
                        {(productNode?.children ?? []).map((node) =>
                          renderCard(node, level, filters.plant === node.key, () => {
                            applyClick({ plant: node.key, incoterm: null, transporter: null, supplier: null })
                          }),
                        )}
                      </div>
                    )
                  }
                  if (level === 'incoterm') {
                    if (!filters.plant) {
                      return <div className="text-sm text-gray-500">Select a plant to see incoterms.</div>
                    }
                    return (
                      <div className="space-y-2">
                        {(plantNode?.children ?? []).map((node) =>
                          renderCard(node, level, filters.incoterm === node.key, () => {
                            applyClick({ incoterm: node.key, transporter: null, supplier: null })
                          }),
                        )}
                      </div>
                    )
                  }
                  if (level === 'transporter') {
                    if (!filters.incoterm) {
                      return <div className="text-sm text-gray-500">Select an incoterm to see transporters.</div>
                    }
                    return (
                      <div className="space-y-2">
                        {(incotermNode?.children ?? []).map((node) =>
                          renderCard(node, level, filters.transporter === node.key, () => {
                            applyClick({ transporter: node.key, supplier: null })
                          }),
                        )}
                      </div>
                    )
                  }
                  if (!filters.transporter) {
                    return <div className="text-sm text-gray-500">Select a transporter to see suppliers.</div>
                  }
                  return (
                    <div className="space-y-2">
                      {(transporterNode?.children ?? []).map((node) =>
                        renderCard(node, level, filters.supplier === node.key, () => {
                          applyClick({ supplier: node.key })
                        }),
                      )}
                    </div>
                  )
                })()

                return (
                  <div key={level} className="space-y-2 min-w-0">
                    <div className={`rounded-lg border px-3 py-2 min-w-0 ${style.headerBg} ${style.border}`}>
                      <div className="text-sm font-semibold text-gray-900">{title}</div>
                      <div className="text-[11px] text-gray-500 truncate" title={subtitle}>
                        {subtitle}
                      </div>
                    </div>
                    <div className="space-y-2 max-h-[360px] overflow-auto pr-1">{body}</div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
