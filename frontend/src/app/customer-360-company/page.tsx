'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import Layout from '@/components/Layout'
import { Building2, MapPin, Gauge, X, Eye, Ship, Check } from 'lucide-react'

interface SupplierGroup {
  group_id: string
  parent_company: string | null
  group_type: string | null
  group_scale: string | null
  integrated_status: string | null
  jumlah_pks: number | null
  total_cap: number | null
  cpo_month: number | null
  pk_month: number | null
  pome_month: number | null
  shell_month: number | null
  cpo_year: number | null
  pk_year: number | null
  pome_year: number | null
  shell_year: number | null
  provinces: string | null
  islands: string | null
  latitude: number | null
  longitude: number | null
  land_bank: number | null
  loading_method: string | null
  estimated_loading_rate: number | null
  pic: string | null
  company_type: string | null
  annual_turnover: number | null
  credit_rating: string | null
  credit_limit: number | null
  other_assets: string | null
  total_voyages: number | null
  total_volume_shipped: number | null
  unique_vessels: number | null
  avg_lead_time_days: number | null
}

interface Mill {
  id: string
  mill_code: string | null
  mills: string | null
  province: string | null
  island: string | null
  cap: string | null
  rspo: string | null
  rspo_type: string | null
  ispo: string | null
  iscc: string | null
  ggl: string | null
}

