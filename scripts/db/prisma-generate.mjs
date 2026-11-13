/**
 * Prisma generate with Windows-friendly dev-server handling.
 *
 *   node scripts/db/prisma-generate.mjs
 *   node scripts/db/prisma-generate.mjs --stop-dev   # stop this repo's next/vite/dev-all, generate, exit
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const clientDir = path.join(root, 'node_modules', '.prisma', 'client');
const stopDev = process.argv.includes('--stop-dev');

function cleanTmpEngines() {
  if (!existsSync(clientDir)) return;
  for (const name of readdirSync(clientDir)) {
    if (
      name.startsWith('query_engine-windows') &&
      (name.includes('.tmp') || name.endsWith('.tmp'))
    ) {
      try {
        unlinkSync(path.join(clientDir, name));
      } catch {
        /* locked or gone */
      }
    }
  }
}

function listNodeProcesses() {
  if (process.platform !== 'win32') return [];
  try {
    const raw = execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name = 'node.exe'\\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"`,
      { encoding: 'utf8', cwd: root },
    ).trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function aloftDevPids() {
  const rootNorm = root.replace(/\//g, '\\').toLowerCase();
  return listNodeProcesses()
    .filter((p) => {
      const cmd = (p.CommandLine ?? '').toLowerCase();
      if (!cmd.includes('aloft-ui-redesign'.replace(/\//g, '\\'))) {
        if (!cmd.includes(rootNorm)) return false;
      }
      return (
        cmd.includes('next') ||
        cmd.includes('dev-all.mjs') ||
        cmd.includes('vite.js') ||
        cmd.includes('next\\dist\\server')
      );
    })
    .map((p) => Number(p.ProcessId))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function stopAloftDevServers() {
  const pids = [...new Set(aloftDevPids())];
  if (pids.length === 0) {
    console.log('[prisma-generate] no aloft-ui-redesign dev node processes found');
    return;
  }
  console.log(`[prisma-generate] stopping dev node PIDs: ${pids.join(', ')}`);
  for (const pid of pids) {
    try {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    } catch {
      /* already exited */
    }
  }
  execSync('powershell -NoProfile -Command "Start-Sleep -Seconds 2"');
}

if (stopDev) stopAloftDevServers();
cleanTmpEngines();

const result = spawnSync('npx', ['prisma', 'generate', '--schema=./prisma/schema.prisma'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

if ((result.status ?? 1) !== 0 && process.platform === 'win32' && !stopDev) {
  const dev = aloftDevPids();
  console.error('\n[prisma-generate] prisma generate failed.');
  if (dev.length > 0) {
    console.error(
      `[prisma-generate] ${dev.length} local dev process(es) may be locking query_engine-windows.dll.node.`,
    );
    console.error('[prisma-generate] Stop npm run dev / dev-all, or run:');
    console.error('  node scripts/db/prisma-generate.mjs --stop-dev');
  }
}

process.exit(result.status ?? 1);
