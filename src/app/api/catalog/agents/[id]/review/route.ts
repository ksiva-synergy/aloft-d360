import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { ApiError, clientMeta, created, handle, parse } from '@/lib/http';
import { resolveAuth, requireRole } from '@/middleware/auth';
import { writeAudit } from '@/lib/audit';

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  try {
    const comments = await prisma.catalog_review_comments.findMany({
      where: { catalog_type: 'agent', catalog_entry_id: params.id },
      orderBy: { created_at: 'asc' },
    });
    return NextResponse.json({ comments });
  } catch (err) {
    console.error('[catalog/agents/:id/review GET] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

const reviewSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
  status: z.enum(['comment', 'approve', 'request_changes', 'reject']).optional(),
});

// Anyone signed in may comment. Approving publishes the agent org-wide, so it is
// admin-only, attributed to the caller, and an author cannot approve their own agent
// (platform_admin excepted). The client-supplied `author` field is ignored.
export const POST = handle<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const auth = await resolveAuth(req);
  const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const { body: commentBody, status } = parse(reviewSchema, raw);
  const reviewStatus = status ?? 'comment';

  const agent = await prisma.agent_catalog.findUnique({ where: { id }, select: { id: true, owner_id: true } });
  if (!agent) throw new ApiError(404, 'Not found');

  if (reviewStatus !== 'comment') {
    requireRole(auth, 'admin');
    if (reviewStatus === 'approve' && agent.owner_id === auth.userId && auth.role !== 'platform_admin') {
      throw new ApiError(403, 'You cannot approve your own agent');
    }
  }

  const user = await prisma.user.findUnique({ where: { id: auth.userId }, select: { name: true, email: true } });
  const author = user?.name || user?.email || auth.userId;

  const comment = await prisma.catalog_review_comments.create({
    data: { catalog_type: 'agent', catalog_entry_id: id, author, body: commentBody, status: reviewStatus },
  });

  if (reviewStatus === 'approve') {
    await prisma.agent_catalog.update({
      where: { id },
      data: { status: 'published', is_head: true, updated_at: new Date() },
    });
    await writeAudit({ actorId: auth.userId, action: 'catalog_agent.approved', entityType: 'agent_catalog', entityId: id, ...clientMeta(req) });
  }

  return created({ comment });
});
