import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { clientMeta, handle, ok, parse } from '@/lib/http';
import { resolveAuth, requireRole } from '@/middleware/auth';
import { writeAudit } from '@/lib/audit';
import { toolUpdateSchema } from '../schema';

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const params = await paramsPromise;
  try {
    const data = await prisma.tool_catalog.findUnique({ where: { id: params.id } });
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ item: data });
  } catch (err) {
    console.error('[catalog/tools/:id GET] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export const PATCH = handle<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const auth = await resolveAuth(req);
  requireRole(auth, 'admin');
  const body = parse(toolUpdateSchema, await req.json());
  const data = await prisma.tool_catalog.update({ where: { id }, data: { ...body, updated_at: new Date() } });
  await writeAudit({ actorId: auth.userId, action: 'catalog_tool.updated', entityType: 'tool_catalog', entityId: id, after: { fields: Object.keys(body) }, ...clientMeta(req) });
  return ok({ item: data });
});

export const DELETE = handle<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const auth = await resolveAuth(req);
  requireRole(auth, 'admin');
  const data = await prisma.tool_catalog.update({
    where: { id },
    data: { status: 'deprecated', updated_at: new Date() },
  });
  await writeAudit({ actorId: auth.userId, action: 'catalog_tool.deprecated', entityType: 'tool_catalog', entityId: id, ...clientMeta(req) });
  return ok({ item: data });
});
