import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
