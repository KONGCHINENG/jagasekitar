import { loadEnvConfig } from '@next/env';
import { defineConfig } from '@playwright/test';
import path from 'node:path';

loadEnvConfig(path.resolve(process.cwd(), '../..'));

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
