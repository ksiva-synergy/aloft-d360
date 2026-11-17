#!/usr/bin/env node
/**
 * Default `npm run dev`: Vite :3000 + Next API :3001 (HMR, fast UI iteration).
 *
 * Opt into single-process prod-like dev (one Next on :3000): DEV_UNIFIED=1 or npm run dev:unified.
 * See docs/windows-dev.md when remote RDS over VPN flakes with two Node processes.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const unified = process.env.DEV_UNIFIED === '1';
const script = unified
  ? path.join(root, 'scripts/dev/unified.mjs')
  : path.join(root, 'web/dev-all.mjs');

if (unified) {
  console.log('[dev] Unified mode — one Next on :3000 (DEV_UNIFIED=1). See docs/windows-dev.md');
} else {
  console.log('[dev] Split mode — Vite :3000, API :3001 (default)');
}

const child = spawn(process.execPath, [script], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => process.exit(code ?? 0));