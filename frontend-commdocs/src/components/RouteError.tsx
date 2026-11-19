'use client'

import { useEffect } from 'react'
import { isStaleAssetError, reloadForChunkError } from '@/lib/chunkReload'

/**
 * Shown when a route throws. A stale tab (ChunkLoadError, or the old webpack runtime after a deploy) reloads once.
 * If that reload already happened in this tab, the button stays so the page is not left blank. See docs/COD-BUGFIX-HISTORY.md.
 */
export function RouteError({ error, reset }: { error: Error & { digest?: string }; reset?: () => void }) {
  const stale = isStaleAssetError(error)

  useEffect(() => {
    if (stale) reloadForChunkError()
  }, [stale])

  if (stale) {
    return (
      <div className="center-page" style={{ padding: '2rem' }}>
        <div className="card-login">
          <h1 style={{ fontSize: '1.25rem' }}>New version available</h1>
          <p className="hint" style={{ margin: 0 }}>
            Commercial Documents was updated while this page was open. Reload to fetch the current files. If the page stays blank, hard-refresh
            (Ctrl+F5).
          </p>
          <button className="btn primary" type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="center-page" style={{ padding: '2rem' }}>
      <div className="card-login">
        <h1 style={{ fontSize: '1.25rem' }}>This page could not be shown</h1>
        <p className="hint" style={{ margin: 0 }}>
          Try again. If it keeps happening, reload the page.
          {error.digest ? <span className="mono"> Reference {error.digest}.</span> : null}
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {reset ? (
            <button className="btn primary" type="button" onClick={() => reset()}>
              Try again
            </button>
          ) : null}
          <button className="btn" type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    </div>
  )
}
