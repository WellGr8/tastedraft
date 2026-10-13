import type { NextConfig } from 'next';

const publicApi = (process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_API_URL: publicApi,
    NEXT_PUBLIC_API_BASE_URL: publicApi,
  },
  transpilePackages: ['@tastedraft/contracts', '@tastedraft/engine-wasm'],
  reactStrictMode: false,
  devIndicators: false,
  allowedDevOrigins: ['127.0.0.1', 'localhost', '0.0.0.0'],
  webpack: (config) => {
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'asset/resource',
    });
    return config;
  },
};

export default nextConfig;
