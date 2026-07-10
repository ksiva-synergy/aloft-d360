import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/components/ui/*.tsx',
    'src/lib/utils.ts',
  ],
  format: ['cjs', 'esm'],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ['react', 'react-dom', 'react-day-picker', /^@\/components\/ui\//],
  banner: {
    js: '"use client";',
  },
});
