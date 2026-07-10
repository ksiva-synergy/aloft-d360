import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { listJobDateGroups } from '@/lib/context/reads';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  kind: z.string().min(1),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const rawParams = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = querySchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json({ error: 'BAD_REQUEST', details: parsed.error.format() }, { status: 400 });
  }

  try {
    const org = await getDefaultOrg();
    const data = await listJobDateGroups(org.id, parsed.data.kind);
    return NextResponse.json({ data });
  } catch (err) {
    console.error('[context/jobs/dates GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
