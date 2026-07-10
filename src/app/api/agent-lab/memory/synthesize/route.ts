import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { runSynthesisSweep } from '@/lib/memory/run-sweep';

export const dynamic = 'force-dynamic';
// Synthesis calls Bedrock once per session — allow up to 5 minutes
export const maxDuration = 300;

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const org = await getDefaultOrg();
    // Cap at 20 sessions per UI-triggered sweep to avoid Vercel timeout
    const summary = await runSynthesisSweep(org.id, 20);
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error('[memory/synthesize POST]', err);
    return NextResponse.json(
      { error: 'INTERNAL', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
