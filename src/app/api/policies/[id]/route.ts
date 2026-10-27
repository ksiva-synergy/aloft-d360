import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { clientMeta, handle, ok, parse } from '@/lib/http';
import { resolveAuth, requireRole } from '@/middleware/auth';
import { writeAudit } from '@/lib/audit';
import { policyUpdateSchema } from '../schema';

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const params = await paramsPromise;
  try {
    const data = await prisma.policy_entry.findUnique({ where: { id: params.id } });
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ item: data });
  } catch (err) {
    console.error('[policies/:id GET] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// Writes are admin-only and accept only the known policy fields (never the raw body).
export const PATCH = handle<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const auth = await resolveAuth(req);
  requireRole(auth, 'admin');
  const body = parse(policyUpdateSchema, await req.json());
  const before = await prisma.policy_entry.findUniqueOrThrow({ where: { id } });
  const item = await prisma.policy_entry.update({ where: { id }, data: { ...body, updated_at: new Date() } });
  await writeAudit({ actorId: auth.userId, action: 'policy.updated', entityType: 'policy', entityId: id, before, after: item, ...clientMeta(req) });
  return ok({ item });
});

// Soft delete: the policy is disabled, not removed.
export const DELETE = handle<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const auth = await resolveAuth(req);
  requireRole(auth, 'admin');
  const item = await prisma.policy_entry.update({ where: { id }, data: { status: 'disabled', updated_at: new Date() } });
  await writeAudit({ actorId: auth.userId, action: 'policy.disabled', entityType: 'policy', entityId: id, after: { status: 'disabled' }, ...clientMeta(req) });
  return ok({ item });
});
