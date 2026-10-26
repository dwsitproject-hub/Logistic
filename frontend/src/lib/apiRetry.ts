/**
 * Retry helper for idempotent GETs that hit a transient failure:
 *  - no HTTP response at all (axios `ERR_NETWORK`: dropped connection, proxy reset, flaky VPN), or
 *  - a gateway answer from the reverse proxy while the backend restarts (502 / 503 / 504).
 *
 * Any other HTTP error (400, 401, 403, 404, 500, ...) is a real answer from the application and is
 * rethrown untouched. Only use this for GETs: retrying a POST could repeat a side effect.
 */

export interface TransientRetryOptions {
  /** Extra attempts after the first one. Default 1. */
  retries?: number
  /** Pause before each retry, in ms. Default 700. */
  delayMs?: number
}

interface AxiosLikeError {
  code?: string
  message?: string
  response?: { status?: number }
}

const GATEWAY_STATUSES = new Set([502, 503, 504])

export function isNetworkError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as AxiosLikeError
  if (e.response) return false
  return e.code === 'ERR_NETWORK' || e.message === 'Network Error'
}

export function isGatewayError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const status = (err as AxiosLikeError).response?.status
  return typeof status === 'number' && GATEWAY_STATUSES.has(status)
}

export function isTransientError(err: unknown): boolean {
  return isNetworkError(err) || isGatewayError(err)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function withTransientRetry<T>(
  run: () => Promise<T>,
  { retries = 1, delayMs = 700 }: TransientRetryOptions = {},
): Promise<T> {
  let attempt = 0
  for (;;) {
    try {
      return await run()
    } catch (err) {
      if (attempt >= retries || !isTransientError(err)) throw err
      attempt += 1
      if (delayMs > 0) await sleep(delayMs)
    }
  }
}
