import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Unit tests for the Vite UI (`npm run web:test`). Same aliases as web/vite.config.ts, jsdom by default. */
const webDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webDir, '..');

export default defineConfig({
  root: repoRoot,
  plugins: [react()],
  define: {
    'process.env.NEXTAUTH_URL': 'undefined',
    'process.env.NEXTAUTH_URL_INTERNAL': 'undefined',
    'process.env.VERCEL_URL': 'undefined',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [path.resolve(repoRoot, 'vitest.setup.ts')],
    include: [
      'web/src/**/*.{test,spec}.{ts,tsx}',
      'src/lib/theme/**/*.{test,spec}.{ts,tsx}',
      'src/lib/navigation/**/*.{test,spec}.{ts,tsx}',
    ],
    testTimeout: 60_000,
  },
  resolve: {
    alias: [
      { find: /^@\/components\/ui\/(.*)$/, replacement: path.resolve(repoRoot, 'packages/aloft-shared/src/components/ui') + '/$1' },
      { find: /^@\/lib\/utils$/, replacement: path.resolve(repoRoot, 'packages/aloft-shared/src/lib/utils') },
      { find: /^@\/(.*)$/, replacement: path.resolve(repoRoot, 'src') + '/$1' },
    ],
  },
});
