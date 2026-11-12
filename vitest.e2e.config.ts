/**
 * End-to-end tests against the dev database (real routes, real Prisma; only sign-in is simulated).
 * Never part of the normal run. Needs DATABASE_URL for dev:
 *
 *   node --env-file=.env node_modules/vitest/vitest.mjs run --config vitest.e2e.config.ts
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import base from './vitest.config';

const root = fileURLToPath(new URL('.', import.meta.url));
const baseAliases = (base.resolve?.alias ?? []) as { find: string | RegExp; replacement: string }[];

export default defineConfig({
  plugins: base.plugins,
  resolve: {
    // Server modules import 'server-only'; in these Node tests it is an empty module.
    alias: [{ find: /^server-only$/, replacement: path.resolve(root, 'e2e/server-only-stub.ts') }, ...baseAliases],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['e2e/**/*.e2e.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
