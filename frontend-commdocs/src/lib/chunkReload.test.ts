import { describe, expect, it } from 'vitest'
import { CHUNK_RELOAD_WINDOW_MS, isChunkLoadError, mayReloadForChunkError } from './chunkReload'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return {
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v
    },
    data,
  }
}

describe('isChunkLoadError', () => {
  it('knows webpack\'s error by name and by message', () => {
    const named = new Error('x')
    named.name = 'ChunkLoadError'
    expect(isChunkLoadError(named)).toBe(true)
    expect(isChunkLoadError(new Error('Loading chunk 6195 failed.\n(error: http://klip/_next/static/chunks/6195-b875790f8ca51e81.js)'))).toBe(true)
    expect(isChunkLoadError('Uncaught ChunkLoadError: Loading chunk 6195 failed.')).toBe(true)
    expect(isChunkLoadError(new Error('Loading CSS chunk 12 failed.'))).toBe(true)
    expect(isChunkLoadError({ name: 'ChunkLoadError' })).toBe(true)
  })

  it('leaves every other error alone', () => {
    expect(isChunkLoadError(null)).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
    expect(isChunkLoadError('')).toBe(false)
    expect(isChunkLoadError(new Error('Request failed with status code 502'))).toBe(false)
    expect(isChunkLoadError(new TypeError('Failed to fetch'))).toBe(false)
    expect(isChunkLoadError(new Error('Minified React error #423'))).toBe(false)
  })
})

describe('mayReloadForChunkError: one reload, never a loop', () => {
  it('lets the first one through and remembers it', () => {
    const s = memoryStorage()
    expect(mayReloadForChunkError(s, 1_000_000)).toBe(true)
    expect(s.data['cd.chunkReloadAt']).toBe('1000000')
  })

  it('refuses a second one inside the window (the page that comes back after a reload fails the same way)', () => {
    const s = memoryStorage()
    expect(mayReloadForChunkError(s, 1_000_000)).toBe(true)
    expect(mayReloadForChunkError(s, 1_000_000 + CHUNK_RELOAD_WINDOW_MS - 1)).toBe(false)
  })

  it('allows another once the window has passed (a later deploy, a later tab session)', () => {
    const s = memoryStorage()
    expect(mayReloadForChunkError(s, 1_000_000)).toBe(true)
    expect(mayReloadForChunkError(s, 1_000_000 + CHUNK_RELOAD_WINDOW_MS)).toBe(true)
  })

  it('does not reload at all when it cannot remember (no storage, or storage that throws)', () => {
    expect(mayReloadForChunkError(null)).toBe(false)
    expect(mayReloadForChunkError(undefined)).toBe(false)
    const broken = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(mayReloadForChunkError(broken)).toBe(false)
  })
})
