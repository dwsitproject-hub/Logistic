'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'

type TourStep = {
  selector: string
  title: string
  description: string
}

type TourContextValue = {
  startTour: () => void
}

const TourContext = createContext<TourContextValue | null>(null)

export function useAppTour() {
  const ctx = useContext(TourContext)
  if (!ctx) {
    return { startTour: () => {} }
  }
  return ctx
}

function buildSteps(): TourStep[] {
  const base: TourStep[] = [
    {
      selector: '[data-tour="tour-sidebar"]',
      title: 'Navigation',
      description:
        'Use the sidebar to open Dashboard, Contracts, Shipments, Trucking, Finance, Documents, and other modules.',
    },
    {
      selector: '[data-tour="tour-header"]',
      title: 'Your session',
      description: 'See your name and role. Use the logout button when you are done.',
    },
    {
      selector: '[data-tour="tour-main"]',
      title: 'Main workspace',
      description:
        'Each page shows filters, tables, and actions for that part of logistics operations.',
    },
    {
      selector: '[data-tour="tour-page-activity"]',
      title: 'Latest activity',
      description:
        'Tap this floating button anytime to see the most recent audited changes for this area (who did what and when).',
    },
  ]

  if (typeof document !== 'undefined' && document.querySelector('[data-tour="tour-ai-insight"]')) {
    base.splice(3, 0, {
      selector: '[data-tour="tour-ai-insight"]',
      title: 'AI Logistics Insight',
      description:
        'Optional expert summary powered by Gemini from your current dashboard filters. Generate or refresh when needed.',
    })
  }

  return base
}

