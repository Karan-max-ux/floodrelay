/* global process */
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@floodrelay/shared'],
  async rewrites() {
    const backendUrl =
      process.env.BACKEND_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/:path*`,
      },
      {
        source: '/auth/:path*',
        destination: `${backendUrl}/auth/:path*`,
      },
      {
        source: '/auth',
        destination: `${backendUrl}/auth`,
      },
      {
        source: '/requests/:path*',
        destination: `${backendUrl}/requests/:path*`,
      },
      {
        source: '/requests',
        destination: `${backendUrl}/requests`,
      },
      {
        source: '/assignments/:path*',
        destination: `${backendUrl}/assignments/:path*`,
      },
      {
        source: '/assignments',
        destination: `${backendUrl}/assignments`,
      },
      {
        source: '/operations/:path*',
        destination: `${backendUrl}/operations/:path*`,
      },
      {
        source: '/operations',
        destination: `${backendUrl}/operations`,
      },
      {
        source: '/audit/:path*',
        destination: `${backendUrl}/audit/:path*`,
      },
      {
        source: '/audit',
        destination: `${backendUrl}/audit`,
      },
      {
        source: '/forecast/:path*',
        destination: `${backendUrl}/forecast/:path*`,
      },
      {
        source: '/forecast',
        destination: `${backendUrl}/forecast`,
      },
      {
        source: '/health',
        destination: `${backendUrl}/health`,
      },
      {
        source: '/openapi.json',
        destination: `${backendUrl}/openapi.json`,
      },
    ];
  },
};

export default nextConfig;
