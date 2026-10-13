import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@tastedraft/contracts', '@tastedraft/engine-wasm'],
  reactStrictMode: false,
  webpack: (config) => {
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'asset/resource',
    });
    return config;
  },
};

export default nextConfig;
