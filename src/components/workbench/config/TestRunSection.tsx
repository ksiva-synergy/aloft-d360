'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Play, Square } from 'lucide-react';
import type { ConstructionState } from '@/lib/construction/constructionState';
import { AssistantContent } from '@/components/workbench/StreamingMessage';
import { cn } from '@/lib/utils';

type TestRun = NonNullable<ConstructionState['validation']['lastTestRun']>;

interface Step {
  callId: string;
  toolName: string;
  detail: string;
  status: 'running' | 'ok' | 'error';
  error?: string;
}

interface Preview {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

const MAX_PREVIEW_COLS = 6;
const MAX_PREVIEW_ROWS = 5;

function stepDetail(toolName: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  if (toolName === 'execute_tool') {
    const args = (i.args ?? {}) as Record<string, unknown>;
    return String(args.statement ?? '').replace(/\s+/g, ' ').slice(0, 140);
  }
  if (toolName === 'describe_schema') {
    return [i.action, i.query ?? i.path].filter(Boolean).join(' · ');
  }
  return '';
}

/**
 * Runs one sample question through the draft agent against live data and shows the
 * answer, the tool steps and the last result rows. The outcome is recorded on the draft.
 */
export function TestRunSection({
  sessionId,
  state,
  model,
  disabled,
  onRecorded,
}: {
  sessionId: string | null;
  state: ConstructionState;
  model?: string;
  disabled?: boolean;
  onRecorded?: (run: TestRun) => void;
}) {
  const [question, setQuestion] = useState('');
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [answer, setAnswer] = useState('');
  const [steps, setSteps] = useState<Step[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);

  useEffect(() => () => ctrlRef.current?.abort(), []);

  const lastRun = state.validation.lastTestRun;
  const tooShort = state.prompt.instructions.trim().length < 20;

  const run = async () => {
    const q = question.trim() || lastRun?.question || '';
    if (!sessionId || !q) return;
    setQuestion(q);
    setStatus('running');
    setAnswer('');
    setSteps([]);
    setPreview(null);
    setError(null);
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;

    try {
      const res = await fetch('/api/agent-lab/workbench/test-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, question: q, model }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        setError((await res.text().catch(() => '')) || `Test run failed (${res.status})`);
        setStatus('error');
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let sawError = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          switch (ev.type) {
            case 'text':
              setAnswer((a) => a + String(ev.delta ?? ''));
              break;
            case 'tool_call_running':
              setSteps((s) => [...s, {
                callId: String(ev.callId),
                toolName: String(ev.toolName),
                detail: stepDetail(String(ev.toolName), ev.input),
                status: 'running',
              }]);
              break;
            case 'tool_call_result':
              setSteps((s) => s.map((x) => (x.callId === ev.callId ? { ...x, status: 'ok' } : x)));
              break;
            case 'tool_call_error':
              setSteps((s) => s.map((x) => (x.callId === ev.callId ? { ...x, status: 'error', error: String(ev.error ?? '') } : x)));
              break;
            case 'query_result': {
              const cols = (ev.columns as Array<{ name: string }> | undefined)?.map((c) => c.name) ?? [];
              setPreview({ columns: cols, rows: (ev.rows as Record<string, unknown>[]) ?? [], rowCount: Number(ev.rowCount ?? 0) });
              break;
            }
            case 'test_run_recorded':
              onRecorded?.(ev.testRun as TestRun);
              break;
            case 'error':
              sawError = true;
              setError(String(ev.message ?? 'Test run failed'));
              break;
            default:
              break;
          }
        }
      }
      setStatus(sawError ? 'error' : 'done');
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        setStatus('idle');
        return;
      }
      setError(err instanceof Error ? err.message : 'Test run failed');
      setStatus('error');
    } finally {
      ctrlRef.current = null;
    }
  };

  const running = status === 'running';
  const blocked = disabled || tooShort || !sessionId;

  return (
    <div>
      <p className="mb-2 text-[12px] text-[var(--ink-3)]">
        Ask one question this agent should handle. It runs with the draft instructions and read-only access to live data.
      </p>
      <div className="flex items-start gap-2">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !running && !blocked) {
              e.preventDefault();
              void run();
            }
          }}
          rows={2}
          disabled={running}
          aria-label="Test question"
          placeholder={lastRun?.question ?? 'e.g. Which vessels had the largest bunker variance last week?'}
          className="min-w-0 flex-1 resize-none rounded-lg border border-[var(--line-1)] bg-[var(--surface-1)] px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-[var(--brand-a)] disabled:opacity-70"
        />
        {running ? (
          <button
            type="button"
            onClick={() => ctrlRef.current?.abort()}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--line-2)] px-3 text-[12.5px] font-semibold text-[var(--ink-1)]"
          >
            <Square className="h-3.5 w-3.5" /> Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void run()}
            disabled={blocked || !(question.trim() || lastRun?.question)}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--brand-a)] px-3 text-[12.5px] font-semibold text-white disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" /> Run
          </button>
        )}
      </div>
      {tooShort && <p className="mt-1.5 text-[12px] text-[var(--ink-3)]">Write the instructions first, then test them.</p>}

      {steps.length > 0 && (
        <ol className="mt-3 space-y-1">
          {steps.map((s) => (
            <li key={s.callId} className="flex items-start gap-2 text-[12px]">
              {s.status === 'running' ? (
                <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-[var(--ink-3)]" />
              ) : s.status === 'ok' ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ok)]" />
              ) : (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--bad)]" />
              )}
              <div className="min-w-0 flex-1">
                <span className="font-semibold text-[var(--ink-2)]">{s.toolName === 'execute_tool' ? 'SQL' : 'Catalog'}</span>{' '}
                <span className="break-all font-mono text-[11.5px] text-[var(--ink-3)]">{s.detail}</span>
                {s.error && <p className="text-[11.5px] text-[var(--bad)]">{s.error}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}

      {preview && preview.columns.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--line-1)]">
          <table className="w-full text-[11.5px]">
            <thead className="bg-[var(--surface-2)] text-left text-[var(--ink-2)]">
              <tr>
                {preview.columns.slice(0, MAX_PREVIEW_COLS).map((c) => (
                  <th key={c} className="whitespace-nowrap px-2 py-1 font-semibold">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.slice(0, MAX_PREVIEW_ROWS).map((r, i) => (
                <tr key={i} className="border-t border-[var(--line-1)]">
                  {preview.columns.slice(0, MAX_PREVIEW_COLS).map((c) => (
                    <td key={c} className="max-w-[160px] truncate whitespace-nowrap px-2 py-1 tabular-nums">{r[c] == null ? '—' : String(r[c])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-[var(--line-1)] px-2 py-1 text-[11px] text-[var(--ink-3)]">
            {preview.rowCount} row{preview.rowCount === 1 ? '' : 's'}
            {preview.columns.length > MAX_PREVIEW_COLS && ` · ${preview.columns.length - MAX_PREVIEW_COLS} more columns`}
          </p>
        </div>
      )}

      {(answer || running) && (
        <div className={cn('mt-3 rounded-lg border border-[var(--line-1)] bg-[var(--surface-1)] px-3.5 py-3', running && !answer && 'text-[13px] text-[var(--ink-3)]')}>
          {answer ? <AssistantContent content={answer} /> : 'Running…'}
        </div>
      )}

      {error && <p role="alert" className="mt-2 text-[12px] text-[var(--bad)]">{error}</p>}

      {status === 'idle' && lastRun && (
        <div className="mt-3 rounded-lg border border-[var(--line-1)] bg-[var(--surface-1)] px-3 py-2.5">
          <div className="flex items-center gap-2 text-[12px]">
            {lastRun.outcome === 'completed' && lastRun.toolErrors === 0 ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-[var(--ok)]" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 text-[var(--warn)]" />
            )}
            <span className="font-semibold text-[var(--ink-2)]">Last test</span>
            <span className="text-[var(--ink-3)]">
              {new Date(lastRun.at).toLocaleString()} · {lastRun.toolCalls} tool call{lastRun.toolCalls === 1 ? '' : 's'}
              {lastRun.toolErrors > 0 && `, ${lastRun.toolErrors} failed`}
            </span>
          </div>
          <p className="mt-1 text-[12.5px] font-medium">{lastRun.question}</p>
          {lastRun.answerPreview && <p className="mt-1 line-clamp-3 text-[12px] leading-relaxed text-[var(--ink-2)]">{lastRun.answerPreview}</p>}
        </div>
      )}
    </div>
  );
}
