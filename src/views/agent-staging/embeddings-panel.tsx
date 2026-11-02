'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileCode2,
  Info,
  Loader2,
  Play,
  ScanText,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Chip, btn } from '@/views/agent-lab/flows/ui';
import type { EmbeddingConfigSummary } from '@/app/api/model-config/route';

interface EmbedProbe {
  ok: boolean;
  latencyMs?: number;
  dimensions?: number;
  error?: string;
}

function EmbedModelCard({
  title,
  modelId,
  provider,
  detail,
  status,
  role,
  probe,
  running,
  onTest,
}: {
  title: string;
  modelId: string;
  provider: string;
  detail: string;
  status: { tone: 'ok' | 'warn' | 'bad' | 'neutral'; text: string };
  role: string;
  probe?: EmbedProbe;
  running: boolean;
  onTest?: () => void;
}) {
  return (
    <div className="flex flex-col justify-between gap-3 rounded-xl border border-[var(--line-1)] bg-[var(--surface-1)] p-4">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-size-body font-semibold text-[var(--ink-1)]">{title}</span>
          <Chip tone={status.tone}>{status.text}</Chip>
        </div>
        <div className="truncate font-mono text-caption text-[var(--ink-2)]" title={modelId}>
          {modelId}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-caption font-medium text-[var(--ink-2)]">
            {provider}
          </span>
          <span className="rounded bg-[var(--brand-a-soft)] px-1.5 py-0.5 text-caption font-medium text-[var(--brand-a-ink)]">
            {role}
          </span>
        </div>
        <p className="text-caption text-[var(--ink-3)]">{detail}</p>
      </div>

      {onTest && (
        <div className="flex items-center justify-between gap-2 border-t border-[var(--line-1)] pt-3">
          <div className="min-w-0 text-caption">
            {probe &&
              (probe.ok ? (
                <span className="inline-flex items-center gap-1 text-[var(--ok)]">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {probe.dimensions} dims · {probe.latencyMs} ms
                </span>
              ) : (
                <span className="inline-flex items-start gap-1 text-[var(--bad)]" title={probe.error}>
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="line-clamp-2">{probe.error ?? 'Failed'}</span>
                </span>
              ))}
          </div>
          <button
            type="button"
            onClick={onTest}
            disabled={running}
            className={cn(btn.secondary, 'shrink-0 transition-transform duration-150 active:scale-[0.97]')}
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Test
          </button>
        </div>
      )}
    </div>
  );
}

