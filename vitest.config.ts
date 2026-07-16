import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Repo root (this config's directory), resolved without relying on __dirname
// (unavailable in an ESM config) or import.meta.dirname (newer Node only).
const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
  resolve: {
    // Mirror the tsconfig.json `paths` — most specific first.
    alias: [
      {
        find: /^@\/components\/ui\/(.*)$/,
        replacement: path.resolve(root, 'packages/aloft-shared/src/components/ui') + '/$1',
      },
      {
        find: /^@\/lib\/utils$/,
        replacement: path.resolve(root, 'packages/aloft-shared/src/lib/utils'),
      },
      {
        find: /^@\/(.*)$/,
        replacement: path.resolve(root, 'src') + '/$1',
      },
    ],
  },
});
