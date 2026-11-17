/**
 * Vite production build in watch mode → copy `web/dist` to `public/spa` after each build.
 * Use with unified Next on :3000 (`npm run dev` on Windows): keep this running in a second terminal,
 * or let unified.mjs spawn it when DEV_UI_WATCH=1 (default).
 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dist = path.join(root, 'web', 'dist');
const target = path.join(root, 'public', 'spa');

function copyToPublicSpa() {
  if (!existsSync(path.join(dist, 'index.html'))) {
    console.warn('[web:spa:watch] web/dist missing — waiting for first build…');
    return;
  }
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(dist, target, { recursive: true });
  console.log('[web:spa:watch] public/spa updated — hard-refresh the browser');
}

console.log('[web:spa:watch] watching UI → web/dist → public/spa (Ctrl+C to stop)');

const vite = spawn(
  'npx',
  ['vite', 'build', '--watch', '--config', 'web/vite.config.ts'],
  { cwd: root, shell: true, stdio: ['inherit', 'pipe', 'inherit'] },
);

vite.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  if (/\bbuilt in \d/i.test(text) || /✓ built in/i.test(text)) {
    copyToPublicSpa();
  }
});

vite.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => {
  try {
    vite.kill('SIGINT');
  } catch {
    /* */
  }
});
process.on('SIGTERM', () => {
  try {
    vite.kill('SIGTERM');
  } catch {
    /* */
  }
});