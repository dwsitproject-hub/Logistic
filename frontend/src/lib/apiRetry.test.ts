import { describe, expect, it, vi } from 'vitest'
import { isGatewayError, isNetworkError, isTransientError, withTransientRetry } from './apiRetry'

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

describe('isGatewayError / isTransientError', () => {
  it('treats 502, 503 and 504 as gateway errors', () => {
    for (const status of [502, 503, 504]) {
      expect(isGatewayError(httpError(status))).toBe(true)
      expect(isTransientError(httpError(status))).toBe(true)
    }
  })

  it('does not treat application errors as transient', () => {
    for (const status of [400, 401, 403, 404, 500]) {
      expect(isGatewayError(httpError(status))).toBe(false)
      expect(isTransientError(httpError(status))).toBe(false)
    }
    expect(isGatewayError(null)).toBe(false)
    expect(isGatewayError(networkError())).toBe(false)
  })

  it('a network error is transient', () => {
    expect(isTransientError(networkError())).toBe(true)
  })
})

describe('withTransientRetry', () => {
  it('returns the first result without retrying', async () => {
    const run = vi.fn().mockResolvedValue('ok')
    await expect(withTransientRetry(run, { delayMs: 0 })).resolves.toBe('ok')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('retries once after a network error and returns the second result', async () => {
    const run = vi.fn().mockRejectedValueOnce(networkError()).mockResolvedValueOnce('ok')
    await expect(withTransientRetry(run, { delayMs: 0 })).resolves.toBe('ok')
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('retries once after a 502 from the proxy', async () => {
    const run = vi.fn().mockRejectedValueOnce(httpError(502)).mockResolvedValueOnce('ok')
    await expect(withTransientRetry(run, { delayMs: 0 })).resolves.toBe('ok')
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('rethrows when the retry also fails (default is one retry)', async () => {
    const run = vi.fn().mockRejectedValue(httpError(503))
    await expect(withTransientRetry(run, { delayMs: 0 })).rejects.toMatchObject({ response: { status: 503 } })
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('does not retry an application error', async () => {
    for (const status of [404, 500]) {
      const run = vi.fn().mockRejectedValue(httpError(status))
      await expect(withTransientRetry(run, { delayMs: 0 })).rejects.toMatchObject({ response: { status } })
      expect(run).toHaveBeenCalledTimes(1)
    }
  })

  it('honours a custom retry count', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(httpError(504))
      .mockResolvedValueOnce('ok')
    await expect(withTransientRetry(run, { retries: 2, delayMs: 0 })).resolves.toBe('ok')
    expect(run).toHaveBeenCalledTimes(3)
  })
})
