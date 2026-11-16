#!/usr/bin/env node
/**
 * Platform-aware default for `npm run dev`.
 *
 * - Windows: unified Next on :3000 (production layout; stable RDS over VPN).
 * - macOS/Linux: Vite :3000 + Next API :3001 (faster UI HMR).
 *
 * Override: DEV_SPLIT=1 → Vite split | DEV_UNIFIED=1 → unified everywhere.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const forceSplit = process.env.DEV_SPLIT === '1';
const forceUnified = process.env.DEV_UNIFIED === '1';
const script =
  forceUnified || (!forceSplit && process.platform === 'win32')
    ? path.join(root, 'scripts/dev/unified.mjs')
    : path.join(root, 'web/dev-all.mjs');

if (script.includes('unified')) {
  console.log('[dev] Windows/unified mode — one Next process on :3000 (see docs/windows-dev.md)');
} else {
  console.log('[dev] Split mode — Vite :3000, API :3001');
}

const child = spawn(process.execPath, [script], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => process.exit(code ?? 0));