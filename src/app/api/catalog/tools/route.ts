import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { slugify } from '@/lib/catalog-helpers';
import { clientMeta, created, handle, parse } from '@/lib/http';
import { resolveAuth, requireRole } from '@/middleware/auth';
import { writeAudit } from '@/lib/audit';
import { TOOL_ORDER_FIELDS, toolCreateSchema } from './schema';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const status = sp.get('status');
    const type = sp.get('type');
    const search = sp.get('search');
    const tag = sp.get('tag');
    const limit = Math.min(Math.max(parseInt(sp.get('limit') || '50') || 50, 1), 200);
    const offset = Math.max(parseInt(sp.get('offset') || '0') || 0, 0);
    const requestedOrder = sp.get('orderBy') || 'updated_at';
    const orderBy = (TOOL_ORDER_FIELDS as readonly string[]).includes(requestedOrder) ? requestedOrder : 'updated_at';
    const orderDir = sp.get('orderDir') === 'asc' ? 'asc' : 'desc';

    const data = await prisma.tool_catalog.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(type ? { type } : {}),
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
        ...(tag ? { tags: { has: tag } } : {}),
      },
      orderBy: { [orderBy]: orderDir },
      skip: offset,
      take: limit,
    });

    return NextResponse.json({ items: data ?? [] });
  } catch (err) {
    console.error('[catalog/tools GET] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// Tools are shared by every agent and the Inspector, so writes are admin-only and field-whitelisted.
export const POST = handle(async (req) => {
  const auth = await resolveAuth(req);
  requireRole(auth, 'admin');
  const body = parse(toolCreateSchema, await req.json());
  const slug = body.slug ?? slugify(body.name) + '-' + Date.now().toString(36);
  const data = await prisma.tool_catalog.create({ data: { ...body, slug } });
  await writeAudit({ actorId: auth.userId, action: 'catalog_tool.created', entityType: 'tool_catalog', entityId: data.id, ...clientMeta(req) });
  return created({ item: data });
});
