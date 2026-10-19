/**
 * Builds the Vite UI and copies it to `public/spa`, where the Next.js server serves it (see next.config.ts).
 * Runs automatically before `next build` (npm `prebuild`), so `npm run build` and the Dockerfile need nothing else.
 *
 *   node web/scripts/prepare-spa.mjs            build + copy
 *   WEB_SKIP_BUILD=1 node web/scripts/prepare-spa.mjs   copy an existing web/dist only
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dist = path.join(root, 'web', 'dist');
const target = path.join(root, 'public', 'spa');

if (!process.env.WEB_SKIP_BUILD) {
  const r = spawnSync('npm', ['run', 'web:build'], { cwd: root, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error('prepare-spa: web:build failed');
    process.exit(r.status ?? 1);
  }
}

if (!existsSync(path.join(dist, 'index.html'))) {
  console.error('prepare-spa: web/dist/index.html not found (build the UI first)');
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(dist, target, { recursive: true });
console.log(`prepare-spa: copied web/dist -> public/spa`);
