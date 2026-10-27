/**
 * `npm run dev:all` — start the Next.js API (:3001) and the Vite UI (:3000) together; Ctrl+C stops both.
 * Output of each is prefixed so the two logs stay readable.
 */
import { spawn } from 'node:child_process';

const procs = [
  { name: 'api ', color: '\x1b[36m', cmd: 'npm', args: ['run', 'dev:api'] },
  { name: 'web ', color: '\x1b[35m', cmd: 'npm', args: ['run', 'web:dev'] },
];

const children = procs.map(({ name, color, cmd, args }) => {
  const child = spawn(cmd, args, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const pipe = (stream, out) =>
    stream.on('data', (buf) =>
      String(buf)
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => out.write(`${color}[${name}]\x1b[0m ${line}\n`)),
    );
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`[${name}] exited with code ${code}; stopping the other process`);
    stopAll();
  });
  return child;
});

let stopping = false;
function stopAll() {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    try {
      spawn('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
console.log('Starting the Next.js API on http://localhost:3001 and the Vite UI on http://localhost:3000 (open the 3000 one)');