export default function Customer360CompanyPage() {
  const router = useRouter()
  const [allGroups, setAllGroups] = useState<SupplierGroup[]>([])
  const [search, setSearch] = useState('')
  const [selectedGroup, setSelectedGroup] = useState<SupplierGroup | null>(null)
  const [childMills, setChildMills] = useState<Mill[]>([])
  const [showMillList, setShowMillList] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem('user')) { router.push('/login'); return }
    ;(async () => {
      try {
        const res = await api.get('/supplier-groups?page=1&limit=500')
        setAllGroups(res.data.data.items || [])
      } catch {}
    })()
  }, [])

  useEffect(() => {
    setChildMills([])
    if (!selectedGroup?.group_id) return
    ;(async () => {
      try {
        const res = await api.get(`/suppliers?search=${encodeURIComponent(selectedGroup.group_id)}&page=1&limit=5000`)
        const all = res.data.data.items || []
        setChildMills(all.filter((m: any) => m.group_id === selectedGroup.group_id))
      } catch {}
    })()
  }, [selectedGroup])

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return allGroups
      .filter(g => (g.group_id || '').toLowerCase().includes(q))
      .slice(0, 25)
  }, [allGroups, search])

  const fmt = (v: any) =>
    v == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })

  const isCertified = (v: string | null) =>
    !!v && v.trim() !== '' && !['NO', 'N/A', '-'].includes(v.trim().toUpperCase())

  const activeCertCols = useMemo(() => ({
    rspo: childMills.some(m => isCertified(m.rspo)),
    ispo: childMills.some(m => isCertified(m.ispo)),
    iscc: childMills.some(m => isCertified(m.iscc)),
    ggl:  childMills.some(m => isCertified(m.ggl)),
  }), [childMills])

  const certChip = (value: string | null) => {
    const active = isCertified(value)
    return (
      <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
        {active ? value : '—'}
      </span>
    )
  }

  const certCheck = (value: string | null) => {
    if (!isCertified(value)) return <span className="text-gray-300">—</span>
    return (
      <span title={value ?? ''} className="inline-flex items-center justify-center">
        <Check className="h-4 w-4 text-green-500" strokeWidth={2.5} />
      </span>
    )
  }

  const prodWidget = (label: string, value: number | null, color: string) => (
    <div key={label} className={`p-3 rounded-lg border ${color}`}>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-base font-semibold text-gray-800">{fmt(value)}</div>
      <div className="text-xs text-gray-400">MT</div>
    </div>
  )

  const g = selectedGroup
  const lat = g?.latitude ? Number(g.latitude) : null
  const lon = g?.longitude ? Number(g.longitude) : null
  const mapSrc = lat && lon
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${lon - 0.05},${lat - 0.05},${lon + 0.05},${lat + 0.05}&layer=mapnik&marker=${lat},${lon}`
    : null

  return (
    <Layout>
      <div className="p-6 space-y-6">

        {/* ── Section 1: Search ── */}
        <Card>
          <CardHeader>
            <CardTitle>Select Customer</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3 items-center">
              <Input
                placeholder="Search by Group ID..."
                value={search}
                onChange={e => { setSearch(e.target.value); setSelectedGroup(null) }}
                className="max-w-sm"
              />
              {(search || selectedGroup) && (
                <button
                  className="text-gray-400 hover:text-gray-600"
                  onClick={() => { setSearch(''); setSelectedGroup(null) }}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {!selectedGroup && searchResults.length > 0 && (
              <div className="mt-2 border rounded-lg divide-y max-h-60 overflow-y-auto shadow-sm max-w-sm">
                {searchResults.map(grp => (
                  <button
                    key={grp.group_id}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-blue-50 transition-colors"
                    onClick={() => { setSelectedGroup(grp); setSearch('') }}
                  >
                    <Building2 className="h-4 w-4 text-gray-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-800 truncate">{grp.group_id}</div>
                      <div className="text-xs text-gray-400">
                        {[grp.parent_company, grp.islands].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {!selectedGroup && search.trim() && searchResults.length === 0 && (
              <p className="mt-3 text-sm text-gray-400">No groups found</p>
            )}

            {selectedGroup && (
              <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded text-sm">
                <Building2 className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                <span className="font-medium text-blue-800">{selectedGroup.group_id}</span>
                {selectedGroup.parent_company && (
                  <span className="text-blue-400 text-xs">· {selectedGroup.parent_company}</span>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Section 2: Group 360 Detail ── */}
        {g && (
          <div className="space-y-6">

            {/* Identity + Coverage */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* FR 3.1 — Identity Profile */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Building2 className="h-4 w-4 text-blue-600" />
                    Identity Profile
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {([
                    { label: 'Group ID',          value: g.group_id },
                    { label: 'Group Type',        value: g.group_type },
                    { label: 'Group Scale',       value: g.group_scale },
                    { label: 'Integrated Status', value: g.integrated_status },
                    { label: 'Loading Method',    value: g.loading_method },
                    { label: 'PIC',               value: g.pic },
                  ] as { label: string; value: string | null }[]).map(({ label, value }) => (
                    <div key={label} className="flex items-start gap-3 p-3 bg-gray-50 rounded">
                      <span className="text-xs text-gray-500 w-32 shrink-0 pt-0.5">{label}</span>
                      <span className="text-sm font-medium text-gray-800">{value || '—'}</span>
                    </div>
                  ))}
                  {/* Mill Quantity */}
                  <div className="flex items-start gap-3 p-3 bg-gray-50 rounded">
                    <span className="text-xs text-gray-500 w-32 shrink-0 pt-0.5">Mill Quantity</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800">
                        {childMills.length > 0 ? childMills.length : '—'}
                      </span>
                      {childMills.length > 0 && (
                        <button
                          onClick={() => setShowMillList(true)}
                          className="inline-flex items-center justify-center h-6 w-6 rounded border border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
                          title="View Mill List"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Jumlah Kontrak */}
                  <div className="flex items-start gap-3 p-3 bg-gray-50 rounded">
                    <span className="text-xs text-gray-500 w-32 shrink-0 pt-0.5">Jumlah Kontrak</span>
                    <span className="text-sm font-medium text-gray-800">
                      {g.jumlah_pks != null ? g.jumlah_pks.toLocaleString() : '—'}
                    </span>
                  </div>

                  {/* Fleet Summary divider */}
                  <div className="flex items-center gap-2 pt-1">
                    <Ship className="h-3.5 w-3.5 text-sky-500 shrink-0" />
                    <span className="text-xs font-semibold text-sky-600 uppercase tracking-wide">Turnover Summary</span>
                    <div className="flex-1 h-px bg-sky-100" />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2.5 bg-sky-50 rounded border border-sky-100">
                      <div className="text-xs text-gray-500">Total Voyages</div>
                      <div className="text-sm font-semibold text-gray-800">
                        {g.total_voyages != null ? g.total_voyages.toLocaleString() : '—'}
                      </div>
                    </div>
                    <div className="p-2.5 bg-sky-50 rounded border border-sky-100">
                      <div className="text-xs text-gray-500">Unique Vessels</div>
                      <div className="text-sm font-semibold text-gray-800">
                        {g.unique_vessels != null ? g.unique_vessels.toLocaleString() : '—'}
                      </div>
                    </div>
                    <div className="p-2.5 bg-sky-50 rounded border border-sky-100">
                      <div className="text-xs text-gray-500">Total Volume Shipped</div>
                      <div className="text-sm font-semibold text-gray-800">
                        {g.total_volume_shipped != null
                          ? `${Number(g.total_volume_shipped).toLocaleString('en-US', { maximumFractionDigits: 0 })} MT`
                          : '—'}
                      </div>
                    </div>
                    <div className="p-2.5 bg-sky-50 rounded border border-sky-100">
                      <div className="text-xs text-gray-500">Avg Lead Time</div>
                      <div className="text-sm font-semibold text-gray-800">
                        {g.avg_lead_time_days != null ? `${g.avg_lead_time_days} days` : '—'}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* FR 3.3 — Coverage & Location */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <MapPin className="h-4 w-4 text-red-500" />
                    Coverage & Location
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {mapSrc ? (
                    <iframe
                      src={mapSrc}
                      className="w-full rounded border"
                      style={{ height: 200, border: 0 }}
                      loading="lazy"
                      title="Group Location"
                    />
                  ) : (
                    <div className="h-32 bg-gray-100 rounded flex items-center justify-center text-gray-400 text-sm">
                      No coordinates available
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { label: 'Province(s)',    value: g.provinces },
                      { label: 'Island(s)',      value: g.islands },
                      { label: 'Land Bank',      value: g.land_bank != null ? `${Number(g.land_bank).toLocaleString()} Ha` : null },
                      { label: 'Credit Rating',  value: g.credit_rating },
                    ] as { label: string; value: string | null }[]).map(({ label, value }) => (
                      <div key={label} className="p-2 bg-gray-50 rounded">
                        <div className="text-xs text-gray-500">{label}</div>
                        <div className="text-sm font-medium text-gray-800">{value || '—'}</div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* FR 3.2 — Production Metrics (aggregated) */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Gauge className="h-4 w-4 text-indigo-600" />
                  Production Metrics
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex items-center gap-4 p-4 bg-indigo-50 rounded-lg border border-indigo-200">
                  <Gauge className="h-8 w-8 text-indigo-500 shrink-0" />
                  <div>
                    <div className="text-xs text-indigo-600 font-medium uppercase tracking-wide">Total Factory Capacity (CAP)</div>
                    <div className="text-2xl font-bold text-indigo-800">
                      {g.total_cap ? `${Number(g.total_cap).toLocaleString()} tph` : '—'}
                    </div>
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Monthly Estimates</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {prodWidget('CPO / Month',   g.cpo_month,   'border-blue-200 bg-blue-50')}
                    {prodWidget('PK / Month',    g.pk_month,    'border-green-200 bg-green-50')}
                    {prodWidget('POME / Month',  g.pome_month,  'border-amber-200 bg-amber-50')}
                    {prodWidget('SHELL / Month', g.shell_month, 'border-red-200 bg-red-50')}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Annual Estimates</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {prodWidget('CPO / Year',   g.cpo_year,   'border-blue-200 bg-blue-50')}
                    {prodWidget('PK / Year',    g.pk_year,    'border-green-200 bg-green-50')}
                    {prodWidget('POME / Year',  g.pome_year,  'border-amber-200 bg-amber-50')}
                    {prodWidget('SHELL / Year', g.shell_year, 'border-red-200 bg-red-50')}
                  </div>
                </div>
              </CardContent>
            </Card>


          </div>
        )}

      </div>

      {/* Mill List Modal */}
      {showMillList && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Mill List</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {g?.group_id} — {childMills.length} mills
                </p>
              </div>
              <button onClick={() => setShowMillList(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="overflow-auto flex-1">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Mill Code</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Mill Name</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Province</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Island</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">CAP (tph)</th>
                    {activeCertCols.rspo && <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500">RSPO</th>}
                    {activeCertCols.ispo && <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500">ISPO</th>}
                    {activeCertCols.iscc && <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500">ISCC</th>}
                    {activeCertCols.ggl  && <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500">GGL</th>}
                  </tr>
                </thead>
                <tbody>
                  {childMills.map((m, i) => (
                    <tr key={m.mill_code || i} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-600">{m.mill_code || '—'}</td>
                      <td className="px-4 py-2.5 font-medium text-gray-800">{m.mills || '—'}</td>
                      <td className="px-4 py-2.5 text-gray-600">{m.province || '—'}</td>
                      <td className="px-4 py-2.5 text-gray-600">{m.island || '—'}</td>
                      <td className="px-4 py-2.5 text-right text-gray-700">
                        {m.cap ? Number(m.cap).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—'}
                      </td>
                      {activeCertCols.rspo && <td className="px-4 py-2.5 text-center">{certCheck(m.rspo)}</td>}
                      {activeCertCols.ispo && <td className="px-4 py-2.5 text-center">{certCheck(m.ispo)}</td>}
                      {activeCertCols.iscc && <td className="px-4 py-2.5 text-center">{certCheck(m.iscc)}</td>}
                      {activeCertCols.ggl  && <td className="px-4 py-2.5 text-center">{certChip(m.ggl)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

    </Layout>
  )
}
