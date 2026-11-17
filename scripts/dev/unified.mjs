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
/** Entra treats localhost and 127.0.0.1 as different redirect URIs — default OAuth to localhost. */
const oauthHost = process.env.DEV_OAUTH_HOST ?? 'localhost';

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
  const skip = process.env.DEV_SKIP_SPA_BUILD === '1';
  const watch = process.env.DEV_UI_WATCH !== '0';
  if (existsSync(spaIndex) && !force) {
    if (skip || watch) {
      console.log(
        watch
          ? '[dev:unified] using existing public/spa — UI watch will rebuild after saves'
          : '[dev:unified] DEV_SKIP_SPA_BUILD: skipping UI build (run npm run web:spa if the UI is missing)',
      );
      return;
    }
    const stale = spaSourceNewerThanBundle();
    if (!stale) {
      console.log('[dev:unified] serving existing public/spa (WEB_FORCE_BUILD=1 to rebuild UI)');
      return;
    }
    console.log('[dev:unified] UI source is newer than public/spa — one-time rebuild…');
  }
  console.log('[dev:unified] building UI → public/spa…');
  const r = spawnSync('node', ['web/scripts/prepare-spa.mjs'], { cwd: root, stdio: 'inherit', env: process.env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

ensureSpa();

const watchUi = process.env.DEV_UI_WATCH !== '0';
/** @type {import('node:child_process').ChildProcess | null} */
let uiWatchChild = null;
if (watchUi) {
  console.log('[dev:unified] UI watch on — save React/TS/CSS files, then hard-refresh');
  uiWatchChild = spawn('node', ['web/scripts/watch-spa.mjs'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
} else {
  console.log('[dev:unified] UI watch off — after edits run `npm run dev:ui` or `npm run web:spa`, then refresh');
}

const nextAuth =
  process.env.NEXTAUTH_URL ??
  process.env.NEXTAUTH_URL_INTERNAL ??
  `http://${oauthHost}:${port}`;

if (
  (process.env.NEXTAUTH_URL ?? process.env.NEXTAUTH_URL_INTERNAL)?.includes('127.0.0.1')
) {
  console.warn(
    '[dev:unified] NEXTAUTH_URL uses 127.0.0.1 — Entra usually registers localhost instead. ' +
      `Set NEXTAUTH_URL=http://${oauthHost}:${port} and sign in at that URL.`,
  );
}

console.log(`[dev:unified] Next.js (webpack) at http://${host}:${port} — API + SPA, one process`);
console.log(`[dev:unified] Microsoft sign-in callback: ${nextAuth}/api/auth/callback/azure-ad`);
console.log(`[dev:unified] Open the app at ${nextAuth} (same host as NEXTAUTH_URL)`);
console.log('[dev:unified] UI: save files → watch copies to public/spa → hard-refresh (:3000). Instant HMR: npm run dev:split');

function loopbackToLocalhost(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (u.hostname === '127.0.0.1' || u.hostname === '[::1]' || u.hostname === '::1') {
      u.hostname = 'localhost';
      return u.origin;
    }
    return url.replace(/\/$/, '') === u.href ? u.origin : u.toString();
  } catch {
    return url;
  }
}

const childEnv = { ...process.env, PORT: port, HOSTNAME: host, NEXTAUTH_URL: nextAuth };
childEnv.NEXTAUTH_URL = loopbackToLocalhost(childEnv.NEXTAUTH_URL ?? nextAuth);
if (childEnv.NEXTAUTH_URL_INTERNAL) {
  childEnv.NEXTAUTH_URL_INTERNAL = loopbackToLocalhost(childEnv.NEXTAUTH_URL_INTERNAL);
}

const child = spawn('npx', ['next', 'dev', '--webpack', '-p', port], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: childEnv,
});

child.on('exit', (code) => process.exit(code ?? 0));
function stopAll() {
  try {
    child.kill('SIGINT');
  } catch {
    /* */
  }
  if (uiWatchChild) {
    try {
      uiWatchChild.kill('SIGINT');
    } catch {
      /* */
    }
  }
}
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);