export function EmbeddingsPanel({ embeddings }: { embeddings: EmbeddingConfigSummary }) {
  const [probes, setProbes] = useState<Record<string, { running: boolean; result?: EmbedProbe }>>({});

  const runProbe = async (modelId: string) => {
    setProbes((p) => ({ ...p, [modelId]: { running: true } }));
    try {
      const res = await fetch('/api/model-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId, kind: 'embedding' }),
      });
      const result = (await res.json()) as EmbedProbe;
      setProbes((p) => ({ ...p, [modelId]: { running: false, result } }));
    } catch (err) {
      setProbes((p) => ({
        ...p,
        [modelId]: {
          running: false,
          result: { ok: false, error: err instanceof Error ? err.message : 'Request failed' },
        },
      }));
    }
  };

  const { ocr } = embeddings;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2.5 rounded-xl border border-[var(--line-1)] bg-[var(--surface-2)]/50 px-4 py-3 text-size-ui text-[var(--ink-2)]">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-a-ink)]" />
        <p>
          Every vector store is a pgvector <code className="font-mono">vector({embeddings.dimensions})</code> column
          searched by cosine similarity. Vectors from different models live in different spaces and cannot be
          compared, so the whole platform is pinned to one model and {embeddings.dimensions} dimensions. Changing the
          embedding model means re-embedding every table below.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-size-body font-semibold text-[var(--ink-1)]">Embedding &amp; OCR models</h2>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <EmbedModelCard
            title="Titan Text Embeddings v2"
            modelId={embeddings.awsTitanModel}
            provider={`AWS Bedrock · ${embeddings.awsTitanRegion}`}
            role="Primary · all vector stores"
            detail={`Direct Bedrock call (not through LLM Lite). Knowledge bases use region ${embeddings.knowledgeEmbedRegion} and have no fallback: indexing fails and retries if Titan is down.`}
            status={
              embeddings.awsTitanConfigured
                ? { tone: 'ok', text: 'Configured' }
                : { tone: 'bad', text: 'AWS credentials missing' }
            }
            probe={probes[embeddings.awsTitanModel]?.result}
            running={probes[embeddings.awsTitanModel]?.running ?? false}
            onTest={() => void runProbe(embeddings.awsTitanModel)}
          />
          <EmbedModelCard
            title="OpenAI text-embedding-3-large"
            modelId={embeddings.azureFoundryModel}
            provider="Azure OpenAI / Foundry"
            role="Fallback · estate knowledge sync"
            detail="Used only when Titan fails for estate knowledge sync. Stored with its own model_id so mixed rows can be told apart."
            status={
              embeddings.azureFoundryConfigured
                ? { tone: 'ok', text: 'Configured' }
                : { tone: 'neutral', text: 'Not configured' }
            }
            running={false}
          />
          {embeddings.gatewayEmbeddingModels.map((m) => (
            <EmbedModelCard
              key={m.id}
              title={m.label.replace(/\s*\(LLM Lite\)\s*/gi, '')}
              modelId={m.id}
              provider="Synergy LLM Lite gateway"
              role="Available · not used by platform"
              detail="Exposed by the gateway with mode=embedding, so it is hidden from chat pickers. No ALOFT surface calls it yet."
              status={
                m.keyAllowed
                  ? { tone: 'ok', text: 'Key allowed' }
                  : { tone: 'warn', text: 'Key blocked' }
              }
              probe={probes[m.id]?.result}
              running={probes[m.id]?.running ?? false}
              onTest={() => void runProbe(m.id)}
            />
          ))}
          <div className="flex flex-col gap-1.5 rounded-xl border border-[var(--line-1)] bg-[var(--surface-1)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-size-body font-semibold text-[var(--ink-1)]">
                <ScanText className="h-4 w-4 text-[var(--brand-a-ink)]" />
                Mistral OCR
              </span>
              <Chip tone={ocr.configured ? 'ok' : 'warn'}>
                {ocr.configured ? `Via ${ocr.via === 'litellm' ? 'LLM Lite' : 'Foundry'}` : 'Not configured'}
              </Chip>
            </div>
            <div className="truncate font-mono text-caption text-[var(--ink-2)]">{ocr.model}</div>
            <p className="text-caption text-[var(--ink-3)]">
              Reads scanned PDF pages and images before they are chunked and embedded for knowledge bases.
              {ocr.endpoint ? ` Endpoint: ${ocr.endpoint}` : ''}
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-size-body font-semibold text-[var(--ink-1)]">Where embeddings are stored and used</h2>
        <div className="overflow-hidden rounded-2xl border border-[var(--line-1)] bg-[var(--surface-1)] shadow-sm">
          <div className="divide-y divide-[var(--line-1)]">
            {embeddings.surfaces.map((s) => {
              const pending = s.totalRows - s.embeddedRows;
              const foreign = s.modelsInDb.filter((m) => m.modelId !== s.activeModelId);
              return (
                <div key={s.id} className="space-y-2 px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Database className="h-4 w-4 text-[var(--brand-a-ink)]" />
                      <span className="text-size-body font-semibold text-[var(--ink-1)]">{s.label}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Chip tone={s.configured ? 'ok' : 'bad'}>{s.configured ? 'Ready' : 'Not configured'}</Chip>
                      <Chip tone="neutral">{s.embeddedRows.toLocaleString()} vectors</Chip>
                    </div>
                  </div>
                  <p className="text-caption text-[var(--ink-3)]">{s.description}</p>
                  <div className="flex flex-wrap items-center gap-1.5 text-caption">
                    <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[var(--ink-2)]">
                      {s.table} · {s.columnType}
                    </span>
                    <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[var(--ink-2)]">
                      {s.activeModelId}
                    </span>
                    <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[var(--ink-2)]">
                      {s.provider} · {s.regionOrEndpoint}
                    </span>
                    {pending > 0 && (
                      <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">
                        {pending.toLocaleString()} rows not embedded yet
                      </span>
                    )}
                  </div>
                  {foreign.length > 0 && (
                    <div className="flex items-start gap-1.5 text-caption text-amber-700 dark:text-amber-300">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      Mixed models in this table:{' '}
                      {s.modelsInDb.map((m) => `${m.modelId} (${m.count.toLocaleString()})`).join(', ')}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5 text-caption text-[var(--ink-3)]">
                    <FileCode2 className="h-3 w-3" />
                    {s.codePaths.map((p) => (
                      <code key={p} className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono">
                        {p}
                      </code>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
