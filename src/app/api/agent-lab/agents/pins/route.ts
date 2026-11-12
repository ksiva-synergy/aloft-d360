import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateSession } from '@/middleware/auth';
import { denyUnlessSection } from '@/lib/sections/server';
import { listPinnedAgents, PinLimitError, PinTargetError, reorderPinnedAgents, setAgentPinned } from '@/lib/agents/pinned-agents';
import { MAX_PINNED_AGENTS } from '@/lib/agents/pinned-agents-shared';

export const dynamic = 'force-dynamic';

/** P2021 = table missing: the `20261111_user_pinned_agents` migration has not been applied to this database. */
function notSetUp(err: unknown): NextResponse | null {
  if ((err as { code?: string })?.code !== 'P2021') return null;
  return NextResponse.json(
    { error: 'Pinning is not set up on this server yet (database migration pending).' },
    { status: 503 },
  );
}

/**
 * The signed-in person's pinned agents (sidebar shortcuts). Pins are personal, so anyone who can
 * view Agents may change their own; nobody can read or change someone else's.
 */
async function guard(request: NextRequest): Promise<{ denied: NextResponse } | { userId: string }> {
  const denied = await denyUnlessSection(request, ['build.agents', 'view']);
  if (denied) return { denied };
  const auth = await authenticateSession();
  if (!auth) return { denied: NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }) };
  return { userId: auth.userId };
}

export async function GET(request: NextRequest) {
  const gate = await guard(request);
  if ('denied' in gate) return gate.denied;
  const { userId } = gate;
  try {
    return NextResponse.json({ pins: await listPinnedAgents(userId), max: MAX_PINNED_AGENTS });
  } catch (err) {
    const missing = notSetUp(err);
    if (missing) return missing;
    console.error('[agent-lab/agents/pins GET] error', err);
    return NextResponse.json({ error: 'Could not load pinned agents' }, { status: 500 });
  }
}

const body = z.object({ agentId: z.string().uuid(), pinned: z.boolean() });
const orderBody = z.object({ order: z.array(z.string().uuid()).max(MAX_PINNED_AGENTS * 2) });

/** Reorder: `{ order: [agentId, …] }`, first is shown at the top of the sidebar. */
export async function PATCH(request: NextRequest) {
  const gate = await guard(request);
  if ('denied' in gate) return gate.denied;
  const parsed = orderBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'order (array of agent uuids) required' }, { status: 400 });
  try {
    const pins = await reorderPinnedAgents(gate.userId, parsed.data.order);
    return NextResponse.json({ pins, max: MAX_PINNED_AGENTS });
  } catch (err) {
    const missing = notSetUp(err);
    if (missing) return missing;
    console.error('[agent-lab/agents/pins PATCH] error', err);
    return NextResponse.json({ error: 'Could not reorder pinned agents' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const gate = await guard(request);
  if ('denied' in gate) return gate.denied;
  const { userId } = gate;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'agentId (uuid) and pinned (boolean) required' }, { status: 400 });
  try {
    const pins = await setAgentPinned(userId, parsed.data.agentId, parsed.data.pinned);
    return NextResponse.json({ pins, max: MAX_PINNED_AGENTS });
  } catch (err) {
    if (err instanceof PinLimitError) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err instanceof PinTargetError) return NextResponse.json({ error: err.message }, { status: 404 });
    if ((err as { code?: string })?.code === 'P2034') {
      return NextResponse.json({ error: 'Pins changed at the same time. Try again.' }, { status: 409 });
    }
    const missing = notSetUp(err);
    if (missing) return missing;
    console.error('[agent-lab/agents/pins PUT] error', err);
    return NextResponse.json({ error: 'Could not update pinned agents' }, { status: 500 });
  }
}
