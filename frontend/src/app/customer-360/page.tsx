'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import Layout from '@/components/Layout'

type Period = 'month' | 'year'

export default function Customer360Page() {
  const router = useRouter()
  const [groups, setGroups] = useState<any[]>([])
  const [islandTotals, setIslandTotals] = useState<any[]>([])
  const [provinceTotals, setProvinceTotals] = useState<any[]>([])
  const [suppliers, setSuppliers] = useState<any[]>([])
  const [period, setPeriod] = useState<Period>('month')

  useEffect(() => {
    if (!localStorage.getItem('user')) { router.push('/login'); return }
    ;(async () => {
      try {
        const [groupsRes, islandRes, provinceRes, suppliersRes] = await Promise.all([
          api.get('/supplier-groups?page=1&limit=500'),
          api.get('/suppliers/aggregates/by-island'),
          api.get('/suppliers/aggregates/by-province'),
          api.get('/suppliers?page=1&limit=5000'),
        ])
        setGroups(groupsRes.data.data.items || [])
        setIslandTotals(islandRes.data.data || [])
        setProvinceTotals(provinceRes.data.data || [])
        setSuppliers(suppliersRes.data.data.items || [])
      } catch {}
    })()
  }, [])

  const suffix = period === 'month' ? '_month' : '_year'
  const periodLabel = period === 'month' ? 'Per Month' : 'Per Year'

  const sorted = useMemo(() => {
    const items = groups.map(g => ({
      ...g,
      _total: Number(g[`cpo${suffix}`]||0) + Number(g[`pk${suffix}`]||0) + Number(g[`pome${suffix}`]||0) + Number(g[`shell${suffix}`]||0),
    }))
    return items.filter(g => g._total > 0).sort((a, b) => b._total - a._total).slice(0, 15)
  }, [groups, suffix])

  const sortedIslands = useMemo(() => {
    const items = islandTotals.map(g => ({
      ...g,
      _total: Number(g[`cpo${suffix}`]||0) + Number(g[`pk${suffix}`]||0) + Number(g[`pome${suffix}`]||0) + Number(g[`shell${suffix}`]||0),
    }))
    return items.filter(g => g._total > 0).sort((a, b) => b._total - a._total)
  }, [islandTotals, suffix])

  const supplierSuffix = period === 'month' ? '_est_month' : '_est_year'

  const sortedSuppliers = useMemo(() => {
    const items = suppliers.map(s => ({
      ...s,
      _total:
        Number(s[`cpo_prod${supplierSuffix}`]  || 0) +
        Number(s[`pk_prod${supplierSuffix}`]   || 0) +
        Number(s[`pome_prod${supplierSuffix}`] || 0) +
        Number(s[`shell_prod${supplierSuffix}`]|| 0),
    }))
    return items.filter(s => s._total > 0).sort((a, b) => b._total - a._total).slice(0, 15)
  }, [suppliers, supplierSuffix])

  const supplierCategories = [
    { key: `cpo_prod${supplierSuffix}`,   label: `CPO / ${periodLabel}`,   color: '#2563eb' },
    { key: `pk_prod${supplierSuffix}`,    label: `PK / ${periodLabel}`,    color: '#16a34a' },
    { key: `pome_prod${supplierSuffix}`,  label: `POME / ${periodLabel}`,  color: '#f59e0b' },
    { key: `shell_prod${supplierSuffix}`, label: `SHELL / ${periodLabel}`, color: '#ef4444' },
  ]

  const sortedProvinces = useMemo(() => {
    const items = provinceTotals.map(g => ({
      ...g,
      _total: Number(g[`cpo${suffix}`]||0) + Number(g[`pk${suffix}`]||0) + Number(g[`pome${suffix}`]||0) + Number(g[`shell${suffix}`]||0),
    }))
    return items.filter(g => g._total > 0).sort((a, b) => b._total - a._total)
  }, [provinceTotals, suffix])

  const categories = [
    { key: `cpo${suffix}`,   label: `CPO / ${periodLabel}`,   color: '#2563eb' },
    { key: `pk${suffix}`,    label: `PK / ${periodLabel}`,    color: '#16a34a' },
    { key: `pome${suffix}`,  label: `POME / ${periodLabel}`,  color: '#f59e0b' },
    { key: `shell${suffix}`, label: `SHELL / ${periodLabel}`, color: '#ef4444' },
  ]

  const toggleBtn = (
    <div className="flex rounded-lg border overflow-hidden text-sm shrink-0">
      <button
        onClick={() => setPeriod('month')}
        className={`px-4 py-1.5 transition-colors ${period === 'month' ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-50'}`}
      >
        Per Month
      </button>
      <button
        onClick={() => setPeriod('year')}
        className={`px-4 py-1.5 transition-colors ${period === 'year' ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-50'}`}
      >
        Per Year
      </button>
    </div>
  )

  return (
    <Layout>
      <div className="p-6 space-y-6">
        {/* Production by Supplier Group */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle>
                Production Estimates by Supplier Group ({sorted.length} groups)
              </CardTitle>
              {toggleBtn}
            </div>
          </CardHeader>
          <CardContent>
            {sorted.length === 0 ? (
              <div className="text-sm text-gray-500">No data</div>
            ) : (
              <div>
                <SupplierBarChart data={sorted} categories={categories} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Production by Supplier (Top 50) */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle>
                Production Estimates by Supplier — Top 50 ({sortedSuppliers.length} shown)
              </CardTitle>
              {toggleBtn}
            </div>
          </CardHeader>
          <CardContent>
            {sortedSuppliers.length === 0 ? (
              <div className="text-sm text-gray-500">No data</div>
            ) : (
              <div>
                <SupplierBarChart
                  data={sortedSuppliers}
                  labelField="mills"
                  categories={supplierCategories}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Production by Island */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle>Production Estimates by Island</CardTitle>
              {toggleBtn}
            </div>
          </CardHeader>
          <CardContent>
            {sortedIslands.length === 0 ? (
              <div className="text-sm text-gray-500">No data</div>
            ) : (
              <div>
                <SupplierBarChart
                  data={sortedIslands}
                  labelField="island"
                  categories={categories}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Production by Province */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle>Production Estimates by Province</CardTitle>
              {toggleBtn}
            </div>
          </CardHeader>
          <CardContent>
            {sortedProvinces.length === 0 ? (
              <div className="text-sm text-gray-500">No data</div>
            ) : (
              <div>
                <SupplierBarChart
                  data={sortedProvinces}
                  labelField="province"
                  categories={categories}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  )
}

function SupplierBarChart({
  data,
  categories,
  labelField = 'group_id',
}: {
  data: any[]
  categories: { key: string; label: string; color: string }[]
  labelField?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(800)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(entries => {
      setContainerWidth(entries[0].contentRect.width)
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const height = 420
  const labelHeight = 50
  const chartAreaHeight = height - labelHeight
  const gap = 6
  const barWidth = data.length > 0 ? Math.max(20, (containerWidth - gap * (data.length - 1)) / data.length) : 48

  const maxVal = Math.max(
    1,
    ...data.map(d => categories.reduce((sum, c) => sum + Number(d[c.key] || 0), 0))
  )

  return (
    <div ref={containerRef}>
      <div className="flex items-center gap-4 flex-wrap mb-4">
        {categories.map(c => (
          <div key={c.key} className="flex items-center gap-2 text-xs">
            <span style={{ backgroundColor: c.color }} className="inline-block w-3 h-3 rounded-sm shrink-0" />
            <span>{c.label}</span>
          </div>
        ))}
      </div>
      <svg width={containerWidth} height={height} className="overflow-visible">
        <line x1={0} y1={chartAreaHeight} x2={containerWidth} y2={chartAreaHeight} stroke="#e5e7eb" strokeWidth={1.5} />
        {data.map((d, gi) => {
          let yCursor = chartAreaHeight
          const x = gi * (barWidth + gap)
          const rawLabel = String(d[labelField] || '')
          const maxChars = Math.max(4, Math.floor(barWidth / 6))
          const label = rawLabel.length > maxChars ? rawLabel.substring(0, maxChars - 1) + '…' : rawLabel

          return (
            <g key={gi} transform={`translate(${x}, 0)`}>
              {categories.map(c => {
                const v = Number(d[c.key] || 0)
                const barH = Math.max(v > 0 ? 2 : 0, Math.round((v / maxVal) * (chartAreaHeight - 20)))
                const y = yCursor - barH
                yCursor = y
                return (
                  <g key={c.key}>
                    <rect x={0} y={y} width={barWidth} height={barH} fill={c.color} rx={2}>
                      <title>{c.label}: {v.toLocaleString('en-US', { maximumFractionDigits: 0 })}</title>
                    </rect>
                  </g>
                )
              })}
              <text x={barWidth / 2} y={chartAreaHeight + 14} textAnchor="middle" fontSize={Math.min(10, barWidth / 5)} className="fill-gray-600 pointer-events-none">
                {label}
              </text>
              <text x={barWidth / 2} y={chartAreaHeight + 26} textAnchor="middle" fontSize={Math.min(9, barWidth / 6)} className="fill-gray-400 pointer-events-none">
                #{gi + 1}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
