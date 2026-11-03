import { describe, expect, it } from 'vitest'
import { CHUNK_RELOAD_WINDOW_MS, isChunkLoadError, isWebpackVersionSkewError, mayReloadForChunkError } from './chunkReload'

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
    expect(s.data['klip.chunkReloadAt']).toBe('1000000')
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

describe('isWebpackVersionSkewError: the old runtime meets a module it does not have', () => {
  const withStack = (message: string, stack: string) => Object.assign(new TypeError(message), { stack })

  it("Chrome: 'reading call' with the failing frame in the webpack runtime", () => {
    const err = withStack(
      "Cannot read properties of undefined (reading 'call')",
      "TypeError: Cannot read properties of undefined (reading 'call')\n    at t (https://klip.example/_next/static/chunks/webpack-8a2c1f9d1b2e3f40.js:1:143)\n    at https://klip.example/_next/static/chunks/app/shipments/page-abc.js:1:900",
    )
    expect(isWebpackVersionSkewError(err)).toBe(true)
    const named = withStack("Cannot read properties of undefined (reading 'call')", "TypeError: x\n    at __webpack_require__ (https://klip.example/x.js:1:1)")
    expect(isWebpackVersionSkewError(named)).toBe(true)
  })

  it("Firefox and Safari wording, also from the webpack runtime", () => {
    expect(
      isWebpackVersionSkewError(
        withStack('can\'t access property "call", modules[moduleId] is undefined', 'o@https://klip.example/_next/static/chunks/webpack-8a2c.js:1:143\nrun@https://klip.example/y.js:1:2'),
      ),
    ).toBe(true)
    expect(
      isWebpackVersionSkewError(
        withStack("undefined is not an object (evaluating 'e[t].call')", 'o@https://klip.example/_next/static/chunks/webpack-8a2c.js:1:143'),
      ),
    ).toBe(true)
  })

  it('the same words thrown by application code are left alone (the app lives under /_next/static/ too, so only the webpack runtime counts)', () => {
    const app = withStack(
      "Cannot read properties of undefined (reading 'call')",
      "TypeError: Cannot read properties of undefined (reading 'call')\n    at onClick (https://klip.example/_next/static/chunks/app/shipments/page-abc.js:1:900)\n    at https://klip.example/_next/static/chunks/main-app-1.js:1:5",
    )
    expect(isWebpackVersionSkewError(app)).toBe(false)
  })

  it('other errors, no stack, and non-errors are left alone', () => {
    expect(isWebpackVersionSkewError(new Error('Request failed with status code 502'))).toBe(false)
    expect(isWebpackVersionSkewError(withStack("Cannot read properties of undefined (reading 'map')", 'at t (https://klip.example/_next/static/chunks/webpack-8a2c.js:1:1)'))).toBe(false)
    expect(isWebpackVersionSkewError({ message: "Cannot read properties of undefined (reading 'call')" })).toBe(false)
    expect(isWebpackVersionSkewError("Cannot read properties of undefined (reading 'call')")).toBe(false)
    expect(isWebpackVersionSkewError(null)).toBe(false)
    expect(isWebpackVersionSkewError(undefined)).toBe(false)
  })
})
