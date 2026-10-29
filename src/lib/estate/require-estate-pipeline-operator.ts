import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canRunEstatePipeline, ESTATE_PIPELINE_FORBIDDEN_MESSAGE } from '@/lib/estate/pipeline-access';

/** Returns a JSON error response, or null when the caller may run pipelines. */
export async function denyUnlessEstatePipelineOperator(): Promise<NextResponse | null> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const role = (session.user as { role?: string } | undefined)?.role;
  if (!canRunEstatePipeline(role)) {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: ESTATE_PIPELINE_FORBIDDEN_MESSAGE },
      { status: 403 },
    );
  }
  return null;
}
