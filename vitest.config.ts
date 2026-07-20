import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Repo root (this config's directory), resolved without relying on __dirname
// (unavailable in an ESM config) or import.meta.dirname (newer Node only).
const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  // @vitejs/plugin-react gives .tsx test/source files the automatic JSX runtime
  // + act() support (Guided Phase 4 DOM harness). It's a transform-only plugin —
  // a no-op for the repo's .ts (non-JSX) tests, so the existing node-env suite is
  // unaffected.
  plugins: [react()],
  test: {
    globals: true,
    // GLOBAL default stays 'node' so the pre-existing pure-logic suite runs
    // exactly as before (no jsdom cost, no server-only surprises). Component
    // render tests opt IN per-file with a `// @vitest-environment jsdom`
    // docblock — see the *.test.tsx files under dashboard-builder/guided.
    environment: 'node',
    // Registers @testing-library/jest-dom matchers (toBeInTheDocument, etc.) and
    // RTL auto-cleanup. Import-time is side-effect-only (expect.extend), so it is
    // safe under the node environment too.
    setupFiles: ['./vitest.setup.ts'],
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
