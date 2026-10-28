/**
 * Downstream Hub SDK bridge - usage analytics, JS-error capture and the "Report a bug" dialog.
 *
 * The same bridge KLIP uses (frontend/src/lib/hubSdk.ts), registered in the Hub as its own application, so this app has its own key, its own
 * Analytic page and its own Sentinel settings. Guide: docs/KLIP-SDK-IMPLEMENTATION.md.
 *
 * Switched off unless BOTH NEXT_PUBLIC_HUB_SDK_URL and NEXT_PUBLIC_HUB_SDK_KEY are set at build time. Off, every function here is a no-op and the
 * root layout renders no script tag, so an environment without the values behaves exactly as it did before the SDK existed.
 *
 * Nothing here may throw or block: analytics must never be the reason a page breaks. Every call is guarded, and the SDK itself is loaded with
 * `defer`, never synchronously - a Hub that is slow or unreachable must not stall the first paint.
 *
 * The env vars are read by their literal names on purpose. Next.js inlines `process.env.NEXT_PUBLIC_*` at build time only when the property is
 * written out literally; `process.env[name]` would ship to the browser as undefined.
 */

/** Same rule as hubSdkOrigin() in next.config.js, which adds the origin to the CSP. Keep in step. */
function sdkUrl(): string | null {
  const raw = String(process.env.NEXT_PUBLIC_HUB_SDK_URL ?? '').trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function sdkKey(): string | null {
  const key = String(process.env.NEXT_PUBLIC_HUB_SDK_KEY ?? '').trim()
  return key || null
}

export function isHubSdkEnabled(): boolean {
  return sdkUrl() !== null && sdkKey() !== null
}

export type HubSdkScriptConfig = {
  src: string
  appKey: string
  /** Git commit the build came from, so Sentinel reads exactly that code. */
  release?: string
  debug: boolean
}

/** What the root layout needs to render the <script> tag, or null when the SDK is off. */
export function hubSdkScriptConfig(): HubSdkScriptConfig | null {
  const src = sdkUrl()
  const appKey = sdkKey()
  if (!src || !appKey) return null
  const release = String(process.env.NEXT_PUBLIC_GIT_SHA ?? '').trim()
  return {
    src,
    appKey,
    release: release || undefined,
    debug: String(process.env.NEXT_PUBLIC_HUB_SDK_DEBUG ?? '').trim().toLowerCase() === 'true',
  }
}

type HubWindow = Window & { DwsHub?: unknown }

/**
 * Calls queued before the SDK script has run. The SDK replays an array of [method, ...args] it finds at window.DwsHub when it starts, which is how
 * a call made while the deferred script is still downloading still lands. Capped, because if the Hub is unreachable the array is never drained.
 */
const MAX_PENDING_CALLS = 20

function callHub(method: string, ...args: unknown[]): void {
  if (typeof window === 'undefined' || !isHubSdkEnabled()) return
  try {
    const w = window as HubWindow
    const hub = w.DwsHub
    if (hub == null) {
      w.DwsHub = [[method, ...args]]
      return
    }
    if (Array.isArray(hub)) {
      hub.push([method, ...args])
      if (hub.length > MAX_PENDING_CALLS) hub.splice(0, hub.length - MAX_PENDING_CALLS)
      return
    }
    // Loaded. Anything without the method is left alone rather than overwritten.
    const fn = (hub as Record<string, unknown>)[method]
    if (typeof fn === 'function') fn.apply(hub, args)
  } catch {
    /* never let analytics break the app */
  }
}

/** Identity last handed to the SDK in this page lifetime, so a repeat is not re-sent. */
let lastIdentity: string | null = null

export type HubIdentityUser = {
  hub_user_id?: string | null
  email?: string | null
}

/**
 * Tell the SDK who is signed in. `id` must be the Hub `sub` (users.hub_oidc_sub, exposed as hub_user_id), never KLIP's own user id - the SDK
 * ignores any other value. A user who signs in with email and password and never came through the Hub has no sub: the email alone is sent and the
 * Hub matches on that.
 *
 * Repeats are dropped on purpose: each identify() makes the SDK send a heartbeat immediately, and the session reloads the user after a password change.
 * A full page reload resets this module and identifies again, which is the "once per page load" the guide asks for.
 */
export function hubIdentify(user: HubIdentityUser | null | undefined): void {
  if (!user) return
  const id = user.hub_user_id ? String(user.hub_user_id).trim() : ''
  const email = user.email ? String(user.email).trim() : ''
  if (!id && !email) return
  const identity = `${id}|${email}`
  if (identity === lastIdentity) return
  if (!isHubSdkEnabled() || typeof window === 'undefined') return
  lastIdentity = identity
  const payload: { id?: string; email?: string } = {}
  if (id) payload.id = id
  if (email) payload.email = email
  callHub('identify', payload)
}

/** On sign-out: forget the user and start a fresh session for whoever signs in next. */
export function hubReset(): void {
  lastIdentity = null
  callHub('reset')
}

/** Allowed by the SDK: up to 80 chars of letters, digits and `_ . : / -`. */
const TRACK_NAME = /^[A-Za-z0-9_.:/-]{1,80}$/

/**
 * Record a business action. Properties are categories and counts only - never personal data, PO numbers, prices or document contents. The values
 * type keeps them to flat primitives so nothing structured slips in by accident.
 */
export function hubTrack(name: string, properties?: Record<string, string | number | boolean | null>): void {
  if (!TRACK_NAME.test(String(name ?? ''))) return
  callHub('track', name, properties)
}

/**
 * Open the SDK's bug-report dialog from this app's own floating button (.bug-fab). The SDK's floating button is hidden (data-bug-button="false" in HubSdkScript): it sits
 * bottom-right at a z-index above every drawer and modal, so it would cover their buttons; the app's own sits below them.
 */
export function hubOpenBugReport(): void {
  callHub('openBugReport')
}

/** Test seam: forget the remembered identity. */
export function __resetHubSdkStateForTests(): void {
  lastIdentity = null
}
