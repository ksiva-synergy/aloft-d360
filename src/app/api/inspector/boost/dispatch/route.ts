import { NextRequest, NextResponse } from 'next/server';
import { runBenchmarkCase } from '@/lib/boost/runner';
import { BOOST_SUITE_V1, BOOST_SUITE_V2 } from '@/lib/boost/suite';
import { BOOST_MODELS } from '@/lib/boost/models';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as {
    caseId?: string;
    modelKey?: string;
    contextMode?: string;
  };

  const { caseId, modelKey, contextMode: rawMode } = body;

  if (!caseId) return NextResponse.json({ error: 'caseId is required' }, { status: 400 });
  if (!modelKey) return NextResponse.json({ error: 'modelKey is required' }, { status: 400 });

  if (![...BOOST_SUITE_V1, ...BOOST_SUITE_V2].find(c => c.id === caseId)) {
    return NextResponse.json({ error: `Case '${caseId}' not found in suite` }, { status: 400 });
  }
  if (!BOOST_MODELS.find(m => m.key === modelKey)) {
    return NextResponse.json({ error: `Model key '${modelKey}' not found in BOOST_MODELS` }, { status: 400 });
  }

  const contextMode: 'harvested' | 'warehouse_only' =
    rawMode === 'warehouse_only' ? 'warehouse_only' : 'harvested';

  const result = await runBenchmarkCase({ caseId, modelKey, contextMode });

  if (!result.ok && !result.row) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json(result.row ?? { error: result.error }, { status: result.ok ? 200 : 500 });
}
