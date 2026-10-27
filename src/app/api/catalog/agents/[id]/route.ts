import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { snapshotAgentPrompt } from '@/lib/prompt-snapshot';
import { clientMeta, handle, ok, parse } from '@/lib/http';
import { resolveAuth, requireRole } from '@/middleware/auth';
import { writeAudit } from '@/lib/audit';
import { catalogAgentUpdateSchema } from '../schema';

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const data = await prisma.agent_catalog.findUnique({ where: { id } });
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ item: data });
  } catch (err) {
    console.error('[catalog/agents/:id GET] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// Catalog edits are admin-only and limited to editable fields (no ownership or lineage changes).
export const PATCH = handle<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const auth = await resolveAuth(req);
  requireRole(auth, 'admin');
  const body = parse(catalogAgentUpdateSchema, await req.json());
  const item = await prisma.agent_catalog.update({ where: { id }, data: { ...body, updated_at: new Date() } });
  await writeAudit({ actorId: auth.userId, action: 'catalog_agent.updated', entityType: 'agent_catalog', entityId: id, after: { fields: Object.keys(body) }, ...clientMeta(req) });

  // Auto-snapshot system prompt if config contains a prompt field
  try {
    const config = body.config as { prompt?: unknown } | undefined;
    if (config && typeof config === 'object' && typeof config.prompt === 'string' && config.prompt) {
      await snapshotAgentPrompt({
        agentId: id,
        agentName: body.name || 'Agent',
        systemPrompt: config.prompt,
        version: body.version || '1.0.0',
        author: body.author || null,
      });
    }
  } catch (e) {
    console.error('[agent PATCH] prompt snapshot failed:', e);
  }

  return ok({ item });
});

// Soft delete: the entry is deprecated, not removed.
export const DELETE = handle<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const auth = await resolveAuth(req);
  requireRole(auth, 'admin');
  const item = await prisma.agent_catalog.update({ where: { id }, data: { status: 'deprecated', updated_at: new Date() } });
  await writeAudit({ actorId: auth.userId, action: 'catalog_agent.deprecated', entityType: 'agent_catalog', entityId: id, ...clientMeta(req) });
  return ok({ item });
});
