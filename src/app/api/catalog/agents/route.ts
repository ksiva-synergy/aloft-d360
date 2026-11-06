import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { slugify } from '@/lib/catalog-helpers';
import { ApiError, clientMeta, created, handle, parse } from '@/lib/http';
import { resolveAuth, requireRole } from '@/middleware/auth';
import { writeAudit } from '@/lib/audit';
import { catalogAgentCreateSchema } from './schema';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const slug = sp.get('slug');
    if (slug) {
      const item = await prisma.agent_catalog.findFirst({
        where: { slug },
      });
      if (!item) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      return NextResponse.json({ item });
    }

    const status = sp.get('status');
    const type = sp.get('type');
    const search = sp.get('search');
    const tag = sp.get('tag');
    const limit = Math.min(parseInt(sp.get('limit') || '50'), 200);
    const offset = parseInt(sp.get('offset') || '0');
    const orderBy = sp.get('orderBy') || 'updated_at';
    const orderDir = sp.get('orderDir') === 'asc' ? 'asc' : 'desc';

    const data = await prisma.agent_catalog.findMany({
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
    console.error('[catalog/agents GET] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// Publishing to the catalog is admin-only; the caller becomes the owner.
export const POST = handle(async (req) => {
  const auth = await resolveAuth(req);
  requireRole(auth, 'admin');
  const body = parse(catalogAgentCreateSchema, await req.json());
  const slug = body.slug ?? `${slugify(body.name)}-${Date.now().toString(36)}`;
  try {
    const item = await prisma.agent_catalog.create({ data: { ...body, slug, owner_id: auth.userId } });
    await writeAudit({ actorId: auth.userId, action: 'catalog_agent.created', entityType: 'agent_catalog', entityId: item.id, after: { slug, name: item.name }, ...clientMeta(req) });
    return created({ item });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') throw new ApiError(409, 'An entry with this slug already exists');
    throw err;
  }
});
