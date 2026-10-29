'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import api from '@/lib/api'
import {
  JETTY_FIX_PAGE,
  describeJettyRefresh,
  describeJettyResubmit,
  describeJettyResult,
  jettyRefreshNeedsReload,
  type JettyReadiness,
  type JettyRefreshResult,
  type JettySubmitResult,
  type JettyTone,
} from '@/lib/jettySubmit'

const TONE_CLASS: Record<JettyTone, string> = {
  success: 'border-green-200 bg-green-50 text-green-800',
  error: 'border-red-200 bg-red-50 text-red-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  info: 'border-blue-200 bg-blue-50 text-blue-800',
}

function errorText(err: unknown): string {
  const e = err as { response?: { data?: { error?: { message?: string } } }; message?: string }
  return e?.response?.data?.error?.message || e?.message || 'Request failed'
}

/**
 * Submit to Jetty. Opens by checking the saved data of this shipment against everything JPS needs (what KLIP can know), lists each requirement with what was
 * found and where to fix it, and, when all are met, sends the STO to JPS after one confirmation and shows JPS's answer as it came.
 */
export function SubmitToJettyDialog({
  shipmentId,
  shownJettyStatus,
  onClose,
  onSent,
}: {
  shipmentId: string
  /** The Jetty Status the caller shows now, so a refresh can tell whether KLIP holds a different one (see jettyRefreshNeedsReload). */
  shownJettyStatus?: string | null
  onClose: () => void
  /** Called after a request reached JPS (accepted or refused), so the caller can refresh the Jetty Status. */
  onSent: () => void
}) {
  const [readiness, setReadiness] = useState<JettyReadiness | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<JettySubmitResult | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshNote, setRefreshNote] = useState<{ tone: JettyTone; text: string } | null>(null)

  const check = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get(`/shipments/${shipmentId}/jetty/readiness`)
      setReadiness(res.data?.data ?? null)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setLoading(false)
    }
  }, [shipmentId])

  useEffect(() => {
    void check()
  }, [check])

  /** Ask JPS now what it holds for this STO (instead of waiting for the next check), then show what it said and what can be done next. */
  const refreshFromJps = async () => {
    setRefreshing(true)
    setRefreshNote(null)
    setError('')
    try {
      const res = await api.post(`/shipments/${shipmentId}/jetty/refresh`)
      const data = res.data?.data as JettyRefreshResult
      setRefreshNote(describeJettyRefresh(data.refresh))
      setReadiness(data.readiness ?? null)
      if (jettyRefreshNeedsReload(data.refresh, shownJettyStatus)) onSent()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setRefreshing(false)
    }
  }

  const send = async () => {
    setSending(true)
    setError('')
    try {
      const res = await api.post(`/shipments/${shipmentId}/jetty/submit`)
      const data = res.data?.data as JettySubmitResult
      setResult(data)
      setConfirming(false)
      if (data?.attempted && data.outcome?.kind !== 'retryable') onSent()
      if (!data?.attempted) setReadiness(data?.readiness ?? null)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setSending(false)
    }
  }

  const view = result ? describeJettyResult(result) : null
  const sentNow = Boolean(result?.attempted)
  const resubmit = readiness?.resubmit ?? null
  const resubmitView = resubmit ? describeJettyResubmit(resubmit) : null
  // An instruction JPS holds (not rejected) can still change at JPS, so the user may want to ask what it says now.
  const canRefresh = readiness?.tracker?.state === 'SUBMITTED'
  const verb = resubmit ? 'Resubmit' : 'Send'

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Submit to Jetty">
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Submit to Jetty</h3>
            <p className="mt-0.5 text-xs text-gray-500">
              {readiness?.stoKey ? `STO ${readiness.stoKey} · ` : ''}Checks the saved data of this shipment against what JPS needs, then sends it.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="Close">
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking requirements…
            </div>
          )}

          {error && (
            <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {view && (
            <div role="status" className={`rounded border px-3 py-3 text-sm ${TONE_CLASS[view.tone]}`}>
              <div className="flex items-center gap-2 font-semibold">
                {view.tone === 'success' ? <CheckCircle2 className="h-4 w-4" /> : view.tone === 'error' ? <XCircle className="h-4 w-4" /> : view.tone === 'info' ? <Info className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                {view.title}
              </div>
              <ul className="mt-2 space-y-1 whitespace-pre-line text-[0.8125rem]">
                {view.lines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          {resubmitView && !sentNow && (
            <div role="status" className="rounded border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800">
              <div className="flex items-center gap-2 font-semibold">
                <XCircle className="h-4 w-4" />
                {resubmitView.title}
              </div>
              <ul className="mt-2 space-y-1 text-[0.8125rem]">
                {resubmitView.lines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
              {resubmitView.warning && (
                <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">{resubmitView.warning}</p>
              )}
            </div>
          )}

          {refreshNote && !sentNow && (
            <div role="status" className={`rounded border px-3 py-2 text-xs ${TONE_CLASS[refreshNote.tone]}`}>
              {refreshNote.text}
            </div>
          )}

          {readiness && !sentNow && (
            <>
              {readiness.reason && (
                <p className={`text-sm ${readiness.canSubmit ? 'text-gray-700' : 'text-amber-800'}`}>{readiness.reason}</p>
              )}
              {readiness.tracker && readiness.tracker.state !== 'SUBMITTED' && readiness.tracker.lastError && (
                <div className="rounded border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800">
                  <div className="font-semibold">Last attempt ({readiness.tracker.state === 'FAILED' ? 'refused by JPS' : 'held by KLIP'})</div>
                  <div className="mt-0.5 break-words">{readiness.tracker.lastError}</div>
                </div>
              )}
              <ul className="divide-y divide-gray-100 rounded border border-gray-200">
                {readiness.checks.map((c) => (
                  <li key={c.key} className="flex gap-3 px-3 py-2.5 text-sm">
                    {c.ok ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-label="met" />
                    ) : (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-label="not met" />
                    )}
                    <div className="min-w-0">
                      <div className="font-medium text-gray-800">{c.label}</div>
                      <div className="break-words text-xs text-gray-500">{c.value}</div>
                      {!c.ok && c.fix && (
                        <div className="mt-1 text-xs text-gray-700">
                          {c.fix}{' '}
                          {c.fixAt && JETTY_FIX_PAGE[c.fixAt] && (
                            <Link href={JETTY_FIX_PAGE[c.fixAt]!.href} target="_blank" className="font-medium text-blue-600 hover:underline">
                              Open {JETTY_FIX_PAGE[c.fixAt]!.label}
                            </Link>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-gray-500">
                JPS has no way to test a request first. What only JPS can know (for example data in its own master vessel list) shows up in its answer after sending.
              </p>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-gray-200 px-5 py-3">
          <div className="text-xs text-gray-500">
            {confirming && !sentNow
              ? resubmit
                ? `This creates a new instruction (revision ${resubmit.fromRevision + 1}) at JPS if accepted, and it cannot be cancelled.`
                : 'This creates a real instruction at JPS if accepted, and it cannot be cancelled.'
              : ''}
          </div>
          <div className="flex gap-2">
            {!sentNow && !confirming && (
              <Button variant="outline" onClick={() => void check()} disabled={loading || sending || refreshing}>
                Check again
              </Button>
            )}
            {!sentNow && !confirming && canRefresh && (
              <Button variant="outline" onClick={() => void refreshFromJps()} disabled={loading || sending || refreshing}>
                {refreshing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Asking JPS…
                  </>
                ) : (
                  'Refresh from JPS'
                )}
              </Button>
            )}
            <Button variant="outline" onClick={confirming && !sentNow ? () => setConfirming(false) : onClose} disabled={sending}>
              {confirming && !sentNow ? 'Back' : 'Close'}
            </Button>
            {!sentNow && readiness?.canSubmit && !confirming && (
              <Button className="h-9 bg-orange-500 text-white hover:bg-orange-600" onClick={() => setConfirming(true)} disabled={loading || sending}>
                {verb} to JPS
              </Button>
            )}
            {!sentNow && confirming && (
              <Button className="h-9 bg-orange-600 text-white hover:bg-orange-700" onClick={() => void send()} disabled={sending}>
                {sending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending…
                  </>
                ) : (
                  `Confirm and ${verb.toLowerCase()}`
                )}
              </Button>
            )}
            {sentNow && result?.outcome?.kind === 'failed' && (
              <Button variant="outline" onClick={() => { setResult(null); void check() }}>
                Check again
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
