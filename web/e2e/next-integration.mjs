/**
 * Checks the Vite UI as served by a real Next.js server (the Docker flow, without Docker). Next serves only the API;
 * every page URL is the static Vite app.
 *
 *   NEXT_DIST_DIR=.next-vite-test npm run build      # prebuild builds the UI into public/spa, then next build
 *   node web/e2e/next-integration.mjs                # starts `next start` on :3100, checks, stops it
 *
 * Read-only against the API: no login, no database writes. Signed-in flows are covered by `web:e2e` with a stubbed API.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

const server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
  stdio: 'ignore',
  shell: true,
  env: { ...process.env, NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? '.next-vite-test', PORT: String(PORT) },
});
const stop = () => {
  try {
    spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    /* already gone */
  }
};
process.on('exit', stop);

async function ready() {
  const t0 = Date.now();
  while (Date.now() - t0 < 120_000) {
    try {
      if ((await fetch(BASE + '/api/health')).ok) return;
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error('next start did not become ready');
}

try {
  await ready();
  const asset = readdirSync('public/spa/assets').find((f) => /^index-.*\.js$/.test(f));

  const login = await fetch(BASE + '/login');
  const loginHtml = await login.text();
  check('GET /login is answered by the Vite app (rewrite)', login.ok && loginHtml.includes('/spa/assets/index-') && loginHtml.includes('id="root"'), `status ${login.status}`);
  check('/login is not the Next.js page', !loginHtml.includes('__next_f') && !loginHtml.includes('/_next/static'));

  const root = await fetch(BASE + '/', { redirect: 'manual' });
  const rootHtml = root.status === 200 ? await root.text() : '';
  check('GET / is the Vite app', root.status === 200 && rootHtml.includes('id="root"'), `status ${root.status}`);

  const dash = await fetch(BASE + '/dashboard', { redirect: 'manual' });
  const dashHtml = dash.status === 200 ? await dash.text() : '';
  check('page URLs are public static shells (a signed-out /dashboard is the SPA, login happens in the browser)', dash.status === 200 && dashHtml.includes('id="root"') && !dashHtml.includes('__next_f'), `status ${dash.status}`);
  const deep = await fetch(BASE + '/agent-lab/estate/jobs/some-id', { redirect: 'manual' });
  check('deep links are answered by the SPA too', deep.status === 200 && (await deep.text()).includes('id="root"'), `status ${deep.status}`);

  const js = await fetch(`${BASE}/spa/assets/${asset}`, { redirect: 'manual' });
  check('JS asset is public without a session and served as JavaScript', js.status === 200 && (js.headers.get('content-type') ?? '').includes('javascript'), `status ${js.status} ${js.headers.get('content-type')}`);
  check('hashed assets are immutable-cached', (js.headers.get('cache-control') ?? '').includes('immutable'), js.headers.get('cache-control') ?? '');

  const idx = await fetch(`${BASE}/spa/index.html`, { redirect: 'manual' });
  check('index.html is never cached', /no-cache|no-store/.test(idx.headers.get('cache-control') ?? ''), idx.headers.get('cache-control') ?? '');

  check('favicon from /public still served at /', (await fetch(BASE + '/favicon-32x32.png')).ok);
  check('GET /api/health still reaches Next', (await fetch(BASE + '/api/health')).ok);
  check('GET /api/auth/csrf (sign-in) stays public', (await fetch(BASE + '/api/auth/csrf')).ok);
  const sess = await fetch(BASE + '/api/sessions', { redirect: 'manual' });
  check('any other API route is protected when signed out (login gate on /api/**)', sess.status === 307 || sess.status === 401, `status ${sess.status}`);
  const users = await fetch(BASE + '/api/users', { redirect: 'manual' });
  check('/api/users is protected when signed out', users.status === 307 || users.status === 401, `status ${users.status}`);
  check('GET /api/auth/session still reaches next-auth', (await (await fetch(BASE + '/api/auth/session')).text()).trim() === '{}');
  const sum = await fetch(BASE + '/api/dashboard/summary', { redirect: 'manual' });
  check('new /api/dashboard/summary is protected when signed out', sum.status === 307 || sum.status === 401, `status ${sum.status}`);
  const topic = await fetch(BASE + '/api/agent-lab/memory/topic-map', { redirect: 'manual' });
  check('new /api/agent-lab/memory/topic-map is protected when signed out', topic.status === 307 || topic.status === 401, `status ${topic.status}`);
  const nf = await fetch(BASE + '/spa/assets/does-not-exist.js', { redirect: 'manual' });
  check('missing asset is a real 404 (not index.html)', nf.status === 404, `status ${nf.status}`);

  // Every API route, signed out. The login gate (src/proxy.ts) must stop all of them except sign-in and the health check.
  const apiRoot = 'src/app/api';
  const apiUrls = [];
  (function walk(dir, parts) {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full, [...parts, name.replace(/^\[\.*(.+?)\]$/, 'x1')]);
      else if (name === 'route.ts') apiUrls.push('/api/' + parts.join('/'));
    }
  })(apiRoot, []);
  const PUBLIC = (u) => u.startsWith('/api/auth') || u === '/api/health';
  const exposed = [];
  const reached = [];
  for (const u of apiUrls.filter((u) => !PUBLIC(u))) {
    const r = await fetch(BASE + u, { redirect: 'manual' });
    if (r.status >= 200 && r.status < 300) exposed.push(`${r.status} ${u}`);
    else if (r.status !== 307 && r.status !== 401) reached.push(`${r.status} ${u}`);
  }
  check(`all ${apiUrls.length - apiUrls.filter(PUBLIC).length} non-public API routes refuse a signed-out GET (no 2xx)`, exposed.length === 0, exposed.slice(0, 3).join(' | '));
  check('...and every one is stopped by the gate (307/401), none reached its handler', reached.length === 0, reached.slice(0, 3).join(' | '));

  // The login page in a real browser, through Next.
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  const errors = [];
  const bad = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().startsWith(BASE) && !r.url().includes('/api/')) bad.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 90_000 });
  const hasMs = (await page.getByText('Sign in with Microsoft').count()) > 0;
  await page.getByRole('button', { name: 'Admin login' }).click().catch(() => {});
  check('login page renders in the browser through Next', hasMs && (await page.locator('input').count()) >= 2, `microsoft=${hasMs}`);
  check('no page errors and no failed static requests on /login', errors.length === 0 && bad.length === 0, [...errors, ...bad].slice(0, 2).join(' | '));
  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle', timeout: 90_000 });
  check('browser visit to /dashboard while signed out ends on /login (client-side guard)', new URL(page.url()).pathname === '/login', page.url());
  await browser.close();
} catch (err) {
  check('integration run completed', false, String(err?.stack ?? err).slice(0, 300));
} finally {
  stop();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed of ${results.length} checks (next start)`);
process.exit(failed ? 1 : 0);
