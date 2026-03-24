'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { format } from 'date-fns'
import { Activity, Loader2, X } from 'lucide-react'
import api from '@/lib/api'
import { pathToActivityPage } from '@/lib/pageActivityMap'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type ActivityRow = {
  id: string
  action: string
  entity_type: string
  entity_id: string | null
  timestamp: string
  username: string
  full_name: string
}

export function PageActivityFab() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [logs, setLogs] = useState<ActivityRow[]>([])
  const [pageKey, setPageKey] = useState('')

  useEffect(() => {
    if (!open) return
    const page = pathToActivityPage(pathname)
    setLoading(true)
    setError('')
    api
      .get('/activity/recent', { params: { page } })
      .then((res) => {
        const d = res.data?.data
        setLogs(Array.isArray(d?.logs) ? d.logs : [])
        setPageKey(d?.pageKey || page)
      })
      .catch((err) => {
        setError(err.response?.data?.error?.message || 'Failed to load activity')
        setLogs([])
      })
      .finally(() => setLoading(false))
  }, [open, pathname])

  if (pathname === '/login') return null

  return (
    <>
      <button
        type="button"
        data-tour="tour-page-activity"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-[100] flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-primary/40"
        title="Latest activity on this page"
        aria-label="Open latest activity for this page"
      >
        <Activity className="h-6 w-6" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Latest activity</DialogTitle>
            <DialogDescription>
              Recent changes related to this area of the app (up to 20). Page:{' '}
              <span className="font-mono text-xs">{pageKey || pathToActivityPage(pathname)}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto min-h-0">
            {loading && (
              <div className="flex items-center gap-2 text-sm text-gray-500 py-6 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            )}
            {!loading && error && (
              <p className="text-sm text-red-600 py-4">{error}</p>
            )}
            {!loading && !error && logs.length === 0 && (
              <p className="text-sm text-gray-500 py-4">No audit activity recorded for this page yet.</p>
            )}
            {!loading && !error && logs.length > 0 && (
              <ul className="space-y-3 text-sm">
                {logs.map((row) => (
                  <li
                    key={row.id}
                    className="border-b border-gray-100 pb-3 last:border-0 last:pb-0"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900">
                          {row.action}{' '}
                          <span className="text-gray-600 font-normal">
                            {row.entity_type}
                            {row.entity_id ? (
                              <span className="text-xs text-gray-400 ml-1 font-mono truncate inline-block max-w-[140px] align-bottom">
                                {String(row.entity_id).slice(0, 8)}…
                              </span>
                            ) : null}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {row.full_name || row.username || 'System'}
                        </div>
                      </div>
                      <div className="text-xs text-gray-400 whitespace-nowrap shrink-0">
                        {row.timestamp
                          ? format(new Date(row.timestamp), 'yyyy-MM-dd HH:mm')
                          : ''}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex justify-end pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              <X className="h-4 w-4 mr-1" />
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
