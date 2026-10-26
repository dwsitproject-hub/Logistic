/**
 * Retry helper for idempotent GETs that failed before any HTTP response arrived
 * (axios `ERR_NETWORK`: dropped connection, proxy reset, flaky VPN).
 *
 * Only a network-level failure is retried. An HTTP error (4xx/5xx) has a response, so it is
 * a real answer from the server and is rethrown untouched.
 */

export interface NetworkRetryOptions {
  /** Extra attempts after the first one. Default 1. */
  retries?: number
  /** Pause before each retry, in ms. Default 700. */
  delayMs?: number
}

interface AxiosLikeError {
  code?: string
  message?: string
  response?: unknown
}

export function isNetworkError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as AxiosLikeError
  if (e.response) return false
  return e.code === 'ERR_NETWORK' || e.message === 'Network Error'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function withNetworkRetry<T>(
  run: () => Promise<T>,
  { retries = 1, delayMs = 700 }: NetworkRetryOptions = {},
): Promise<T> {
  let attempt = 0
  for (;;) {
    try {
      return await run()
    } catch (err) {
      if (attempt >= retries || !isNetworkError(err)) throw err
      attempt += 1
      if (delayMs > 0) await sleep(delayMs)
    }
  }
}
