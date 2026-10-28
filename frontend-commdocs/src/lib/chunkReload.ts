/**
 * Recovery from a ChunkLoadError: a page that was opened before a deploy asks for a hashed script (`/_next/static/chunks/6195-b875790f8ca51e81.js`) that the new
 * build no longer has, or a request for one drops. The page is then half-rendered or blank until it is reloaded, and a reload fetches the current HTML and file names.
 * Sentinel (2026-10-27, /login, one user) proposed the one-time reload this does.
 *
 * ONE reload per CHUNK_RELOAD_WINDOW_MS, remembered in sessionStorage: if the chunk is really gone (not just stale), a second reload would fail the same way and a page
 * that reloaded itself in a loop would be worse than a blank one. With no usable storage there is no way to tell, so it does not reload at all.
 */
const KEY = 'cd.chunkReloadAt'
export const CHUNK_RELOAD_WINDOW_MS = 30_000

/** `ChunkLoadError` by name, or webpack's message ("Loading chunk 6195 failed", "Loading CSS chunk 12 failed"). */
export function isChunkLoadError(reason: unknown): boolean {
  if (!reason) return false
  const r = reason as { name?: unknown; message?: unknown }
  if (r.name === 'ChunkLoadError') return true
  const text = typeof reason === 'string' ? reason : typeof r.message === 'string' ? r.message : ''
  return /loading (css )?chunk [\w-]+ failed/i.test(text)
}

/** Whether a reload may go ahead now; records it when it may. */
export function mayReloadForChunkError(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null | undefined,
  now: number = Date.now(),
): boolean {
  try {
    if (!storage) return false
    const last = Number(storage.getItem(KEY) || 0)
    if (last > 0 && now - last < CHUNK_RELOAD_WINDOW_MS) return false
    storage.setItem(KEY, String(now))
    return true
  } catch {
    return false
  }
}

/** Reloads the page once for a chunk error. Returns whether it did. */
export function reloadForChunkError(): boolean {
  if (typeof window === 'undefined') return false
  let storage: Storage | null = null
  try {
    storage = window.sessionStorage
  } catch {
    return false
  }
  if (!mayReloadForChunkError(storage)) return false
  window.location.reload()
  return true
}
