'use client'

import { AlertCircle, Check, FolderOpen, Loader2, X } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { pageList } from '@/lib/format'

export function Brand({ size = 18 }: { size?: number }) {
  return (
    <span className="brand">
      <span className="mark">
        <FolderOpen width={size} height={size} aria-hidden />
      </span>
      Commercial Documents
    </span>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" style={{ display: 'inline-flex', gap: 8, alignItems: 'center', color: 'var(--ink-3)' }}>
      <Loader2 width={18} height={18} className="spin" aria-hidden />
      <span className="sr">{label}</span>
    </span>
  )
}

/** `onRetry` adds a Retry button: for a load that failed for a reason that may pass (the server restarting), not for one the user has to fix. */
export function ErrorNote({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  if (!children) return null
  return (
    <div className="alert bad" role="alert">
      <AlertCircle aria-hidden />
      <span>{children}</span>
      {onRetry ? (
        <button type="button" className="btn sm" style={{ marginLeft: 'auto' }} onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  )
}

/** Centered dialog. Escape and the backdrop close it unless `busy`. */
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  narrow,
  busy,
}: {
  title: string
  subtitle?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  narrow?: boolean
  busy?: boolean
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, busy])
  useEffect(() => {
    const first = boxRef.current?.querySelector<HTMLElement>('input, select, textarea, button.primary')
    first?.focus()
  }, [])
  return (
    <div className="modal">
      <div className="scrim" onClick={() => !busy && onClose()} />
      <div className={`box${narrow ? ' narrow' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={boxRef}>
        <div className="mh">
          <div>
            <h3>{title}</h3>
            {subtitle ? (
              <p className="hint" style={{ margin: '2px 0 0' }}>
                {subtitle}
              </p>
            ) : null}
          </div>
          <button className="icon-btn" onClick={onClose} disabled={busy} aria-label="Close" type="button">
            <X aria-hidden />
          </button>
        </div>
        <div className="mb">{children}</div>
        {footer ? <div className="mf">{footer}</div> : null}
      </div>
    </div>
  )
}

type ToastState = { text: string; bad?: boolean } | null
const ToastContext = createContext<{ toast: (text: string, bad?: boolean) => void; lift: (on: boolean) => void } | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ToastState>(null)
  const [lifted, setLifted] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const toast = useCallback((text: string, bad?: boolean) => {
    setState({ text, bad })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setState(null), bad ? 5000 : 2800)
  }, [])
  return (
    <ToastContext.Provider value={{ toast, lift: setLifted }}>
      {children}
      {state ? (
        <div className={`toast${state.bad ? ' bad' : ''}${lifted ? ' lift' : ''}`} role="status">
          {state.bad ? <AlertCircle aria-hidden /> : <Check aria-hidden />}
          {state.text}
        </div>
      ) : null}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast outside ToastProvider')
  return ctx
}

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  return (
    <nav className="pager" aria-label="Pages">
      <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">
        ‹
      </button>
      {pageList(page, pages).map((p, i) =>
        p === 'gap' ? (
          <span className="gap" key={`g${i}`}>
            …
          </span>
        ) : (
          <button type="button" key={p} onClick={() => onPage(p)} aria-current={p === page ? 'page' : undefined}>
            {p}
          </button>
        ),
      )}
      <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page">
        ›
      </button>
    </nav>
  )
}

export const PAGE_SIZES = [10, 25, 50, 100]

export function PageSize({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <>
      <label htmlFor="page-size">Rows per page</label>
      <select
        className="select"
        id="page-size"
        style={{ height: 30, width: 'auto' }}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {PAGE_SIZES.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </>
  )
}

/** Remembers a small per-browser preference (column choice, rows per page). Reads and writes never throw. */
export function usePreference<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw) setValue(JSON.parse(raw) as T)
    } catch {
      /* ignore */
    }
  }, [key])
  const set = useCallback(
    (v: T) => {
      setValue(v)
      try {
        localStorage.setItem(key, JSON.stringify(v))
      } catch {
        /* ignore */
      }
    },
    [key],
  )
  return [value, set]
}
