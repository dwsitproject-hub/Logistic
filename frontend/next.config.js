/** @type {import('next').NextConfig} */
const backendUrl = process.env.KLIP_BACKEND_URL || 'http://127.0.0.1:5001';

const nextConfig = {
  reactStrictMode: true,
  output: 'standalone', // Enable standalone output for Docker
  images: {
    domains: ['localhost', '127.0.0.1'],
  },
  // Proxy API through Next.js so one port (3001) works with Cursor port-forward
  // and the browser never calls localhost:5001 on the wrong machine.
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
