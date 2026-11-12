import { NextRequest, NextResponse } from 'next/server';
import { denyUnlessSection } from '@/lib/sections/server';
import { getLlmLiteApiKey, getLlmLiteBaseUrl } from '@/lib/llmlite/config';
import { TITAN_EMBED_MODEL, DEFAULT_EMBED_DIMS, embedWithTitan } from '@/lib/azure/embed-client';

export const dynamic = 'force-dynamic';

async function probeEmbedding(modelId: string) {
  const started = Date.now();
  try {
    if (modelId === TITAN_EMBED_MODEL) {
      const r = await embedWithTitan('ALOFT embedding health check', DEFAULT_EMBED_DIMS);
      const latencyMs = Date.now() - started;
      if (!r?.embedding?.length) {
        return { ok: false, modelId, latencyMs, error: 'Bedrock Titan returned no vector (check AWS credentials / region)' };
      }
      return { ok: true, modelId, resolvedModel: r.modelId, latencyMs, dimensions: r.embedding.length };
    }

    const base = getLlmLiteBaseUrl();
    const apiKey = getLlmLiteApiKey();
    if (!base || !apiKey) {
      return { ok: false, modelId, error: 'LLMLITE_BASE_URL or LLMLITE_API_KEY is not configured' };
    }
    const res = await fetch(`${base}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: modelId, input: 'ALOFT embedding health check', dimensions: DEFAULT_EMBED_DIMS }),
      cache: 'no-store',
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, modelId, status: res.status, latencyMs, error: errText.slice(0, 300) || `HTTP ${res.status}` };
    }
    const json = (await res.json()) as { data?: Array<{ embedding?: number[] }>; model?: string };
    const dims = json.data?.[0]?.embedding?.length ?? 0;
    return dims
      ? { ok: true, modelId, resolvedModel: json.model ?? modelId, latencyMs, dimensions: dims }
      : { ok: false, modelId, latencyMs, error: 'Gateway returned no embedding vector' };
  } catch (err) {
    return {
      ok: false,
      modelId,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : 'Embedding probe failed',
    };
  }
}

export async function POST(req: NextRequest) {
  // Probing a model spends gateway tokens: same rule as changing model settings.
  const deniedSection = await denyUnlessSection(req, ['govern.models', 'manage']);
  if (deniedSection) return deniedSection;

  let body: { modelId?: string; kind?: 'chat' | 'embedding' };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const modelId = body.modelId?.trim();
  if (!modelId) {
    return NextResponse.json({ ok: false, error: 'modelId is required' }, { status: 400 });
  }

  if (body.kind === 'embedding') {
    return NextResponse.json(await probeEmbedding(modelId));
  }

  const base = getLlmLiteBaseUrl();
  const apiKey = getLlmLiteApiKey();
  if (!base || !apiKey) {
    return NextResponse.json(
      { ok: false, error: 'LLMLITE_BASE_URL or LLMLITE_API_KEY is not configured' },
      { status: 503 },
    );
  }

  const started = Date.now();
  const lower = modelId.toLowerCase();
  const tokenParam = lower.includes('gpt') || lower.includes('o3') ? 'max_completion_tokens' : 'max_tokens';

  try {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'Reply with the single word READY.' }],
        [tokenParam]: 128,
      }),
      cache: 'no-store',
    });
    const latencyMs = Date.now() - started;

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return NextResponse.json({
        ok: false,
        modelId,
        status: res.status,
        latencyMs,
        error: errText.slice(0, 300) || `HTTP ${res.status}`,
      });
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
    };
    const reply = json.choices?.[0]?.message?.content?.trim() ?? '(empty reply)';
    return NextResponse.json({
      ok: true,
      modelId,
      resolvedModel: json.model ?? modelId,
      latencyMs,
      reply,
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      modelId,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : 'Network error calling LLM Lite gateway',
    });
  }
}
