/** Client + server safe role gate for Agent Ops UI and APIs. */
export function canViewAgentOpsRole(role: string | undefined | null): boolean {
  if (process.env.NEXT_PUBLIC_ENABLE_DEV_TAB === 'true') return true;
  return role === 'platform_admin' || role === 'admin';
}
