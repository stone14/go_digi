/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  async rewrites() {
    const apiUrl = process.env.API_URL || 'http://localhost:3200';
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
      {
        source: '/health',
        destination: `${apiUrl}/health`,
      },
      {
        source: '/ws',
        destination: `${apiUrl}/ws`,
      },
    ];
  },
}

export default nextConfig
