import { NextResponse } from 'next/server';
import { authenticateSession } from '@/middleware/auth';
import { levelsForContext } from '@/lib/sections/server';

export const dynamic = 'force-dynamic';

/** The signed-in person's level (none / view / manage) on every section. Drives the sidebar and read-only pages. */
export async function GET() {
  const ctx = await authenticateSession();
  if (!ctx) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  return NextResponse.json({
    role: ctx.role,
    platformAdmin: ctx.role === 'platform_admin',
    levels: levelsForContext(ctx),
  });
}
