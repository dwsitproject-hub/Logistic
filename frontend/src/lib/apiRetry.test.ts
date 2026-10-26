import { describe, expect, it, vi } from 'vitest'
import { isNetworkError, withNetworkRetry } from './apiRetry'

const networkError = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' })
const httpError = (status: number) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    code: 'ERR_BAD_RESPONSE',
    response: { status },
  })

describe('isNetworkError', () => {
  it('is true for a request that got no response', () => {
    expect(isNetworkError(networkError())).toBe(true)
    expect(isNetworkError({ message: 'Network Error' })).toBe(true)
  })

  it('is false when the server answered, or the value is not an error', () => {
    expect(isNetworkError(httpError(500))).toBe(false)
    expect(isNetworkError(Object.assign(networkError(), { response: { status: 502 } }))).toBe(false)
    expect(isNetworkError(null)).toBe(false)
    expect(isNetworkError('boom')).toBe(false)
  })
})

describe('withNetworkRetry', () => {
  it('returns the first result without retrying', async () => {
    const run = vi.fn().mockResolvedValue('ok')
    await expect(withNetworkRetry(run, { delayMs: 0 })).resolves.toBe('ok')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('retries once after a network error and returns the second result', async () => {
    const run = vi.fn().mockRejectedValueOnce(networkError()).mockResolvedValueOnce('ok')
    await expect(withNetworkRetry(run, { delayMs: 0 })).resolves.toBe('ok')
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('rethrows when the retry also fails (default is one retry)', async () => {
    const run = vi.fn().mockRejectedValue(networkError())
    await expect(withNetworkRetry(run, { delayMs: 0 })).rejects.toMatchObject({ code: 'ERR_NETWORK' })
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('does not retry an HTTP error', async () => {
    const run = vi.fn().mockRejectedValue(httpError(404))
    await expect(withNetworkRetry(run, { delayMs: 0 })).rejects.toMatchObject({ response: { status: 404 } })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('honours a custom retry count', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce('ok')
    await expect(withNetworkRetry(run, { retries: 2, delayMs: 0 })).resolves.toBe('ok')
    expect(run).toHaveBeenCalledTimes(3)
  })
})
