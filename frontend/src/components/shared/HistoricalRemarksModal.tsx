'use client'

import { useEffect, useState } from 'react'
import { Loader2, MessageSquare, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDateTimeDMY } from '@/lib/dateFormat'
import {
  fetchEntityRemarks,
  formatRemarkAuthor,
  formatRemarkCategoryLabel,
  type EntityRemarkRow,
  type EntityRemarkType,
} from '@/lib/entityRemarks'

export function HistoricalRemarksModal({
  open,
  onClose,
  entityType,
  entityId,
  title,
  subtitle,
}: {
  open: boolean
  onClose: () => void
  entityType: EntityRemarkType
  entityId: string | null
  title?: string
  subtitle?: string
}) {
  const [remarks, setRemarks] = useState<EntityRemarkRow[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !entityId) {
      setRemarks([])
      return
    }
    let cancelled = false
    setLoading(true)
    void fetchEntityRemarks(entityType, entityId)
      .then((rows) => {
        if (!cancelled) setRemarks(rows)
      })
      .catch((err) => {
        console.error('Failed to load remarks:', err)
        if (!cancelled) setRemarks([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, entityId, entityType])

  if (!open) return null

  const modalTitle =
    title ?? (entityType === 'contract' ? 'Contract remarks' : 'Shipment remarks')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden">
        <CardHeader className="shrink-0 border-b">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-lg">
                <MessageSquare className="h-5 w-5 shrink-0 text-orange-700" />
                {modalTitle}
              </CardTitle>
              {subtitle ? (
                <p className="mt-1 truncate text-sm text-gray-500" title={subtitle}>
                  {subtitle}
                </p>
              ) : null}
            </div>
            <Button variant="ghost" size="icon" className="shrink-0" aria-label="Close" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-y-auto py-4">
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading remarks…
            </div>
          ) : remarks.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">No remarks yet.</p>
          ) : (
            <ul className="space-y-3">
              {remarks.map((remark) => {
                const categoryLabel = formatRemarkCategoryLabel(remark.category)
                return (
                  <li
                    key={remark.id}
                    className="rounded-md border border-amber-100 bg-amber-50/40 px-3 py-2.5"
                  >
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-gray-800">
                          {formatRemarkAuthor(remark)}
                        </span>
                        {categoryLabel ? (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-800">
                            {categoryLabel}
                          </span>
                        ) : null}
                      </div>
                      <span className="text-xs tabular-nums text-gray-500">
                        {remark.created_at ? formatDateTimeDMY(remark.created_at) : '—'}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm text-gray-800">
                      {remark.text}
                    </p>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
