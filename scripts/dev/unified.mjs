#!/usr/bin/env node
/**
 * Single-process local dev — same layout as production/Docker:
 *   Next.js on :3000 serves /api/** and the built SPA from public/spa.
 *
 * No Vite dev server, no :3001 proxy, one Prisma pool. Recommended on Windows
 * when remote RDS over VPN flakes with the split dev setup.
 *
 * After editing UI code: `npm run web:spa` (build + copy to public/spa) then refresh,
 * or restart with WEB_FORCE_BUILD=1. `npm run web:build` alone only writes web/dist.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const spaIndex = path.join(root, 'public', 'spa', 'index.html');
const port = String(process.env.PORT ?? process.env.WEB_PORT ?? 3000);
const host = process.env.DEV_HOST ?? '127.0.0.1';

/** Newest mtime under `dir` (bounded depth) — detects UI edits newer than public/spa. */
function newestMtime(dir, depth = 0, maxDepth = 5) {
  if (!existsSync(dir)) return 0;
  let newest = statSync(dir).mtimeMs;
  if (depth >= maxDepth) return newest;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (name.name === 'node_modules' || name.name === '.git') continue;
    const full = path.join(dir, name.name);
    if (name.isDirectory()) newest = Math.max(newest, newestMtime(full, depth + 1, maxDepth));
    else if (/\.(tsx?|jsx?|css)$/.test(name.name)) newest = Math.max(newest, statSync(full).mtimeMs);
  }
  return newest;
}

function spaSourceNewerThanBundle() {
  if (!existsSync(spaIndex)) return true;
  const built = statSync(spaIndex).mtimeMs;
  const uiRoots = [
    path.join(root, 'web', 'src'),
    path.join(root, 'src', 'views'),
    path.join(root, 'src', 'components'),
    path.join(root, 'src', 'lib', 'estate'),
  ];
  return uiRoots.some((d) => newestMtime(d) > built);
}

function ensureSpa() {
  const force = process.env.WEB_FORCE_BUILD === '1';
  const stale = spaSourceNewerThanBundle();
  if (existsSync(spaIndex) && !force && !stale) {
    console.log('[dev:unified] serving existing public/spa (WEB_FORCE_BUILD=1 to rebuild UI)');
    return;
  }
  if (stale && !force) {
    console.log('[dev:unified] UI source is newer than public/spa — rebuilding…');
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
console.log('[dev:unified] UI is the prebuilt public/spa — after UI changes run `npm run web:spa`, then refresh');

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