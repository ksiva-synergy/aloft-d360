/** Client routes for the Agents area (saved agents + workbench builder). */

export const AGENTS_LIST_HREF = '/agent-lab/agents';
export const AGENTS_WORKBENCH_HREF = '/agent-lab/agents/workbench';

export function agentsWorkbenchSessionHref(sessionId: string): string {
  return `${AGENTS_WORKBENCH_HREF}/${encodeURIComponent(sessionId)}`;
}

export function isAgentsWorkbenchBasePath(pathname: string): boolean {
  return pathname === AGENTS_WORKBENCH_HREF;
}

export function isAgentsWorkbenchPath(pathname: string): boolean {
  return pathname === AGENTS_WORKBENCH_HREF || pathname.startsWith(`${AGENTS_WORKBENCH_HREF}/`);
}

export function workbenchContinueHref(surface: string, sessionId: string): string {
  if (surface === 'inspector') return `/inspector/${sessionId}`;
  return agentsWorkbenchSessionHref(sessionId);
}
