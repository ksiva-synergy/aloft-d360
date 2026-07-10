import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { listObjectsPage } from '@/lib/context/reads';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  sourceId: z.string().uuid().optional(),
  catalog: z.string().optional(),
  schema: z.string().optional(),
  q: z.string().optional(),
  status: z.string().optional(),
  stale: z.enum(['true', 'false']).transform((val) => val === 'true').optional(),
  hasPii: z.enum(['true', 'false']).transform((val) => val === 'true').optional(),
  sort: z.enum(['path', 'rows', 'last_seen']).optional(),
  page: z.string().regex(/^\d+$/).transform(Number).optional(),
  pageSize: z.string().regex(/^\d+$/).transform(Number).optional(),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const rawParams = Object.fromEntries(searchParams.entries());

  const parsed = querySchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json({ error: 'BAD_REQUEST', details: parsed.error.format() }, { status: 400 });
  }

  try {
    const org = await getDefaultOrg();
    const result = await listObjectsPage(org.id, parsed.data);

    // Safe BigInt serialization for fields like row_count_est and size_bytes_est
    const serialized = JSON.parse(
      JSON.stringify(result, (_, value) =>
        typeof value === 'bigint' ? Number(value) : value
      )
    );

    return NextResponse.json({ data: serialized });
  } catch (err) {
    console.error('[context/objects GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
