/**
 * GET /api/agent-lab/memory/leaderboard?domain=<agent_class>
 *
 * Phase B — surfaces the per-domain reputation leaderboard that leaderboard.ts
 * already computes. This route is a thin server wrapper around getLeaderboard():
 * it authenticates, resolves the org + acting user, validates the requested
 * domain against the agent_class values actually present in the memory store,
 * resolves every userId to a safe display name (NEVER an email), and hands back
 * the LeaderboardView plus the list of available domains for the UI's tabs.
 *
 * It does NOT touch retrieval, the ranking math, or the weighting flag.
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { prisma } from '@/lib/prisma';
import { getLeaderboard, type LeaderboardEntry } from '@/lib/memory/reputation/leaderboard';

export const dynamic = 'force-dynamic';

/**
 * Near-term contributor scale is ~12–30, so one league = everyone. We pass this
 * explicitly rather than inheriting getLeaderboard's Duolingo-style default of 30
 * — same number today, but the intent (single board until we genuinely outgrow
 * it) is now documented at the call site. The UI hides "league" framing until a
 * board is large enough to bucket.
 */
const COHORT_SIZE = 30;

/**
 * A wire-safe entry: the raw userId is dropped and replaced by a display name.
 * The client only ever sees a name (or a non-identifying handle) plus isYou.
 */
type EnrichedEntry = Omit<LeaderboardEntry, 'userId'> & { displayName: string };

/**
 * Distinct agent_class domains that actually exist in the store, busiest first.
 * This is the allow-list we validate the `domain` query param against — we never
 * trust arbitrary input straight into the ranking query.
 */
async function listDomains(orgId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ agent_class: string; n: bigint }>>`
    SELECT agent_class, count(*)::bigint AS n
    FROM platform_agent_memory
    WHERE org_id = ${orgId} AND status = 'ACTIVE' AND agent_class IS NOT NULL
    GROUP BY agent_class
    ORDER BY n DESC, agent_class ASC
  `;
  return rows.map((r) => r.agent_class);
}

/**
 * Map a set of reputation userIds to display names via the User table. Falls back
 * to a non-identifying handle when a userId has no User row (workbench_sessions
 * .user_id has no FK to User, so this is expected) — and NEVER returns an email.
 */
async function resolveDisplayNames(userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return out;

  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true, username: true }, // deliberately NOT email
  });
  for (const u of users) {
    const name = u.name?.trim() || u.username?.trim();
    if (name) out.set(u.id, name);
  }
  // Anyone left unresolved gets a stable, non-identifying handle.
  for (const id of unique) {
    if (!out.has(id)) out.set(id, `Contributor ${id.slice(-4).toUpperCase()}`);
  }
  return out;
}

const enrich = (e: LeaderboardEntry, names: Map<string, string>): EnrichedEntry => {
  const { userId, ...rest } = e; // strip userId — never sent to the client
  return { ...rest, displayName: names.get(userId) ?? `Contributor ${userId.slice(-4).toUpperCase()}` };
};

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const org = await getDefaultOrg();
    const domains = await listDomains(org.id);

    // No memory yet — nothing to rank. Return an empty, well-formed payload so the
    // UI can render its own empty/warming state without special-casing errors.
    if (domains.length === 0) {
      return NextResponse.json({ domains: [], cohortSize: COHORT_SIZE, view: null });
    }

    // Validate + default the domain: honour the query param only if it's a real
    // domain, otherwise fall back to the busiest one (domains[0]).
    const requested = new URL(req.url).searchParams.get('domain');
    const domain = requested && domains.includes(requested) ? requested : domains[0];

    const view = await getLeaderboard(org.id, domain, userId, { cohortSize: COHORT_SIZE });

    // Resolve every userId that appears anywhere in the view to a display name.
    const ids = [
      ...view.top.map((e) => e.userId),
      ...view.around.map((e) => e.userId),
      ...(view.you ? [view.you.userId] : []),
    ];
    const names = await resolveDisplayNames(ids);

    return NextResponse.json({
      domains,
      cohortSize: COHORT_SIZE,
      view: {
        domain: view.domain,
        league: view.league,
        leagueSize: view.leagueSize,
        top: view.top.map((e) => enrich(e, names)),
        around: view.around.map((e) => enrich(e, names)),
        you: view.you ? enrich(view.you, names) : null,
      },
    });
  } catch (err) {
    console.error('[memory/leaderboard GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
