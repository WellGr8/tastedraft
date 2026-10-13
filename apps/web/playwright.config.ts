import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 90_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'off',
  },
  webServer: [
    {
      command: 'npm run dev',
      cwd: '../api',
      url: 'http://127.0.0.1:8787/api/health',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'npm run dev',
      url: 'http://127.0.0.1:3000',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
