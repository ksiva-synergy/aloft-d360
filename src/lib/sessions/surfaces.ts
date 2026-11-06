/**
 * Surfaces of a `workbench_sessions` row, and where each one opens. Keep every
 * list, filter and "Continue" link on these helpers instead of `surface === 'inspector'`
 * checks, so a new surface can never fall through into the Workbench.
 */

export const SESSION_SURFACES = ['workbench', 'inspector', 'teach', 'agent_use'] as const;
export type SessionSurface = (typeof SESSION_SURFACES)[number];

/** Rows from before the Inspector existed have no surface; they are Workbench sessions. */
export function normalizeSurface(surface: string | null | undefined): SessionSurface {
  return (SESSION_SURFACES as readonly string[]).includes(surface ?? '') ? (surface as SessionSurface) : 'workbench';
}

/** Prisma `where` for one surface (Workbench includes legacy null rows). */
export function surfaceWhere(surface: SessionSurface) {
  return surface === 'workbench'
    ? { OR: [{ surface: 'workbench' as string }, { surface: null }] }
    : { surface: surface as string };
}

/** Prisma `where` for any of several surfaces; empty list = no filter. */
export function surfacesWhere(surfaces: SessionSurface[]) {
  if (surfaces.length === 0) return {};
  if (surfaces.length === 1) return surfaceWhere(surfaces[0]);
  return {
    OR: surfaces.flatMap((s) =>
      s === 'workbench' ? [{ surface: 'workbench' as string }, { surface: null }] : [{ surface: s as string }],
    ),
  };
}

export function parseSurfaceParam(value: string | null | undefined): SessionSurface | null {
  return value && (SESSION_SURFACES as readonly string[]).includes(value) ? (value as SessionSurface) : null;
}

/** `?surface=workbench,inspector` → known surfaces only (unknown values are ignored). */
export function parseSurfaceList(value: string | null | undefined): SessionSurface[] {
  return (value ?? '')
    .split(',')
    .map((v) => parseSurfaceParam(v.trim()))
    .filter((v): v is SessionSurface => v !== null);
}

/** Which agent an `agent_use` chat belongs to (stored in `progress.agentUse`). */
export type AgentUseLink = { agentId: string; slug: string };

export function agentUseLink(progress: unknown): AgentUseLink | null {
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) return null;
  const link = (progress as { agentUse?: unknown }).agentUse;
  if (!link || typeof link !== 'object') return null;
  const { agentId, slug } = link as { agentId?: unknown; slug?: unknown };
  return typeof agentId === 'string' && typeof slug === 'string' && slug ? { agentId, slug } : null;
}

export function agentChatHref(slug: string, chatId?: string | null): string {
  const base = `/agent-lab/agents/${encodeURIComponent(slug)}`;
  return chatId ? `${base}?chat=${encodeURIComponent(chatId)}` : base;
}

/** Where "Continue / Open" goes for a saved session. */
export function sessionOpenHref(session: { id: string; surface?: string | null; progress?: unknown }): string {
  const surface = normalizeSurface(session.surface);
  if (surface === 'inspector') return `/inspector/${session.id}`;
  if (surface === 'teach') return `/agent-lab/teach/${session.id}`;
  if (surface === 'agent_use') {
    const link = agentUseLink(session.progress);
    return link ? agentChatHref(link.slug, session.id) : '/agent-lab/agents';
  }
  return `/agent-lab/agents/workbench/${encodeURIComponent(session.id)}`;
}

export const SURFACE_LABEL: Record<SessionSurface, string> = {
  workbench: 'WORKBENCH',
  inspector: 'INSPECTOR',
  teach: 'TEACH',
  agent_use: 'AGENT CHAT',
};
