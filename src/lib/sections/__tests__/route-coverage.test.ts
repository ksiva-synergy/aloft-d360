import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every API route behind an enforced section must check access itself. This fails when a new
 * route under these folders forgets to, so the sidebar hiding a page is never the only guard.
 */
const API = join(__dirname, '..', '..', '..', 'app', 'api');

const GUARDED_FOLDERS = [
  'agent-lab/context', // Data Estate
  'model-config', // Govern → Models
  'users', // Govern → Users
  'sections', // Govern → Users → Section access
  'access', // Govern → Data access
  'admin/cost', // Govern → Cost monitor
  'policies', // Govern → Policies
  'connections', // Govern → Connections
  'audit-log', // Govern → Audit log
];

/** Calls that check section access (directly, or through a helper that does). */
const GUARDS = [
  'denyUnlessSection(',
  'requireSection(',
  'requireAccessAdmin(',
  'requireAccessClassify(',
  'requireAccessAudit(',
  'connectionActor(',
  'requirePlatformAdminForBundles(',
  'denyUnlessEstatePipelineOperator(',
  'requireGroupMemberManager(',
];

/** Routes that are allowed to skip the section check, and why. */
const EXEMPT: Record<string, string> = {
  'access/me/route.ts': "a person's own data access summary; every signed-in person may read it",
  'access/my-access/route.ts': 'a person\'s own access and the names of what they can request (names visible to everyone, A1); never values',
  'access/notifications/route.ts': 'a person\'s own access notices; every signed-in person may read and mark their own',
  'access/requests/route.ts': 'access requests: every signed-in person may ask and see their own; the inbox and history check approver / Data access rights inside',
  'access/requests/[id]/route.ts': 'one access request: the route checks requester, routed approver, platform admin or Data access View itself',
};

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === '__tests__') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...routeFiles(p));
    else if (name === 'route.ts') out.push(p);
  }
  return out;
}

describe('section access route coverage', () => {
  const files = GUARDED_FOLDERS.flatMap((f) => routeFiles(join(API, ...f.split('/'))));

  it('finds the guarded routes', () => {
    expect(files.length).toBeGreaterThan(60);
  });

  it('every guarded route checks access (or is listed as exempt with a reason)', () => {
    const missing = files
      .map((f) => relative(API, f).split(sep).join('/'))
      .filter((rel) => !EXEMPT[rel])
      .filter((rel) => !GUARDS.some((g) => readFileSync(join(API, rel), 'utf8').includes(g)));
    expect(missing).toEqual([]);
  });

  it('exempt routes still exist (drop stale entries)', () => {
    const rels = new Set(files.map((f) => relative(API, f).split(sep).join('/')));
    expect(Object.keys(EXEMPT).filter((r) => !rels.has(r))).toEqual([]);
  });
});
