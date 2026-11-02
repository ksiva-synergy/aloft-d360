/** Client routes for the Agents area (saved agents + workbench builder). */
import { sessionOpenHref } from '@/lib/sessions/surfaces';

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

/** Prefer `sessionOpenHref` from `@/lib/sessions/surfaces` when the row's `progress` is at hand (agent chats need it). */
export function workbenchContinueHref(surface: string, sessionId: string): string {
  return sessionOpenHref({ id: sessionId, surface });
}
