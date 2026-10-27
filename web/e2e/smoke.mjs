/**
 * End-to-end smoke test for the Vite + React Router UI, in a REAL browser (system Chrome via playwright-core).
 *
 *   npm run web:e2e                       # starts the Vite dev server, runs the checks, stops it
 *   WEB_E2E_MODE=preview npm run web:e2e  # builds first, then tests the production bundle (`vite preview`)
 *   WEB_URL=http://localhost:5180 WEB_E2E_NO_START=1 node web/e2e/smoke.mjs   # use a server you started
 *
 * Needs no login and no database: the API is stubbed inside the browser with `page.route`, so this checks the
 * migrated UI itself (routing, shims, lazy chunks, auth guard, layout) — NOT the API behaviour. One extra block
 * talks to the real Next.js API through the Vite proxy (read-only) when it is running.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { fixtureFor } from './fixtures.mjs';
import { scanBundle } from './check-bundle.mjs';

const MODE = process.env.WEB_E2E_MODE === 'preview' ? 'preview' : 'dev';
const PORT = MODE === 'preview' ? 4180 : 5180; // the test starts its own server, never the one you use on :3000
const BASE = process.env.WEB_URL ?? `http://localhost:${PORT}`;
const API_TARGET = process.env.WEB_API_TARGET ?? 'http://localhost:3001';
const CHROME =
  process.env.CHROME_PATH ??
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);

const NOW = new Date().toISOString();
const SESSION = {
  user: { id: 'u-test', name: 'Test User', email: 'test@example.com', role: 'platform_admin', roleLabel: 'Platform Admin' },
  expires: '2099-01-01T00:00:00.000Z',
};

/** All 43 pages (sample params filled in). `to` = where a redirect page must end up. */
const ROUTES = [
  ['/dashboard'],
  ['/agent-lab/bandits'],
  ['/agent-lab/estate'],
  ['/agent-lab/estate/catalog'],
  ['/agent-lab/estate/entities'],
  ['/agent-lab/estate/jobs'],
  ['/agent-lab/estate/jobs/job-1'],
  ['/agent-lab/estate/lineage'],
  ['/agent-lab/estate/mapper'],
  ['/agent-lab/estate/object/obj-1'],
  ['/agent-lab/estate/silo'],
  ['/agent-lab/history'],
  ['/agent-lab/memory'],
  ['/agent-lab/memory/contributions'],
  ['/agent-lab/memory/ops'],
  ['/agent-lab/metrics'],
  ['/agent-lab/ops/evals'],
  ['/agent-lab/ops/prompts'],
  ['/agent-lab/runs', '/agent-lab/history'],
  ['/agent-lab/runs/sess-1'],
  ['/agent-lab/teach'],
  ['/agent-lab/teach/digest'],
  ['/agent-lab/teach/sess-1'],
  ['/agent-lab/agents'],
  ['/agent-lab/agents/some-agent'],
  ['/agent-lab/workbench'],
  ['/agent-lab/workbench/sess-1'],
  ['/agent-staging', '/docs/agents'],
  ['/agent-staging/audit'],
  ['/agent-staging/policies'],
  ['/agent-staging/try'],
  ['/agent-staging/users'],
  ['/docs'],
  ['/docs/agents'],
  ['/docs/agents/some-agent'],
  ['/docs/tools'],
  ['/docs/tools/some-tool'],
  ['/inspector'],
  ['/inspector/sess-1'],
  ['/inspector/dashboards'],
  ['/inspector/dashboards/dash-1'],
  ['/inspector/dashboards/dash-1/builder'],
  ['/performance-lab'],
  ['/settings/profile'],
  ['/settings', '/settings/profile'],
  ['/backfill', '/agent-lab/estate/jobs'],
  ['/databricks', '/agent-lab/estate/catalog'],
  ['/agent-lab/estate/objects/obj-1', '/agent-lab/estate/object/obj-1'],
  ['/', '/dashboard'],
];

const ERROR_TEXT = ['Something went wrong loading this page', 'Page not found'];
// Errors that mean the MIGRATION is broken (bundling, aliasing, shims, process.env…), not that a stub has the wrong shape.
const HARD = /(Failed to fetch dynamically imported module|does not provide an export|is not a function.*(next|Link|dynamic)|process is not defined|Unexpected token '<'|Cannot find module|Failed to resolve import|Importing a module script failed|useNavigate\(\) may be used only|useRevalidator|must be wrapped in a <SessionProvider|No routes matched|Invalid hook call|Objects are not valid as a React child)/i;

const json = (route, body, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

function apiStub(authenticated) {
  return async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    if (p === '/api/auth/session') return json(route, authenticated ? SESSION : {});
    if (p === '/api/auth/csrf') return json(route, { csrfToken: 'test-csrf' });
    if (p === '/api/auth/providers') return json(route, { credentials: { id: 'credentials', name: 'Credentials', type: 'credentials' } });
    if (p === '/api/auth/_log') return json(route, {});
    if (!authenticated) return json(route, { error: 'UNAUTHORIZED' }, 401);
    const fx = fixtureFor(p);
    if (fx !== undefined) return json(route, fx);
    // Shape-agnostic default: an object that satisfies most "{ items|data|rows… }" consumers.
    return json(route, { data: [], items: [], rows: [], results: [], sessions: [], runs: [], total: 0, count: 0 });
  };
}

