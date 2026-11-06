import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { slugify } from '@/lib/catalog-helpers';
import { ApiError, clientMeta, created, handle, parse } from '@/lib/http';
import { resolveAuth } from '@/middleware/auth';
import { denyUnlessSection, requireSection } from '@/lib/sections/server';
import { writeAudit } from '@/lib/audit';
import { policyCreateSchema } from './schema';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const deniedSection = await denyUnlessSection(request, ['govern.policies', 'view']);
  if (deniedSection) return deniedSection;
  try {
    const sp = request.nextUrl.searchParams;
    const type = sp.get('type');
    const scope = sp.get('scope');
    const status = sp.get('status');
    const search = sp.get('search');
    const limit = Math.min(parseInt(sp.get('limit') || '50'), 200);
    const offset = parseInt(sp.get('offset') || '0');

    const data = await prisma.policy_entry.findMany({
      where: {
        ...(type ? { type } : {}),
        ...(scope ? { scope } : {}),
        ...(status ? { status } : {}),
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      },
      orderBy: { updated_at: 'desc' },
      skip: offset,
      take: limit,
    });

    return NextResponse.json({ items: data ?? [] });
  } catch (err) {
    console.error('[policies GET] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// Writes need Manage on Policies (admins by default) and accept only the known policy fields (never the raw body).
export const POST = handle(async (req) => {
  const auth = await resolveAuth(req);
  requireSection(auth, ['govern.policies', 'manage']);
  const body = parse(policyCreateSchema, await req.json());
  const slug = body.slug ?? `${slugify(body.name)}-${Date.now().toString(36)}`;
  try {
    const item = await prisma.policy_entry.create({ data: { ...body, slug } });
    await writeAudit({ actorId: auth.userId, action: 'policy.created', entityType: 'policy', entityId: item.id, after: item, ...clientMeta(req) });
    return created({ item });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') throw new ApiError(409, 'A policy with this slug already exists');
    throw err;
  }
});
