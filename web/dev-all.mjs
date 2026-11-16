/**
 * `npm run dev:all` — start the Next.js API (:3001), then the Vite UI (:3000); Ctrl+C stops both.
 * API starts first so the browser never opens a flood of proxied /api calls before Prisma is ready.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';

const API_PORT = Number(process.env.WEB_API_PORT ?? 3001);
const API_HOST = process.env.WEB_API_HOST ?? (process.platform === 'win32' ? '127.0.0.1' : 'localhost');

function waitForPort(port, host, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const attempt = () => {
      const socket = net.connect({ port, host, }, () => {
        socket.destroy();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - start >= timeoutMs) {
          reject(new Error(`Timed out waiting for ${host}:${port}`));
          return;
        }
        setTimeout(attempt, 400);
      });
    };
    attempt();
  });
}

function spawnDev({ name, color, cmd, args }) {
  const child = spawn(cmd, args, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, out) =>
    stream.on('data', (buf) =>
      String(buf)
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => out.write(`${prefix}${line}\n`)),
    );
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  return { name, child };
}

const children = [];

let stopping = false;
function stopChild(child) {
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* gone */
    }
  } else {
    try {
      child.kill('SIGTERM');
    } catch {
      /* gone */
    }
  }
}

function stopAll() {
  if (stopping) return;
  stopping = true;
  for (const { child } of children) stopChild(child);
  setTimeout(() => process.exit(0), 500);
}

process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);

console.log(
  `Starting API on http://${API_HOST}:${API_PORT}, then UI on http://${API_HOST}:${process.env.WEB_PORT ?? 3000}`,
);

const api = spawnDev({ name: 'api ', color: '\x1b[36m', cmd: 'npm', args: ['run', 'dev:api'] });
children.push(api);

api.child.on('exit', (code) => {
  console.log(`[${api.name}] exited with code ${code}; stopping the other process`);
  stopAll();
});

try {
  await waitForPort(API_PORT, API_HOST);
  console.log(`[dev-all] API listening on ${API_HOST}:${API_PORT} — starting Vite`);
} catch (err) {
  console.error(`[dev-all] ${(err && err.message) || err}`);
  stopAll();
  process.exit(1);
}

const web = spawnDev({ name: 'web ', color: '\x1b[35m', cmd: 'npm', args: ['run', 'web:dev'] });
children.push(web);

web.child.on('exit', (code) => {
  console.log(`[${web.name}] exited with code ${code}; stopping the other process`);
  stopAll();
});