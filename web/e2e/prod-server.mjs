/**
 * Minimal stand-in for "Next.js serving the Vite build" (WEB_UI=vite): static assets under /spa/, index.html for
 * every page URL, /api proxied to the real API when it is running. Used by the production-bundle e2e run.
 */
import { createServer, request as httpRequest } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const pub = path.resolve(dist, '../../public');
const port = Number(process.env.PORT ?? 4180);
const api = new URL(process.env.WEB_API_TARGET ?? 'http://localhost:3001');
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.json': 'application/json', '.ico': 'image/x-icon' };

function send(res, file) {
  const ext = path.extname(file);
  const isIndex = file.endsWith('index.html');
  res.writeHead(200, {
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'Cache-Control': isIndex ? 'no-cache, no-store, must-revalidate' : file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
  });
  createReadStream(file).pipe(res);
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  if (p.startsWith('/api/')) {
    const up = httpRequest({ host: api.hostname, port: api.port, path: req.url, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on('error', () => { res.writeHead(502); res.end('api unavailable'); });
    req.pipe(up);
    return;
  }
  if (p.startsWith('/spa/')) {
    const f = path.join(dist, p.slice('/spa/'.length));
    if (f.startsWith(dist) && existsSync(f) && statSync(f).isFile()) return send(res, f);
    res.writeHead(404); return res.end('not found');
  }
  const pf = path.join(pub, p);
  if (p !== '/' && pf.startsWith(pub) && existsSync(pf) && statSync(pf).isFile()) return send(res, pf);
  if (/\.[a-z0-9]+$/i.test(p)) { res.writeHead(404); return res.end('not found'); }
  send(res, path.join(dist, 'index.html'));
}).listen(port, () => console.log(`prod-server on ${port}`));
