#!/usr/bin/env node
/**
 * Single-process local dev — same layout as production/Docker:
 *   Next.js on :3000 serves /api/** and the built SPA from public/spa.
 *
 * No Vite dev server, no :3001 proxy, one Prisma pool. Recommended on Windows
 * when remote RDS over VPN flakes with the split dev setup.
 *
 * After editing UI code: `npm run web:build` then refresh (or set WEB_FORCE_BUILD=1).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const spaIndex = path.join(root, 'public', 'spa', 'index.html');
const port = String(process.env.PORT ?? process.env.WEB_PORT ?? 3000);
const host = process.env.DEV_HOST ?? '127.0.0.1';

function ensureSpa() {
  if (existsSync(spaIndex) && process.env.WEB_FORCE_BUILD !== '1') {
    console.log('[dev:unified] serving existing public/spa (WEB_FORCE_BUILD=1 to rebuild UI)');
    return;
  }
  console.log('[dev:unified] building UI → public/spa…');
  const r = spawnSync('node', ['web/scripts/prepare-spa.mjs'], { cwd: root, stdio: 'inherit', env: process.env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

ensureSpa();

const nextAuth =
  process.env.NEXTAUTH_URL ??
  process.env.NEXTAUTH_URL_INTERNAL ??
  `http://${host}:${port}`;

console.log(`[dev:unified] Next.js (webpack) at http://${host}:${port} — API + SPA, one process`);
console.log('[dev:unified] UI hot reload: run `npm run web:build` in another terminal, then refresh');

const child = spawn('npx', ['next', 'dev', '--webpack', '-p', port], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    PORT: port,
    HOSTNAME: host,
    NEXTAUTH_URL: nextAuth,
  },
});

child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => {
  try {
    child.kill('SIGINT');
  } catch {
    /* */
  }
});
process.on('SIGTERM', () => {
  try {
    child.kill('SIGTERM');
  } catch {
    /* */
  }
});