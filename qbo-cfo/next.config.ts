import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['pg', 'exceljs', '@react-pdf/renderer'],
  typedRoutes: false,
};

export default nextConfig;
