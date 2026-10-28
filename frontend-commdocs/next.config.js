/** @type {import('next').NextConfig} */

/**
 * Commercial Documents talks only to the existing KLIP backend. The browser always calls same-origin /api and /auth:
 * - behind Nginx (the normal case) Nginx proxies them to the backend and BACKEND_INTERNAL_URL stays empty;
 * - without Nginx (local dev, or Docker on a bare port) set BACKEND_INTERNAL_URL and Next rewrites them.
 * Rewrites are baked in at BUILD time, so BACKEND_INTERNAL_URL is a Docker build ARG, not a runtime env.
 */
/**
 * Downstream Hub SDK origin, or null when the SDK is not configured. Same rule as sdkUrl()/isHubSdkEnabled() in src/lib/hubSdk.ts, which decides
 * whether the root layout renders the script tag - keep the two in step, or the tag is rendered and then blocked.
 *
 * It goes into script-src AND connect-src. KLIP only needs script-src because its connect-src admits any http(s) origin; this app's is 'self',
 * so without it the SDK loads and then every POST to <hub>/api/sdk/v1/collect is refused by the browser.
 *
 * headers() is baked into the routes manifest at BUILD time, like the NEXT_PUBLIC_* values themselves.
 */
function hubSdkOrigin() {
  const raw = String(process.env.NEXT_PUBLIC_HUB_SDK_URL || '').trim()
  const key = String(process.env.NEXT_PUBLIC_HUB_SDK_KEY || '').trim()
  if (!raw || !key) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null
  } catch {
    return null
  }
}

const HUB_SDK_ORIGIN = hubSdkOrigin()

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  // The PDF preview is a blob: URL in an iframe.
  "frame-src 'self' blob:",
  "object-src 'none'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : '') + (HUB_SDK_ORIGIN ? ` ${HUB_SDK_ORIGIN}` : ''),
  "connect-src 'self'" + (HUB_SDK_ORIGIN ? ` ${HUB_SDK_ORIGIN}` : ''),
].join('; ')

module.exports = {
  reactStrictMode: true,
  output: 'standalone',
  poweredByHeader: false,
  experimental: {
    // Same as KLIP: the rewrite proxy must outlast a slow upload or Tanda Terima PDF.
    proxyTimeout: 300_000,
  },
  async rewrites() {
    const backend = String(process.env.BACKEND_INTERNAL_URL || '').trim()
    if (!backend) return []
    const base = backend.replace(/\/$/, '')
    return [
      { source: '/api/:path*', destination: `${base}/api/:path*` },
      { source: '/auth/:path*', destination: `${base}/auth/:path*` },
    ]
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
        ],
      },
    ]
  },
}
