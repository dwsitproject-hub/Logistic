/** @type {import('next').NextConfig} */
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
}

module.exports = nextConfig
