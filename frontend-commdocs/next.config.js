/** @type {import('next').NextConfig} */

/**
 * Commercial Documents talks only to the existing KLIP backend. The browser always calls same-origin /api and /auth:
 * - behind Nginx (the normal case) Nginx proxies them to the backend and BACKEND_INTERNAL_URL stays empty;
 * - without Nginx (local dev, or Docker on a bare port) set BACKEND_INTERNAL_URL and Next rewrites them.
 * Rewrites are baked in at BUILD time, so BACKEND_INTERNAL_URL is a Docker build ARG, not a runtime env.
 */
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
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''),
  "connect-src 'self'",
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
