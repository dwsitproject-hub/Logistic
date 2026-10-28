import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetHubSdkStateForTests,
  hubIdentify,
  hubOpenBugReport,
  hubReset,
  hubSdkScriptConfig,
  hubTrack,
  isHubSdkEnabled,
} from './hubSdk'

const URL_ = 'http://test-dwshub.kpndomain.com/api/sdk/v1/hub-sdk.js'
const KEY = 'dwsk_test_key'

type W = { DwsHub?: unknown }
let win: W

function enable() {
  vi.stubEnv('NEXT_PUBLIC_HUB_SDK_URL', URL_)
  vi.stubEnv('NEXT_PUBLIC_HUB_SDK_KEY', KEY)
}

function loadedSdk() {
  const sdk = { identify: vi.fn(), reset: vi.fn(), track: vi.fn() }
  win.DwsHub = sdk
  return sdk
}

beforeEach(() => {
  win = {}
  vi.stubGlobal('window', win)
  vi.stubEnv('NEXT_PUBLIC_HUB_SDK_URL', '')
  vi.stubEnv('NEXT_PUBLIC_HUB_SDK_KEY', '')
  vi.stubEnv('NEXT_PUBLIC_GIT_SHA', '')
  vi.stubEnv('NEXT_PUBLIC_HUB_SDK_DEBUG', '')
  __resetHubSdkStateForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/**
 * The guarantee that makes this safe to merge: with no env values, nothing changes. No script
 * tag, and not even a stray window.DwsHub array left behind by a call that had nowhere to go.
 */
describe('hub SDK — switched off', () => {
  it('is off unless both URL and key are set', () => {
    expect(isHubSdkEnabled()).toBe(false)
    vi.stubEnv('NEXT_PUBLIC_HUB_SDK_URL', URL_)
    expect(isHubSdkEnabled()).toBe(false)
    vi.stubEnv('NEXT_PUBLIC_HUB_SDK_URL', '')
    vi.stubEnv('NEXT_PUBLIC_HUB_SDK_KEY', KEY)
    expect(isHubSdkEnabled()).toBe(false)
  })

  it('renders no script tag', () => {
    expect(hubSdkScriptConfig()).toBeNull()
  })

  it('touches nothing on window', () => {
    hubIdentify({ hub_user_id: 'abc', email: 'a@b.c' })
    hubReset()
    hubTrack('document_uploaded')
    expect(win.DwsHub).toBeUndefined()
  })

  it('treats a URL that is not http(s) as unset', () => {
    vi.stubEnv('NEXT_PUBLIC_HUB_SDK_KEY', KEY)
    vi.stubEnv('NEXT_PUBLIC_HUB_SDK_URL', 'not a url')
    expect(isHubSdkEnabled()).toBe(false)
    vi.stubEnv('NEXT_PUBLIC_HUB_SDK_URL', 'javascript:alert(1)')
    expect(isHubSdkEnabled()).toBe(false)
  })
})

describe('hub SDK — script tag config', () => {
  it('carries src, key, release and debug', () => {
    enable()
    vi.stubEnv('NEXT_PUBLIC_GIT_SHA', '3ef9e097')
    vi.stubEnv('NEXT_PUBLIC_HUB_SDK_DEBUG', 'true')
    expect(hubSdkScriptConfig()).toEqual({ src: URL_, appKey: KEY, release: '3ef9e097', debug: true })
  })

  it('omits release when the build has no SHA, and debug defaults off', () => {
    enable()
    expect(hubSdkScriptConfig()).toEqual({ src: URL_, appKey: KEY, release: undefined, debug: false })
  })
})

describe('hub SDK — identify', () => {
  beforeEach(enable)

  it('sends the Hub sub as id, with the email', () => {
    const sdk = loadedSdk()
    hubIdentify({ hub_user_id: 'sub-1', email: 'a@b.c' })
    expect(sdk.identify).toHaveBeenCalledWith({ id: 'sub-1', email: 'a@b.c' })
  })

  it('sends the email alone when the user has no Hub sub', () => {
    const sdk = loadedSdk()
    hubIdentify({ hub_user_id: null, email: 'a@b.c' })
    expect(sdk.identify).toHaveBeenCalledWith({ email: 'a@b.c' })
  })

  it('sends nothing when there is neither', () => {
    const sdk = loadedSdk()
    hubIdentify({ hub_user_id: null, email: '' })
    hubIdentify(null)
    expect(sdk.identify).not.toHaveBeenCalled()
  })

  it('does not re-send the same identity on every route change', () => {
    const sdk = loadedSdk()
    hubIdentify({ hub_user_id: 'sub-1', email: 'a@b.c' })
    hubIdentify({ hub_user_id: 'sub-1', email: 'a@b.c' })
    hubIdentify({ hub_user_id: 'sub-1', email: 'a@b.c' })
    expect(sdk.identify).toHaveBeenCalledTimes(1)
  })

  it('does send when the person changes', () => {
    const sdk = loadedSdk()
    hubIdentify({ hub_user_id: 'sub-1', email: 'a@b.c' })
    hubIdentify({ hub_user_id: 'sub-2', email: 'd@e.f' })
    expect(sdk.identify).toHaveBeenCalledTimes(2)
  })
})

describe('hub SDK — reset', () => {
  beforeEach(enable)

  it('calls reset, and lets the same person be identified again after signing back in', () => {
    const sdk = loadedSdk()
    hubIdentify({ hub_user_id: 'sub-1', email: 'a@b.c' })
    hubReset()
    hubIdentify({ hub_user_id: 'sub-1', email: 'a@b.c' })
    expect(sdk.reset).toHaveBeenCalledTimes(1)
    expect(sdk.identify).toHaveBeenCalledTimes(2)
  })
})

/**
 * The SDK loads with `defer`, so the app can ask for identify() before it has run. Those calls go
 * into the array the SDK replays on start — in order, so identify → reset → identify survives.
 */
describe('hub SDK — before the script has loaded', () => {
  beforeEach(enable)

  it('queues calls in order for the SDK to replay', () => {
    hubIdentify({ hub_user_id: 'sub-1', email: 'a@b.c' })
    hubReset()
    hubTrack('document_uploaded', { format: 'xlsx' })
    expect(win.DwsHub).toEqual([
      ['identify', { id: 'sub-1', email: 'a@b.c' }],
      ['reset'],
      ['track', 'document_uploaded', { format: 'xlsx' }],
    ])
  })

  it('caps the queue, so an unreachable Hub cannot grow it without limit', () => {
    for (let i = 0; i < 50; i += 1) hubTrack(`action_${i}`)
    const q = win.DwsHub as unknown[][]
    expect(q).toHaveLength(20)
    expect(q[q.length - 1]).toEqual(['track', 'action_49', undefined])
  })

  it('never overwrites a loaded SDK that lacks a method', () => {
    const partial = { identify: vi.fn() }
    win.DwsHub = partial
    hubTrack('document_uploaded')
    expect(win.DwsHub).toBe(partial)
  })
})

describe('hub SDK — must never break the app', () => {
  beforeEach(enable)

  it('swallows an SDK that throws', () => {
    win.DwsHub = {
      identify: () => { throw new Error('boom') },
      reset: () => { throw new Error('boom') },
      track: () => { throw new Error('boom') },
    }
    expect(() => hubIdentify({ hub_user_id: 'sub-1', email: 'a@b.c' })).not.toThrow()
    expect(() => hubReset()).not.toThrow()
    expect(() => hubTrack('document_uploaded')).not.toThrow()
  })

  it('is inert on the server', () => {
    vi.stubGlobal('window', undefined)
    expect(() => hubIdentify({ hub_user_id: 'sub-1', email: 'a@b.c' })).not.toThrow()
    expect(() => hubReset()).not.toThrow()
  })
})

/**
 * The SDK's floating button is hidden here — it would cover the "N POs selected" bar
 * — and the dialog opens from a sidebar button instead.
 */
describe('hub SDK — bug report from the sidebar', () => {
  it('opens the SDK dialog when configured', () => {
    enable()
    const sdk = { openBugReport: vi.fn() }
    win.DwsHub = sdk
    hubOpenBugReport()
    expect(sdk.openBugReport).toHaveBeenCalledTimes(1)
  })

  it('queues the open if clicked before the SDK has loaded', () => {
    enable()
    hubOpenBugReport()
    expect(win.DwsHub).toEqual([['openBugReport']])
  })

  it('does nothing when the SDK is off', () => {
    hubOpenBugReport()
    expect(win.DwsHub).toBeUndefined()
  })
})

describe('hub SDK — track names', () => {
  beforeEach(enable)

  it('accepts the SDK naming rule and drops anything else', () => {
    const sdk = loadedSdk()
    hubTrack('document_uploaded')
    hubTrack('sap.import:started/v2-x')
    hubTrack('has spaces')
    hubTrack('')
    hubTrack('x'.repeat(81))
    expect(sdk.track).toHaveBeenCalledTimes(2)
  })
})
