import { afterEach, describe, expect, it, vi } from 'vitest'
import { initialSessionUser } from './authSession'

const stored = { id: 'u1', username: 'ryan', email: 'ryan@example.com', role: 'ADMIN' }

function stubBrowser(userJson: string | null) {
  vi.stubGlobal('window', {})
  vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'user' ? userJson : null) })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('initialSessionUser - what a <Layout> starts with', () => {
  it('is null on the render that hydrates the server HTML, even when a user is cached, so it matches the server\'s "Loading..."', () => {
    stubBrowser(JSON.stringify(stored))
    expect(initialSessionUser(false)).toBeNull()
  })

  it('is the cached user for a Layout that mounts after the app hydrated (a route change), so the shell does not flash', () => {
    stubBrowser(JSON.stringify(stored))
    expect(initialSessionUser(true)).toMatchObject({ id: 'u1', role: 'ADMIN' })
  })

  it('is null with nothing cached or an unreadable cache', () => {
    stubBrowser(null)
    expect(initialSessionUser(true)).toBeNull()
    stubBrowser('{not json')
    expect(initialSessionUser(true)).toBeNull()
  })

  it('is null on the server, where there is no window', () => {
    expect(initialSessionUser(true)).toBeNull()
  })
})
