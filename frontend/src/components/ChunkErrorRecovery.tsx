'use client'

import { useEffect } from 'react'
import { isChunkLoadError, reloadForChunkError } from '@/lib/chunkReload'

/**
 * Reloads the page once when a script chunk fails to load (see lib/chunkReload.ts). It only listens: the error still reaches the console and the Hub SDK, so the
 * report keeps being filed.
 */
export function ChunkErrorRecovery() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (isChunkLoadError(event.error) || isChunkLoadError(event.message)) reloadForChunkError()
    }
    const onRejection = (event: PromiseRejectionEvent) => {
      if (isChunkLoadError(event.reason)) reloadForChunkError()
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  return null
}
