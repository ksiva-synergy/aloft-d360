import { NextResponse } from 'next/server';
import { AVAILABLE_MODELS } from '@/components/agent-lab/workbench/types';
import { fetchLlmLiteInspectorModelOptions } from '@/lib/llmlite/inspector-models';
import { isLlmLiteConfigured } from '@/lib/llmlite/config';

export const dynamic = 'force-dynamic';

export async function GET() {
  const base = [...AVAILABLE_MODELS];
  if (!isLlmLiteConfigured()) {
    return NextResponse.json({ models: base, llmLiteEnabled: false });
  }

  try {
    const gateway = await fetchLlmLiteInspectorModelOptions();
    return NextResponse.json({
      models: [...base, ...gateway],
      llmLiteEnabled: true,
      llmLiteCount: gateway.length,
    });
  } catch (err) {
    console.warn('[chat-models] LLM Lite fetch failed:', err);
    return NextResponse.json({ models: base, llmLiteEnabled: false, llmLiteError: true });
  }
}
