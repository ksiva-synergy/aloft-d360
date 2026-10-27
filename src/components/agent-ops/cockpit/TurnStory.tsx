'use client';

import React from 'react';
import { ArrowRight, MessageSquare } from 'lucide-react';
import type { InvocationRow, SessionTurnView } from '@/lib/agent-ops/session-cockpit';
import { BORDER, ERR, type ColorOf, fmtMs, mono, plural, sans } from './format';

interface Step {
  toolName: string;
  calls: InvocationRow[];
  ms: number;
  errors: number;
}

/** Collapse consecutive calls to the same tool into one step: describe_schema ×6. */
function toSteps(invocations: InvocationRow[]): Step[] {
  const steps: Step[] = [];
  for (const inv of invocations) {
    const last = steps[steps.length - 1];
    const err = inv.status === 'success' ? 0 : 1;
    if (last && last.toolName === inv.toolName) {
      last.calls.push(inv);
      last.ms += inv.durationMs;
      last.errors += err;
    } else {
      steps.push({ toolName: inv.toolName, calls: [inv], ms: inv.durationMs, errors: err });
    }
  }
  return steps;
}

/**
 * Reads like a story: what the user asked → the sequence of things the agent did → what it answered.
 */
export function TurnStory({
  turns,
  colorOf,
  onOpenCalls,
  onOpenTurn,
  onReadAnswer,
}: {
  turns: SessionTurnView[];
  colorOf: ColorOf;
  onOpenCalls: (calls: InvocationRow[], title: string) => void;
  onOpenTurn: (turnIndex: number) => void;
  onReadAnswer: () => void;
}) {
  if (turns.length === 0) return <p style={{ ...sans, fontSize: 'var(--type-ui-regular-size)', color: 'var(--ink-3)', margin: 0 }}>No turns yet.</p>;

  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {turns.map((t, i) => {
        const steps = toSteps(t.invocations);
        const ms = t.invocations.reduce((s, x) => s + x.durationMs, 0);
        const isLast = i === turns.length - 1;
        return (
          <li key={t.turnIndex} style={{ display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr)', gap: 14 }}>
            {/* rail */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span
                style={{
                  ...mono,
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 'var(--type-caption-size)',
                  fontWeight: 600,
                  color: 'var(--brand-a)',
                  background: 'color-mix(in srgb, var(--brand-a) 12%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--brand-a) 35%, transparent)',
                  flexShrink: 0,
                }}
              >
                {t.turnIndex}
              </span>
              {!isLast && <span style={{ flex: 1, width: 2, background: 'var(--wb-border-subtle)', marginTop: 4 }} />}
            </div>

            <div style={{ paddingBottom: isLast ? 0 : 22, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <button
                  type="button"
                  onClick={() => onOpenTurn(t.turnIndex)}
                  style={{
                    ...sans,
                    fontSize: 'var(--type-body-size)',
                    fontWeight: 600,
                    lineHeight: 1.45,
                    color: 'var(--wb-ink)',
                    background: 'none',
                    border: 'none',
                    padding: '4px 0 0',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                  title="Open this turn"
                >
                  “{t.userExcerpt || '(no prompt)'}”
                </button>
                <span style={{ ...mono, fontSize: 'var(--type-caption-size)', color: t.errorCount > 0 ? ERR : 'var(--ink-3)', whiteSpace: 'nowrap', paddingTop: 6 }}>
                  {plural(t.toolCallCount, 'call')}
                  {ms > 0 && ` · ${fmtMs(ms)}`}
                  {t.errorCount > 0 && ` · ${t.errorCount} err`}
                </span>
              </div>

              {steps.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 10 }}>
                  {steps.map((s, si) => {
                    const color = colorOf(s.toolName);
                    return (
                      <React.Fragment key={si}>
                        {si > 0 && <ArrowRight size={12} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />}
                        <button
                          type="button"
                          onClick={() => onOpenCalls(s.calls, `Turn ${t.turnIndex} · ${s.toolName}`)}
                          title={`${s.calls.length} × ${s.toolName} · ${fmtMs(s.ms)}`}
                          style={{
                            ...mono,
                            fontSize: 'var(--type-caption-size)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '4px 10px',
                            borderRadius: 999,
                            border: `1px solid color-mix(in srgb, ${s.errors ? ERR : color} 40%, transparent)`,
                            background: `color-mix(in srgb, ${s.errors ? ERR : color} 10%, transparent)`,
                            color: 'var(--wb-ink)',
                            cursor: 'pointer',
                          }}
                        >
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.errors ? ERR : color }} />
                          {s.toolName}
                          {s.calls.length > 1 && <strong style={{ fontWeight: 600 }}>×{s.calls.length}</strong>}
                          {s.ms > 0 && <span style={{ color: 'var(--ink-3)' }}>{fmtMs(s.ms)}</span>}
                        </button>
                      </React.Fragment>
                    );
                  })}
                  <ArrowRight size={12} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
                  <span
                    style={{
                      ...sans,
                      fontSize: 'var(--type-caption-size)',
                      fontWeight: 600,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '4px 10px',
                      borderRadius: 999,
                      border: BORDER,
                      color: 'var(--wb-ink-dim)',
                    }}
                  >
                    <MessageSquare size={11} /> Answer
                  </span>
                </div>
              ) : (
                <p style={{ ...sans, fontSize: 'var(--type-caption-size)', color: 'var(--ink-3)', margin: '8px 0 0' }}>Answered directly, no tools used.</p>
              )}

              {t.assistantExcerpt && (
                <div
                  style={{
                    marginTop: 10,
                    padding: '10px 12px',
                    borderRadius: 10,
                    borderLeft: '3px solid color-mix(in srgb, var(--brand-a) 40%, transparent)',
                    background: 'color-mix(in srgb, var(--wb-ink) 3%, transparent)',
                  }}
                >
                  <div
                    style={{
                      ...sans,
                      fontSize: 'var(--type-ui-regular-size)',
                      lineHeight: 1.55,
                      color: 'var(--wb-ink-dim)',
                      display: '-webkit-box',
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {t.assistantExcerpt}
                  </div>
                  <button
                    type="button"
                    onClick={onReadAnswer}
                    style={{ ...sans, fontSize: 'var(--type-caption-size)', color: 'var(--brand-a)', background: 'none', border: 'none', padding: 0, marginTop: 6, cursor: 'pointer' }}
                  >
                    Read full answer →
                  </button>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