function TourOverlay({
  open,
  steps,
  onClose,
  onComplete,
}: {
  open: boolean
  steps: TourStep[]
  onClose: () => void
  onComplete: () => void
}) {
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [missing, setMissing] = useState(false)

  const step = steps[index]
  const total = steps.length

  useEffect(() => {
    if (!open) {
      setIndex(0)
      setRect(null)
      setMissing(false)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open || !step) return

    const update = () => {
      const el = document.querySelector(step.selector)
      if (el) {
        setMissing(false)
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        // Re-measure after scroll
        requestAnimationFrame(() => {
          const r = el.getBoundingClientRect()
          setRect(r)
        })
      } else {
        setMissing(true)
        setRect(null)
      }
    }

    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, step, index])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !step) return null

  const isLast = index >= total - 1

  const holePad = 6
  const vw = typeof window !== 'undefined' ? window.innerWidth : 0
  const vh = typeof window !== 'undefined' ? window.innerHeight : 0

  const hole =
    rect && rect.width > 0 && rect.height > 0
      ? {
          left: rect.left - holePad,
          top: rect.top - holePad,
          right: rect.right + holePad,
          bottom: rect.bottom + holePad,
          width: rect.width + holePad * 2,
          height: rect.height + holePad * 2,
        }
      : null

  const cardStyle: CSSProperties = (() => {
    const pad = 16
    const cardW = Math.min(360, window.innerWidth - pad * 2)
    if (rect && rect.width > 0 && rect.height > 0) {
      let top = rect.bottom + 12
      const estH = 220
      if (top + estH > window.innerHeight - pad) {
        top = Math.max(pad, rect.top - estH - 12)
      }
      let left = rect.left + rect.width / 2 - cardW / 2
      left = Math.max(pad, Math.min(left, window.innerWidth - cardW - pad))
      return { position: 'fixed' as const, top, left, width: cardW, zIndex: 400 }
    }
    return {
      position: 'fixed' as const,
      left: pad,
      right: pad,
      bottom: pad,
      zIndex: 400,
    }
  })()

  return (
    <div className="fixed inset-0 z-[350]" aria-modal role="dialog">
      {/* Dim only outside the highlighted region (sidebar stays clear / not grayed) */}
      {hole ? (
        <>
          {Math.max(0, hole.top) > 0 ? (
            <button
              key="dim-top"
              type="button"
              className="fixed z-[340] cursor-default bg-black/55"
              style={{ left: 0, top: 0, width: vw, height: Math.max(0, hole.top) }}
              aria-label="Close tour"
              onClick={onClose}
            />
          ) : null}
          {hole.bottom < vh ? (
            <button
              key="dim-bottom"
              type="button"
              tabIndex={-1}
              aria-hidden
              className="fixed z-[340] cursor-default bg-black/55"
              style={{ left: 0, top: hole.bottom, width: vw, height: Math.max(0, vh - hole.bottom) }}
              onClick={onClose}
            />
          ) : null}
          {Math.max(0, hole.left) > 0 && hole.bottom > hole.top ? (
            <button
              key="dim-left"
              type="button"
              tabIndex={-1}
              aria-hidden
              className="fixed z-[340] cursor-default bg-black/55"
              style={{
                left: 0,
                top: hole.top,
                width: hole.left,
                height: Math.max(0, hole.bottom - hole.top),
              }}
              onClick={onClose}
            />
          ) : null}
          {Math.max(0, vw - hole.right) > 0 && hole.bottom > hole.top ? (
            <button
              key="dim-right"
              type="button"
              tabIndex={-1}
              aria-hidden
              className="fixed z-[340] cursor-default bg-black/55"
              style={{
                left: hole.right,
                top: hole.top,
                width: Math.max(0, vw - hole.right),
                height: Math.max(0, hole.bottom - hole.top),
              }}
              onClick={onClose}
            />
          ) : null}
          <div
            className="pointer-events-none fixed z-[360] rounded-lg border-2 border-white shadow-[0_0_0_4px_rgba(59,130,246,0.35)]"
            style={{
              left: hole.left,
              top: hole.top,
              width: hole.width,
              height: hole.height,
            }}
          />
        </>
      ) : (
        <button
          type="button"
          className="absolute inset-0 z-[340] bg-black/55"
          aria-label="Close tour"
          onClick={onClose}
        />
      )}

      <div
        className="rounded-lg border bg-card p-4 text-card-foreground shadow-lg"
        style={cardStyle}
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              Step {index + 1} of {total}
            </p>
            <h3 className="text-lg font-semibold leading-tight">{step.title}</h3>
          </div>
          <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={onClose}>
            <X className="h-4 w-4" />
            <span className="sr-only">Close tour</span>
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">{step.description}</p>
        {missing && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            This highlight could not be found on screen; you can still continue the tour.
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Skip tour
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={index === 0}
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
            >
              Back
            </Button>
            {isLast ? (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  onComplete()
                  onClose()
                }}
              >
                Done
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={() => setIndex((i) => i + 1)}>
                Next
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function AppTourProvider({
  children,
  userId,
}: {
  children: React.ReactNode
  userId: string | null
}) {
  const pathname = usePathname()
  const storageKey = userId ? `klip_app_tour_v1_${userId}` : null
  const autoStarted = useRef(false)
  const [tourOpen, setTourOpen] = useState(false)

  const steps = useMemo(() => buildSteps(), [tourOpen])

  const completeAndPersist = useCallback(() => {
    if (storageKey) localStorage.setItem(storageKey, '1')
  }, [storageKey])

  const startTour = useCallback(() => {
    setTourOpen(true)
  }, [])

  useEffect(() => {
    if (!storageKey) return
    if (pathname !== '/dashboard') return
    if (localStorage.getItem(storageKey)) return
    if (autoStarted.current) return
    autoStarted.current = true
    const t = window.setTimeout(() => startTour(), 1200)
    return () => window.clearTimeout(t)
  }, [storageKey, pathname, startTour])

  const value = useMemo(() => ({ startTour }), [startTour])

  return (
    <TourContext.Provider value={value}>
      {children}
      <TourOverlay
        open={tourOpen}
        steps={steps}
        onClose={() => setTourOpen(false)}
        onComplete={completeAndPersist}
      />
    </TourContext.Provider>
  )
}
