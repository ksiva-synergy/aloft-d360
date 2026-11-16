#!/usr/bin/env node
/**
 * Free Aloft dev ports (:3000 UI, :3001 API) when a previous Windows session left listeners behind.
 *
 *   node scripts/dev/kill-dev-ports.mjs
 *   node scripts/dev/kill-dev-ports.mjs --check   # print listeners only, exit 1 if any
 */
import { execSync } from 'node:child_process';

const ports = [3000, 3001];
const checkOnly = process.argv.includes('--check');

function listenersOnPort(port) {
  if (process.platform !== 'win32') {
    try {
      const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN`, { encoding: 'utf8' }).trim();
      if (!out) return [];
      return out
        .split('\n')
        .slice(1)
        .map((line) => {
          const parts = line.trim().split(/\s+/);
          return { port, pid: Number(parts[1]) };
        })
        .filter((x) => x.pid > 0);
    } catch {
      return [];
    }
  }
  try {
    const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes('LISTENING')) continue;
      if (!line.includes(`:${port}`)) continue;
      const pid = Number(line.trim().split(/\s+/).pop());
      if (pid > 0) pids.add(pid);
    }
    return [...pids].map((pid) => ({ port, pid }));
  } catch {
    return [];
  }
}

const found = ports.flatMap(listenersOnPort);
if (found.length === 0) {
  console.log('[kill-dev-ports] no listeners on :3000 / :3001');
  process.exit(0);
}

for (const { port, pid } of found) {
  console.log(`[kill-dev-ports] port ${port} → PID ${pid}`);
}

if (checkOnly) {
  console.error('[kill-dev-ports] ports in use — run without --check to stop them, or stop `npm run dev` cleanly');
  process.exit(1);
}

for (const { pid } of found) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGTERM');
    }
  } catch {
    /* already gone */
  }
}
console.log('[kill-dev-ports] done');