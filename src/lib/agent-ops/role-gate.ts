/** Strict role check for Agent Ops. Server-side authorization must use this. */
export function hasAgentOpsRole(role: string | undefined | null): boolean {
  return role === 'platform_admin' || role === 'admin';
}

/**
 * UI visibility gate for Agent Ops. NEXT_PUBLIC_ENABLE_DEV_TAB only reveals the tab in the client;
 * it is inlined into the browser bundle and must never grant server-side access.
 */
export function canViewAgentOpsRole(role: string | undefined | null): boolean {
  if (process.env.NEXT_PUBLIC_ENABLE_DEV_TAB === 'true') return true;
  return hasAgentOpsRole(role);
}
