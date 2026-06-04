'use client'

import { useEffect } from 'react'

function shouldIgnoreMetaMaskError(message: unknown, filename?: unknown) {
  const msg = String(message || '')
  const file = String(filename || '')

  // MetaMask injects `inpage.js` via chrome-extension://<extension-id>/...
  const isExtensionScript = file.startsWith('chrome-extension://') || msg.includes('chrome-extension://')

  // Common MetaMask noise that can surface as unhandled runtime error in dev overlay
  const isMetaMaskConnectError =
    msg.toLowerCase().includes('failed to connect to metamask') ||
    msg.toLowerCase().includes('metamask') ||
    msg.toLowerCase().includes('ethereum')

  // Some unhandled rejections don't include a filename; if message is clearly MetaMask-related, ignore it.
  if (isMetaMaskConnectError) return true

  return isExtensionScript && isMetaMaskConnectError
}

export function MetaMaskErrorGuard() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (shouldIgnoreMetaMaskError(event.message, event.filename)) {
        // Stop Next.js dev overlay listeners (capture+stop propagation).
        // Some extension errors still surface unless propagation is halted.
        event.stopImmediatePropagation?.()
        event.preventDefault()
        return false
      }
      return undefined
    }

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = (event as PromiseRejectionEvent).reason
      const msg = typeof reason === 'string' ? reason : (reason?.message ?? reason?.toString?.() ?? '')
      if (shouldIgnoreMetaMaskError(msg, undefined)) {
        event.stopImmediatePropagation?.()
        event.preventDefault()
      }
    }

    // Use capture so we run before overlay handlers.
    window.addEventListener('error', onError, true)
    window.addEventListener('unhandledrejection', onUnhandledRejection, true)
    // Fallback hooks (some browsers/extensions bypass addEventListener paths)
    const prevOnError = window.onerror
    const prevOnRej = window.onunhandledrejection
    window.onerror = function (...args) {
      const [message, source] = args
      if (shouldIgnoreMetaMaskError(message, source)) return true
      return typeof prevOnError === 'function' ? prevOnError.apply(window, args as any) : null
    }
    window.onunhandledrejection = function (event: PromiseRejectionEvent) {
      const reason = (event as PromiseRejectionEvent).reason
      const msg = typeof reason === 'string' ? reason : (reason?.message ?? reason?.toString?.() ?? '')
      if (shouldIgnoreMetaMaskError(msg, undefined)) {
        event.preventDefault()
        return
      }
      if (typeof prevOnRej === 'function') prevOnRej.call(window, event)
    }
    return () => {
      window.removeEventListener('error', onError, true)
      window.removeEventListener('unhandledrejection', onUnhandledRejection, true)
      window.onerror = prevOnError
      window.onunhandledrejection = prevOnRej
    }
  }, [])

  return null
}

