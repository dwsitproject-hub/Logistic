/** @type {import('next').NextConfig} */

/**
 * UI security headers (VA Medium: CSP + anti-clickjacking).
 * API responses already get Helmet headers from the Express backend.
 * Keep CSP permissive enough for Next.js App Router (inline styles/scripts).
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "connect-src 'self' http: https: ws: wss:",
].join('; ')

const nextConfig = {
  reactStrictMode: true,
  output: 'standalone', // Enable standalone output for Docker
  images: {
    domains: ['localhost'],
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001/api',
    NEXT_PUBLIC_ATTENTION_INSIGHTS_ENABLED:
      process.env.NEXT_PUBLIC_ATTENTION_INSIGHTS_ENABLED ?? 'false',
  },
  /**
   * When BACKEND_INTERNAL_URL is set at build time (Docker + host port 80 without Nginx),
   * proxy /api/* to the real backend so NEXT_PUBLIC_API_URL=/api works from the browser.
   * If you use Nginx on port 80 → 127.0.0.1:3001, leave BACKEND_INTERNAL_URL empty.
   */
  async rewrites() {
    const backend = process.env.BACKEND_INTERNAL_URL
    if (!backend || String(backend).trim() === '') return []
    const base = String(backend).replace(/\/$/, '')
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

module.exports = nextConfig
