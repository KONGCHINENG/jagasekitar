import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';
import path from 'node:path';

// The monorepo keeps one .env at the repo root; Next only reads .env files in this folder.
// Next has already loaded (and cached) this folder's env by now, so force a reload from the root.
// Resolved from the working directory: __dirname points into the compiled config at runtime.
loadEnvConfig(
  path.resolve(process.cwd(), '../..'),
  process.env.NODE_ENV !== 'production',
  undefined,
  true,
);

const nextConfig: NextConfig = {
  // Inline the public Supabase settings into every bundle, including proxy.ts.
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  },
  // Workspace packages ship TypeScript source, so Next compiles them.
  transpilePackages: ['@jagasekitar/shared'],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
