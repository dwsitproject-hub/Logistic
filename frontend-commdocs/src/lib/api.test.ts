import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiBlob, apiJson } from './api'

const ok = (data: unknown = { ok: true }) => new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
const status = (code: number) => new Response('<html>502 Bad Gateway</html>', { status: code })

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** Runs a call to its end with the retry pause skipped. */
async function settle<T>(call: Promise<T>): Promise<T> {
  const done = call.then(
    (v) => ({ v }),
    (e) => ({ e }),
  )
  await vi.advanceTimersByTimeAsync(1000)
  const r = (await done) as { v?: T; e?: unknown }
  if ('e' in r) throw r.e
  return r.v as T
}

describe('a GET is tried once more after a transient failure', () => {
  it('a 502 from the proxy, then the answer: the user never sees the 502', async () => {
    fetchMock.mockResolvedValueOnce(status(502)).mockResolvedValueOnce(ok({ n: 1 }))
    const res = await settle(apiJson('/commercial-documents/files/1001032563'))
    expect(res.data).toEqual({ n: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('503 and 504 are retried too', async () => {
    for (const code of [503, 504]) {
      fetchMock.mockReset()
      fetchMock.mockResolvedValueOnce(status(code)).mockResolvedValueOnce(ok())
      await settle(apiJson('/x'))
      expect(fetchMock).toHaveBeenCalledTimes(2)
    }
  })

  it('a dropped connection (fetch rejects with a TypeError) is retried', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(ok())
    await settle(apiJson('/x'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a file view (apiBlob) gets the same second try', async () => {
    fetchMock.mockResolvedValueOnce(status(502)).mockResolvedValueOnce(new Response('%PDF-1.4', { status: 200 }))
    const { blob } = await settle(apiBlob('/commercial-documents/file/1/view'))
    expect(blob.size).toBe(8)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('only ONE retry: two 502s in a row are reported, with the plain message', async () => {
    fetchMock.mockResolvedValue(status(502))
    const err = await settle(apiJson('/x')).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(502)
    expect((err as ApiError).message).toContain('not reachable')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('what is NOT retried', () => {
  it('an answer from the application itself (404, 500) is returned as it is', async () => {
    for (const code of [404, 500]) {
      fetchMock.mockReset()
      fetchMock.mockResolvedValue(status(code))
      await settle(apiJson('/x')).catch(() => undefined)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })

  it('a POST, PUT or DELETE is never repeated: it could repeat its side effect', async () => {
    for (const method of ['POST', 'PUT', 'DELETE'] as const) {
      fetchMock.mockReset()
      fetchMock.mockResolvedValue(status(502))
      await settle(apiJson('/x', { method, body: {} })).catch(() => undefined)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })

  it('a cancelled request (AbortError) is not retried', async () => {
    fetchMock.mockRejectedValue(new DOMException('Aborted', 'AbortError'))
    const err = await settle(apiJson('/x')).catch((e) => e)
    expect((err as Error).name).toBe('AbortError')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a request cancelled during the pause does not go out a second time', async () => {
    const ctrl = new AbortController()
    fetchMock.mockImplementationOnce(async () => {
      queueMicrotask(() => ctrl.abort())
      return status(502)
    })
    const err = await settle(apiJson('/x', { signal: ctrl.signal })).catch((e) => e)
    expect((err as Error).name).toBe('AbortError')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
