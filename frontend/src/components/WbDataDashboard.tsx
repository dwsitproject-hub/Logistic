'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { iconButtonClass } from '@/lib/iconButton'
import api from '@/lib/api'
import { WbDataKpis } from '@/components/wb-data/WbDataKpis'
import { WbDataHistory } from '@/components/wb-data/WbDataHistory'
import { WbDataDetailModal } from '@/components/wb-data/WbDataDetailModal'
import { summarizeWbImports, type WbImportRow } from '@/lib/wbDataSummary'

/**
 * WB Data: the history of the weighbridge uploads made on the Trucking page - who uploaded, when, and what it wrote. Read-only; it is laid out like Logistics Data
 * (KPI cards, a filterable history, a detail window per upload).
 */
const WbDataDashboard: React.FC = () => {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [imports, setImports] = useState<WbImportRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const detailImportId = searchParams.get('import')

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true)
    try {
      const res = await api.get('/wb-data/imports')
      setImports(res.data?.data ?? [])
      setError(null)
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status
      setError(
        status === 403
          ? 'You do not have permission to view WB upload history. Ask an administrator to grant WB Data view access for your role and level.'
          : 'Could not load the WB upload history. Please retry, and tell IT if it keeps happening.',
      )
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const openDetail = useCallback(
    (id: string) => {
      const next = new URLSearchParams(searchParams.toString())
      next.set('import', id)
      router.replace(`/wb-data?${next.toString()}`, { scroll: false })
    },
    [router, searchParams],
  )

  const closeDetail = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString())
    next.delete('import')
    const q = next.toString()
    router.replace(q ? `/wb-data?${q}` : '/wb-data', { scroll: false })
  }, [router, searchParams])

  const summary = useMemo(() => summarizeWbImports(imports), [imports])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-gray-500">Loading...</div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <p className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-600">
        History of the weighbridge (WB rekap) files uploaded on the Trucking page. This page only shows them; the upload itself stays on Trucking.
      </p>

      <WbDataKpis summary={summary} />

      <WbDataHistory
        imports={imports}
        error={error}
        onOpen={openDetail}
        actions={
          <Button
            variant="ghost"
            size="icon"
            className={iconButtonClass('sync')}
            onClick={() => void load(true)}
            disabled={refreshing}
            title="Refresh"
            aria-label="Refresh"
          >
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCw className="h-4 w-4" aria-hidden />}
          </Button>
        }
      />

      <WbDataDetailModal importId={detailImportId} onClose={closeDetail} />
    </div>
  )
}

export default WbDataDashboard
