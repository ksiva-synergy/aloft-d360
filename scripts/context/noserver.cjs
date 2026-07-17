/**
 * Require-hook loaded before script execution via ts-node -r:
 *   1. Loads .env.local then .env for local dev credentials.
 *   2. Stubs `server-only` so it doesn't throw outside the Next.js bundler.
 *   3. Resolves the `@/` path alias to `<project-root>/src/` so ts-node can
 *      import modules that use the Next.js `paths` shorthand without needing
 *      a separate tsconfig-paths setup that requires `baseUrl`.
 *
 * Usage:
 *   npx ts-node --transpile-only \
 *     --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' \
 *     -r ./scripts/context/noserver.cjs <script>
 */
'use strict';

const Module = require('module');
const path = require('path');
const fs = require('fs');

const projectRoot = path.resolve(__dirname, '../..');

// ── 0. Load env files (mirrors Next.js: .env.local overrides .env) ────────────
// DATABASE_URL and DIRECT_URL are always overwritten from .env.local so a stale
// value in the shell environment never silently shadows the correct connection string.
const DB_ALWAYS_OVERRIDE = new Set(['DATABASE_URL', 'DIRECT_URL']);

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // Strip optional surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env) || DB_ALWAYS_OVERRIDE.has(key)) {
      process.env[key] = val;
    }
  }
}

loadEnvFile(path.join(projectRoot, '.env.local'));
loadEnvFile(path.join(projectRoot, '.env'));

// ── 1. Stub server-only ───────────────────────────────────────────────────────
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'server-only') return {};
  return originalLoad.apply(this, arguments);
};

// ── 2. Resolve @/ → src/ ──────────────────────────────────────────────────────
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    const mapped = path.join(projectRoot, 'src', request.slice(2));
    return originalResolveFilename.call(this, mapped, parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