async function waitForServer(url, ms = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server at ${url} did not start within ${ms / 1000}s`);
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    c.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))));
  });
}

let server;
if (!process.env.WEB_E2E_NO_START) {
  if (MODE === 'preview') await run('npm', ['run', 'web:build']);
  server = MODE === 'preview'
    ? spawn('node', ['web/e2e/prod-server.mjs'], { stdio: 'ignore', env: { ...process.env, PORT: String(PORT) } })
    : spawn('node', ['node_modules/vite/bin/vite.js', '--config', 'web/vite.config.ts'], { stdio: 'ignore', env: { ...process.env, WEB_PORT: String(PORT) } });
}
const stop = () => server && server.kill();
process.on('exit', stop);

// Never hang silently: a stuck browser or server must fail the run.
setTimeout(() => {
  console.log('WATCHDOG: e2e exceeded 25 minutes, aborting');
  process.exit(2);
}, 25 * 60 * 1000).unref();

const results = [];
let failures = 0;
let warnings = 0;
// level: 'pass' | 'warn' | 'fail'. A warning is a page whose render threw because the STUBBED API data was the
// wrong shape while the app shell stayed intact. It proves routing/bundling work but not the page's data handling.
const check = (name, ok, detail = '', level) => {
  const lv = level ?? (ok ? 'pass' : 'fail');
  results.push({ name, ok: lv !== 'fail', level: lv, detail });
  console.log(`  [${results.length}] ${lv.toUpperCase().padEnd(4)} ${name}${detail ? '  ' + detail.slice(0, 140) : ''}`);
  if (lv === 'fail') failures++;
  if (lv === 'warn') warnings++;
};

try {
  await waitForServer(BASE);
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });

  /* ── 0. production bundle hygiene ───────────────────────────────────────────── */
  if (MODE === 'preview') {
    const leaks = scanBundle();
    check('production bundle contains no server-only code (Prisma, AWS SDK, bcrypt, secrets)', leaks.length === 0, leaks.slice(0, 3).join(' | '));
  }

  /* ── 1. every route, authenticated ──────────────────────────────────────────── */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.route('**/api/**', apiStub(true));
  let pageErrors = [];
  let consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  const failedAssets = [];
  page.on('response', (r) => {
    const u = r.url();
    // /uploads/* is runtime user content (public/uploads is gitignored), absent in a fresh checkout for Next as well.
    if (r.status() >= 400 && u.startsWith(BASE) && !u.includes('/api/') && !u.includes('/uploads/')) failedAssets.push(`${r.status()} ${u}`);
  });

  const FILTER = process.env.ROUTE_FILTER ? new RegExp(process.env.ROUTE_FILTER) : null;
  for (const [path, redirectTo] of ROUTES.filter(([p]) => !FILTER || FILTER.test(p))) {
    pageErrors = [];
    consoleErrors = [];
    // First request after a cold dev start transforms a large module graph, so allow a long first load.
    await page.goto(BASE + path, { waitUntil: 'commit', timeout: 180_000 });
    await page.waitForLoadState('networkidle', { timeout: 90_000 }).catch(() => {});
    // Wait for the app shell (every route here is authenticated) instead of sleeping: lazy chunks can arrive late on a cold dev server.
    await page.waitForSelector('main', { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(700);
    const finalPath = new URL(page.url()).pathname;
    const { body, hasMain } = await page.evaluate(() => ({ body: document.body.innerText, hasMain: !!document.querySelector('main') }));
    const boundary = ERROR_TEXT.find((t) => body.includes(t));
    const hard = [...pageErrors, ...consoleErrors].filter((m) => HARD.test(m));
    const expected = redirectTo ?? path;

    let level = 'pass';
    let detail = '';
    const firstErr = [...pageErrors, ...consoleErrors][0]?.slice(0, 200) ?? '';
    if (finalPath !== expected) {
      level = 'fail';
      detail = `ended on ${finalPath}, expected ${expected}`;
    } else if (!hasMain) {
      level = 'fail';
      detail = `app shell (<main>) not rendered — ${firstErr || body.slice(0, 120).replace(/\s+/g, ' ')}`;
    } else if (hard.length) {
      level = 'fail';
      detail = hard[0].slice(0, 200);
    } else if (boundary) {
      level = 'warn';
      detail = `page render error with shell intact (stub data shape?) — ${firstErr}`;
    } else if (pageErrors.length) {
      level = 'warn';
      detail = `uncaught error (stub data shape?) — ${pageErrors[0].slice(0, 160)}`;
    }
    check(`route ${path}`, level !== 'fail', detail, level);
  }
  check('no 4xx/5xx static assets during the whole run', failedAssets.length === 0, failedAssets.slice(0, 3).join(' | '));

  /* ── 2. login page is public and renders without a session ──────────────────── */
  const anon = await browser.newContext();
  const ap = await anon.newPage();
  await ap.route('**/api/**', apiStub(false));
  const anonErrors = [];
  ap.on('pageerror', (e) => anonErrors.push(String(e.message || e)));
  await ap.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 120_000 });
  const hasMs = (await ap.getByText('Sign in with Microsoft').count()) > 0;
  await ap.getByRole('button', { name: 'Admin login' }).click().catch(() => {});
  const inputs = await ap.locator('input').count();
  check('/login renders for anonymous user (Microsoft button + Admin login form)', new URL(ap.url()).pathname === '/login' && hasMs && inputs >= 2 && anonErrors.filter((m) => HARD.test(m)).length === 0, `microsoft=${hasMs} inputs=${inputs} ${anonErrors[0] ?? ''}`);

  /* ── 3. auth guard ───────────────────────────────────────────────────────────── */
  for (const p of ['/dashboard', '/agent-lab/history', '/inspector', '/']) {
    await ap.goto(BASE + p, { waitUntil: 'networkidle', timeout: 120_000 });
    check(`anonymous ${p} → /login`, new URL(ap.url()).pathname === '/login', `ended on ${new URL(ap.url()).pathname}`);
  }

  /* ── 4. client-side navigation really is a SPA (no document reload) ─────────── */
  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle', timeout: 120_000 });
  await page.evaluate(() => (window.__spaMarker = 'alive'));
  const link = page.locator('a[href="/agent-lab/history"]').first();
  const hasLink = (await link.count()) > 0;
  if (hasLink) {
    await link.click();
    await page.waitForURL('**/agent-lab/history');
  }
  check('sidebar link navigates without a full reload', hasLink && (await page.evaluate(() => window.__spaMarker)) === 'alive', hasLink ? '' : 'no link to /agent-lab/history found in the shell');

  /* ── 5. deep links, browser history, 404 ────────────────────────────────────── */
  await page.goBack();
  check('browser Back returns to previous route', new URL(page.url()).pathname === '/dashboard');
  await page.goto(BASE + '/no/such/page', { waitUntil: 'networkidle' });
  check('unknown URL shows the not-found page inside the shell', (await page.evaluate(() => document.body.innerText)).includes('Page not found'));

  /* ── 6. theme + title ────────────────────────────────────────────────────────── */
  await page.goto(BASE + '/agent-lab/memory/contributions', { waitUntil: 'networkidle' });
  check('document.title comes from route handle (was Next metadata)', (await page.title()) === 'Memory Contributions · Aloft', await page.title());
  const htmlClass = await page.evaluate(() => document.documentElement.className);
  check('theme class applied to <html> before React (boot script)', /\b(light|dark)\b/.test(htmlClass), htmlClass);

  /* ── 7. real API through the Vite proxy (read-only) ─────────────────────────── */
  let apiUp = false;
  try {
    // A hung API (for example a dev server wedged after files changed) must not fail the UI checks: require an answer within 8 s.
    apiUp = (await fetch(API_TARGET + '/api/health', { signal: AbortSignal.timeout(8000) })).ok;
  } catch {
    /* next not running */
  }
  if (apiUp) {
    const viaProxy = await (await fetch(BASE + '/api/auth/session', { signal: AbortSignal.timeout(20000) })).text();
    check('GET /api/auth/session through the proxy reaches Next', viaProxy.trim() === '{}', viaProxy.slice(0, 80));
    const health = await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(20000) });
    check('GET /api/health through the proxy → 200', health.ok, String(health.status));
    const dash = await fetch(BASE + '/api/dashboard/summary', { redirect: 'manual', signal: AbortSignal.timeout(20000) });
    check('new /api/dashboard/summary is protected (not 200 when signed out)', dash.status !== 200, `status ${dash.status}`);
    const topic = await fetch(BASE + '/api/agent-lab/memory/topic-map', { redirect: 'manual', signal: AbortSignal.timeout(20000) });
    check('new /api/agent-lab/memory/topic-map is protected (not 200 when signed out)', topic.status !== 200, `status ${topic.status}`);
  } else {
    console.log('(Next API not running or not answering on ' + API_TARGET + ' — proxy checks skipped)');
  }

  await browser.close();
} catch (err) {
  check('test run completed', false, String(err?.stack ?? err));
} finally {
  stop();
}

const w = Math.max(...results.map((r) => r.name.length));
for (const r of results) console.log(`${r.level.toUpperCase().padEnd(4)}  ${r.name.padEnd(w)}${r.detail ? '  ' + r.detail : ''}`);
console.log(`\n${results.length - failures - warnings} passed, ${warnings} warnings, ${failures} failed of ${results.length} checks (${MODE} mode, ${BASE})`);
process.exit(failures ? 1 : 0);
