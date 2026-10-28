/**
 * Thin fetch client for the KLIP backend. Every call is same-origin (/api/...), proxied by Nginx or by the Next rewrite.
 *
 * Auth: the backend accepts its session cookie (klip.sid) or `Authorization: Bearer <jwt>`. We send both, like KLIP does:
 * the token from login is kept in localStorage, and `credentials: 'include'` carries the cookie.
 *
 * Responses use the backend envelope `{ success, data, message }` / `{ success: false, error: { message } }`.
 */

const TOKEN_KEY = 'cd.token'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* private mode: the session cookie still works */
  }
}

/** Called when a signed-in call comes back 401 (session expired / token revoked). Set by the session provider. */
let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler
}

export type QueryValue = string | number | boolean | null | undefined | Array<string | number>

/** Builds `?a=1&b=x&b=y` - arrays repeat the key, which is what the backend reads as a list. Empty values are left out. */
export function toQuery(params: Record<string, QueryValue>): string {
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue
    if (Array.isArray(value)) value.forEach((v) => sp.append(key, String(v)))
    else sp.append(key, String(value))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
  /**
   * A 401 here means "wrong credentials", not "signed out" (login, change password with a wrong current password).
   * Without this flag a 401 signs the user out.
   */
  expectAuthError?: boolean
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let body: BodyInit | undefined
  if (options.body instanceof FormData) {
    body = options.body
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }
  const res = await fetch(`/api${path}`, {
    method: options.method || 'GET',
    headers,
    body,
    credentials: 'include',
    signal: options.signal,
  })
  if (res.status === 401 && !options.expectAuthError && onUnauthorized) onUnauthorized()
  return res
}

/** A gateway answer from the reverse proxy while the backend restarts. */
const GATEWAY_STATUSES = new Set([502, 503, 504])
const RETRY_DELAY_MS = 700

/**
 * send(), and for a GET only, one more try after a dropped connection (fetch rejects with a TypeError) or a 502 / 503 / 504 from the proxy. A backend restart
 * during a deploy answered the files and history requests of an open document with an HTML 502 page, and the user saw an error for something a second try would
 * have fetched (Sentinel, 2026-10-21, on the old KLIP page). Any other answer, including a 4xx or 500, is the application's own and is returned as it is. A POST,
 * PUT or DELETE is never repeated: it could repeat its side effect.
 */
async function sendWithRetry(path: string, options: RequestOptions): Promise<Response> {
  if ((options.method || 'GET') !== 'GET') return send(path, options)
  try {
    const res = await send(path, options)
    if (!GATEWAY_STATUSES.has(res.status)) return res
  } catch (err) {
    if (!(err instanceof TypeError)) throw err
  }
  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  return send(path, options)
}

async function errorFrom(res: Response): Promise<ApiError> {
  let message = `Request failed (${res.status})`
  try {
    const json = await res.json()
    message = json?.error?.message || json?.message || message
  } catch {
    /* not JSON (a proxy error page) */
  }
  if (res.status === 429 && message.startsWith('Request failed')) {
    message = 'Too many requests. Please wait a moment and try again.'
  }
  if (res.status >= 502 && res.status <= 504) {
    message = 'The server is not reachable right now. Please try again in a moment.'
  }
  return new ApiError(message, res.status)
}

/** JSON call; resolves to the whole envelope so callers can read `data` and `message`. */
export async function apiJson<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<{ success: boolean; data: T; message?: string }> {
  const res = await sendWithRetry(path, options)
  if (!res.ok) throw await errorFrom(res)
  return res.json()
}

/** Shortcut for the `data` of a JSON call. */
export async function apiData<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  return (await apiJson<T>(path, options)).data
}

/** Binary call (file view/download, Tanda Terima PDF). Errors still come back as JSON. */
export async function apiBlob(
  path: string,
  options: RequestOptions = {},
): Promise<{ blob: Blob; fileName: string | null }> {
  const res = await sendWithRetry(path, options)
  if (!res.ok) throw await errorFrom(res)
  return { blob: await res.blob(), fileName: fileNameFromDisposition(res.headers.get('Content-Disposition')) }
}

export function fileNameFromDisposition(header: string | null): string | null {
  if (!header) return null
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header)
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''))
    } catch {
      /* fall through to the plain filename */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header)
  return plain ? plain[1].trim() : null
}

export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof ApiError) return err.message
  if (isAbort(err)) return ''
  if (err instanceof TypeError) return 'Cannot reach the server. Check your connection and try again.'
  return fallback
}

export function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}
