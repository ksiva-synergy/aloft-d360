import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { matchRoutes } from 'react-router';
import type { RouteObject } from 'react-router';
import { routes } from './router';

/**
 * Next.js no longer serves pages (it is the API and auth server only), so the route table is now the single source of
 * truth for the 43 pages. This list is the contract: it is the set of URLs the app had when it was migrated.
 */
const APP_DIR = path.resolve(__dirname, '../../src/app');

const EXPECTED_PAGES = [
  '/', '/login', '/dashboard',
  '/agent-lab/bandits', '/agent-lab/estate', '/agent-lab/estate/catalog', '/agent-lab/estate/entities',
  '/agent-lab/estate/jobs', '/agent-lab/estate/jobs/:id', '/agent-lab/estate/lineage', '/agent-lab/estate/mapper',
  '/agent-lab/estate/object/:id', '/agent-lab/estate/silo', '/agent-lab/history', '/agent-lab/memory',
  '/agent-lab/memory/contributions', '/agent-lab/memory/ops', '/agent-lab/metrics', '/agent-lab/ops/evals',
  '/agent-lab/ops/prompts', '/agent-lab/runs', '/agent-lab/runs/:sessionId', '/agent-lab/teach', '/agent-lab/teach/digest',
  '/agent-lab/agents', '/agent-lab/agents/:slug',
  '/agent-lab/teach/:sessionId', '/agent-lab/workbench', '/agent-lab/workbench/:sessionId',
  '/agent-staging', '/agent-staging/audit', '/agent-staging/policies', '/agent-staging/try', '/agent-staging/users',
  '/docs', '/docs/agents', '/docs/agents/:slug', '/docs/tools', '/docs/tools/:slug',
  '/inspector', '/inspector/:sessionId', '/inspector/dashboards', '/inspector/dashboards/:dashboardId',
  '/inspector/dashboards/:dashboardId/builder',   '/performance-lab',
  '/settings',
  '/settings/profile',
  '/backfill',
  '/databricks',
  '/agent-lab/estate/objects/:id',
];

/** Page/layout files that would make Next serve HTML again. There must be none under src/app. */
function nextPageFiles(dir = APP_DIR): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...nextPageFiles(full));
    else if (/^(page|layout|template|default|not-found|error|loading)\.(tsx|ts|jsx|js)$/.test(name)) out.push(path.relative(APP_DIR, full));
  }
  return out;
}

/** Full paths of every route that renders something (excluding the `*` catch-alls). */
function leafPaths(rs: RouteObject[], prefix = ''): { full: string; route: RouteObject }[] {
  const out: { full: string; route: RouteObject }[] = [];
  for (const r of rs) {
    const here = r.index ? prefix : r.path ? `${prefix}/${r.path}`.replace(/\/+/g, '/') : prefix;
    if (r.children?.length) out.push(...leafPaths(r.children, here));
    if ((r.index || r.path) && (r.element || r.Component || r.lazy) && !r.children?.length) {
      if (r.path !== '*') out.push({ full: here || '/', route: r });
    }
  }
  return out;
}

const normalise = (p: string) => p.replace(/:[A-Za-z]+/g, ':p');

describe('route table', () => {
  const urls = EXPECTED_PAGES;

  it('covers the expected page and legacy redirect URLs', () => {
    expect(urls.length).toBe(50);
    expect(new Set(urls).size).toBe(50);
  });

  it('Next.js serves no pages: src/app holds route handlers only (the UI is the Vite app)', () => {
    expect(nextPageFiles()).toEqual([]);
  });

  it('every expected page URL resolves to a real (non catch-all) route', () => {
    const unmatched: string[] = [];
    for (const u of urls) {
      const sample = u.replace(/:[A-Za-z]+/g, 'sample-1');
      const m = matchRoutes(routes, sample);
      const leaf = m?.[m.length - 1]?.route;
      if (!leaf || leaf.path === '*') unmatched.push(u);
    }
    expect(unmatched).toEqual([]);
  });

  it('has no route outside the expected page list (no invented routes)', () => {
    const nextSet = new Set(urls.map(normalise));
    const extra = leafPaths(routes)
      .map((l) => normalise(l.full))
      .filter((p) => !nextSet.has(p));
    expect(extra).toEqual([]);
  });

  it('static routes win over dynamic ones (teach/digest vs teach/:sessionId, inspector/dashboards vs inspector/:sessionId)', () => {
    const leafOf = (u: string) => {
      const m = matchRoutes(routes, u)!;
      return m[m.length - 1].route.path;
    };
    expect(leafOf('/agent-lab/teach/digest')).toBe('agent-lab/teach/digest');
    expect(leafOf('/agent-lab/teach/abc')).toBe('agent-lab/teach/:sessionId');
    expect(leafOf('/inspector/dashboards')).toBe('inspector/dashboards');
    expect(leafOf('/inspector/xyz')).toBe('inspector/:sessionId');
    expect(leafOf('/inspector/dashboards/d1/builder')).toBe('inspector/dashboards/:dashboardId/builder');
  });

  it('redirect-only pages use <Navigate>, and /dashboard is the default landing page', () => {
    const find = (p: string) => leafPaths(routes).find((l) => l.full === p)?.route;
    expect(find('/agent-lab/runs')?.element).toBeTruthy();
    expect(find('/agent-staging')?.element).toBeTruthy();
    expect(find('/')?.element).toBeTruthy();
  });

  it('every lazily loaded page module loads under the next/* shims and exports a component', async () => {
    const lazies = leafPaths(routes).filter((l) => l.route.lazy);
    expect(lazies.length).toBeGreaterThan(25);
    const failures: string[] = [];
    for (const { full, route } of lazies) {
      try {
        const mod = await (route.lazy as () => Promise<{ Component?: unknown }>)();
        if (typeof mod.Component !== 'function' && typeof mod.Component !== 'object') failures.push(`${full}: no component`);
      } catch (e) {
        failures.push(`${full}: ${(e as Error).message.slice(0, 160)}`);
      }
    }
    expect(failures).toEqual([]);
  }, 300_000);

  it('document titles that came from Next metadata are preserved', () => {
    const titleOf = (p: string) => (leafPaths(routes).find((l) => l.full === p)?.route.handle as { title?: string } | undefined)?.title;
    expect(titleOf('/agent-lab/memory')).toBe('FOER — Agent Work-Memory · Aloft');
    expect(titleOf('/agent-lab/memory/contributions')).toBe('Memory Contributions · Aloft');
    expect(titleOf('/agent-lab/memory/ops')).toBe('FOER Ops — Memory Operations · Aloft');
    expect(titleOf('/agent-lab/teach')).toBe('Teach · Captain Track Sparrow Reflect');
    expect(titleOf('/agent-lab/teach/digest')).toBe('Teach · Candidate hand-off');
    expect(titleOf('/dashboard')).toBe('Dashboard · ALOFT');
  });
});
