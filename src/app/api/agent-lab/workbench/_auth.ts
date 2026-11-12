import { denyUnlessSectionForApi } from '@/lib/sections/api-guard';
import { authenticateSession, type AuthContext } from '@/middleware/auth';
import { NextResponse } from 'next/server';

/** Section access for workbench APIs (`build.agents`) plus session identity. */
export async function workbenchAuth(req: Request): Promise<AuthContext | NextResponse> {
  const denied = await denyUnlessSectionForApi(req);
  if (denied) return denied;
  const auth = await authenticateSession();
  return auth ?? NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
}
