import { NextResponse } from 'next/server';
import { AVAILABLE_MODELS } from '@/components/agent-lab/workbench/types';
import { fetchLlmLiteInspectorModelOptions } from '@/lib/llmlite/inspector-models';
import { isLlmLiteConfigured } from '@/lib/llmlite/config';
import { filterChatModelsForRole } from '@/lib/inspector/model-access';
import { getSessionUserRole } from '@/lib/inspector/session-role';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const;

export async function GET() {
  const role = await getSessionUserRole();
  const base = filterChatModelsForRole([...AVAILABLE_MODELS], role);
  if (!isLlmLiteConfigured()) {
    return NextResponse.json({ models: base, llmLiteEnabled: false }, { headers: NO_STORE });
  }

  try {
    const gateway = await fetchLlmLiteInspectorModelOptions();
    const merged = filterChatModelsForRole([...base, ...gateway], role);
    return NextResponse.json(
      {
        models: merged,
        llmLiteEnabled: true,
        llmLiteCount: gateway.length,
      },
      { headers: NO_STORE },
    );
  } catch (err) {
    console.warn('[chat-models] LLM Lite fetch failed:', err);
    return NextResponse.json(
      { models: base, llmLiteEnabled: false, llmLiteError: true },
      { headers: NO_STORE },
    );
  }
}
