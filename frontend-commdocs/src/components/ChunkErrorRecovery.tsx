'use client'

import { isStaleAssetError, reloadForChunkError } from '@/lib/chunkReload'

/**
 * Reloads the page once when a script chunk fails to load, or when the old webpack runtime of a tab opened before a deploy meets a module it does not have
 * (see lib/chunkReload.ts). Listeners are installed when this module evaluates, which is before hydration. A useEffect would run too late: the login route chunk
 * can fail while React is still hydrating, and that is the window where React then throws minified error #423.
 *
 * It only listens. The error still reaches the console and the Hub SDK, so the report keeps being filed.
 */
function installChunkErrorRecovery() {
  if (typeof window === 'undefined') return
  const host = window as Window & { __cdChunkRecovery?: boolean }
  if (host.__cdChunkRecovery) return
  host.__cdChunkRecovery = true

  window.addEventListener('error', (event) => {
    if (isStaleAssetError(event.error) || isStaleAssetError(event.message)) reloadForChunkError()
  })
  window.addEventListener('unhandledrejection', (event) => {
    if (isStaleAssetError(event.reason)) reloadForChunkError()
  })
}

installChunkErrorRecovery()

export function ChunkErrorRecovery() {
  installChunkErrorRecovery()
  return null
}
