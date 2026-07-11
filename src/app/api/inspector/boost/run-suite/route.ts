import { NextRequest, NextResponse } from 'next/server';
import { runBenchmarkCase } from '@/lib/boost/runner';
import { BOOST_SUITE_V1 } from '@/lib/boost/suite';
import { BOOST_MODELS } from '@/lib/boost/models';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

const ALL_CONTEXT_MODES: ('harvested' | 'warehouse_only')[] = ['harvested', 'warehouse_only'];

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as {
    modelKeys?: string[];
    contextModes?: string[];
    caseIds?: string[];
  };

  const modelKeys = (body.modelKeys?.length ? body.modelKeys : BOOST_MODELS.map(m => m.key))
    .filter(k => BOOST_MODELS.find(m => m.key === k));

  const contextModes = (body.contextModes?.length ? body.contextModes : ALL_CONTEXT_MODES)
    .filter((m): m is 'harvested' | 'warehouse_only' => m === 'harvested' || m === 'warehouse_only');

  const caseIds = (body.caseIds?.length ? body.caseIds : BOOST_SUITE_V1.map(c => c.id))
    .filter(id => BOOST_SUITE_V1.find(c => c.id === id));

  if (!modelKeys.length) return NextResponse.json({ error: 'No valid modelKeys' }, { status: 400 });
  if (!contextModes.length) return NextResponse.json({ error: 'No valid contextModes' }, { status: 400 });
  if (!caseIds.length) return NextResponse.json({ error: 'No valid caseIds' }, { status: 400 });

  const results: { caseId: string; modelKey: string; mode: string; outcome: string }[] = [];
  let dispatched = 0;

  // Sequential dispatch — avoid Bedrock throttling
  for (const modelKey of modelKeys) {
    for (const contextMode of contextModes) {
      for (const caseId of caseIds) {
        const result = await runBenchmarkCase({ caseId, modelKey, contextMode });
        const outcome = (result.row as Record<string, string> | undefined)?.outcome ?? result.error ?? 'unknown';
        results.push({ caseId, modelKey, mode: contextMode, outcome });
        dispatched++;
      }
    }
  }

  return NextResponse.json({ dispatched, results });
}
