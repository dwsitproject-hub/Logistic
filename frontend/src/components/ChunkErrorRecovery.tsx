'use client'

import { useEffect } from 'react'
import { isChunkLoadError, isWebpackVersionSkewError, reloadForChunkError } from '@/lib/chunkReload'

/**
 * Reloads the page once when a script chunk fails to load, or when the old webpack runtime of a tab opened before a deploy meets a module it does not have (see
 * lib/chunkReload.ts). It only listens: the error still reaches the console and the Hub SDK, so the report keeps being filed.
 */
export function ChunkErrorRecovery() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (isChunkLoadError(event.error) || isChunkLoadError(event.message) || isWebpackVersionSkewError(event.error)) reloadForChunkError()
    }
    const onRejection = (event: PromiseRejectionEvent) => {
      if (isChunkLoadError(event.reason) || isWebpackVersionSkewError(event.reason)) reloadForChunkError()
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
