/**
 * Map API paths to sections so route handlers can refuse callers who have no level
 * on that section (same rules as the sidebar and SectionGate).
 */
import { NextResponse } from 'next/server';
import { denyUnlessSection, minForMethod } from './server';
import { embeddedCallRequirements } from './uses';

type ApiSectionRule = { prefix: string; sectionId: string };

/** Longest prefix wins. Omit paths every signed-in person may use (my-access, auth, …). */
const API_SECTION_PREFIXES: readonly ApiSectionRule[] = [
  { prefix: '/api/agent-lab/context', sectionId: 'estate.overview' },
  { prefix: '/api/agent-lab/flows', sectionId: 'build.automate' },
  { prefix: '/api/agent-lab/workbench', sectionId: 'build.agents' },
  { prefix: '/api/agent-lab/agents', sectionId: 'build.agents' },
  { prefix: '/api/agent-lab/runs', sectionId: 'build.history' },
  { prefix: '/api/agent-lab/memory/ops', sectionId: 'memory.ops' },
  { prefix: '/api/agent-lab/memory/contributions', sectionId: 'memory.contributions' },
  { prefix: '/api/agent-lab/memory', sectionId: 'memory.foer' },
  { prefix: '/api/agent-lab/knowledge', sectionId: 'memory.knowledge' },
  { prefix: '/api/agent-lab/metrics', sectionId: 'build.metrics' },
  { prefix: '/api/agent-lab/teach', sectionId: 'build.teach' },
  { prefix: '/api/agent-lab/bandits', sectionId: 'build.bandits' },
  { prefix: '/api/agent-lab/studio', sectionId: 'build.automate' },
  { prefix: '/api/agent-lab/marcus', sectionId: 'build.teach' },
  { prefix: '/api/agent-lab/ops', sectionId: 'build.performance' },
  { prefix: '/api/inspector/dashboards', sectionId: 'build.dashboards' },
  { prefix: '/api/inspector/teach', sectionId: 'build.teach' },
  { prefix: '/api/inspector/performance', sectionId: 'build.performance' },
  { prefix: '/api/inspector/boost', sectionId: 'build.performance' },
  { prefix: '/api/inspector/semantic', sectionId: 'build.metrics' },
  { prefix: '/api/inspector', sectionId: 'build.inspector' },
  { prefix: '/api/users/access-requests', sectionId: 'govern.access-requests' },
  { prefix: '/api/dashboard', sectionId: 'home' },
  { prefix: '/api/knowledge', sectionId: 'memory.knowledge' },
  { prefix: '/api/performance-lab', sectionId: 'build.performance' },
  { prefix: '/api/teach', sectionId: 'build.teach' },
].sort((a, b) => b.prefix.length - a.prefix.length);

export function sectionIdForApiPath(pathname: string): string | null {
  const rule = API_SECTION_PREFIXES.find((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`));
  return rule?.sectionId ?? null;
}

/**
 * Returns a 401/403 JSON response, or null when the caller may call this API path: they have the
 * path's section, or a section whose screen embeds this exact call (src/lib/sections/uses.ts).
 */
export async function denyUnlessSectionForApi(req: Request): Promise<NextResponse | null> {
  const pathname = new URL(req.url).pathname;
  const sectionId = sectionIdForApiPath(pathname);
  if (!sectionId) return null;
  return denyUnlessSection(req, [sectionId, minForMethod(req.method)], ...embeddedCallRequirements(req.method, pathname));
}
