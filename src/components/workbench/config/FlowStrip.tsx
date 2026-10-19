'use client';

import React from 'react';
import { ChevronRight, Database, FileOutput, MessageSquare, Brain, Wrench } from 'lucide-react';
import type { ConstructionState } from '@/lib/construction/constructionState';
import { cn } from '@/lib/utils';

type NodeStatus = 'done' | 'partial' | 'empty';

interface FlowNode {
  key: string;
  label: string;
  detail: string;
  status: NodeStatus;
  icon: React.ComponentType<{ className?: string }>;
  /** Section id in the Config panel this node scrolls to. */
  target: string;
}

/** The agent's runtime path, derived from the draft: question → data → reasoning → tools → answer. */
export function buildFlowNodes(state: ConstructionState): FlowNode[] {
  const instructions = state.prompt.instructions.trim().length;
  const sources = state.tools.datasources.length;
  const actions = state.tools.actions.length;
  const lastRun = state.validation.lastTestRun;
  const className = state.class?.id ? state.class.id.charAt(0).toUpperCase() + state.class.id.slice(1) : null;

  return [
    {
      key: 'ask',
      label: 'Question',
      detail: state.prompt.persona ? 'Purpose set' : 'From a user',
      status: state.prompt.persona ? 'done' : 'partial',
      icon: MessageSquare,
      target: 'wb-sec-purpose',
    },
    {
      key: 'data',
      label: 'Data',
      detail: sources === 0 ? 'No tables' : `${sources} table${sources === 1 ? '' : 's'}`,
      status: sources > 0 ? 'done' : 'empty',
      icon: Database,
      target: 'wb-sec-data',
    },
    {
      key: 'reason',
      label: 'Reasoning',
      detail: className ?? (instructions > 0 ? 'No class' : 'Not written'),
      status: className && instructions >= 40 ? 'done' : instructions > 0 || className ? 'partial' : 'empty',
      icon: Brain,
      target: 'wb-sec-instructions',
    },
    {
      key: 'tools',
      label: 'Tools',
      detail: actions > 0 ? `SQL + ${actions}` : 'SQL (built in)',
      status: 'done',
      icon: Wrench,
      target: 'wb-sec-tools',
    },
    {
      key: 'answer',
      label: 'Answer',
      detail: !lastRun ? 'Not tested' : lastRun.outcome === 'completed' ? 'Tested' : 'Test failed',
      status: !lastRun ? 'empty' : lastRun.outcome === 'completed' ? 'done' : 'partial',
      icon: FileOutput,
      target: 'wb-sec-test',
    },
  ];
}

export function FlowStrip({ state }: { state: ConstructionState }) {
  const nodes = buildFlowNodes(state);
  return (
    <nav aria-label="Agent flow" className="mt-5 flex items-stretch gap-0.5">
      {nodes.map((n, i) => (
        <React.Fragment key={n.key}>
          {i > 0 && <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 self-center text-[var(--line-2)]" />}
          <button
            type="button"
            onClick={() => document.getElementById(n.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            title={`${n.label}: ${n.detail}`}
            className={cn(
              'flex min-w-0 flex-1 flex-col items-start gap-1 rounded-lg border px-2 py-1.5 text-left transition-colors hover:border-[var(--brand-a)]',
              n.status === 'done' && 'border-[color-mix(in_srgb,var(--ok)_35%,transparent)] bg-[var(--ok-bg)]',
              n.status === 'partial' && 'border-[var(--line-1)] bg-[var(--surface-1)]',
              n.status === 'empty' && 'border-dashed border-[var(--line-2)] bg-transparent',
            )}
          >
            <span className="flex w-full items-center gap-1">
              <n.icon className={cn('h-3.5 w-3.5 shrink-0', n.status === 'done' ? 'text-[var(--ok)]' : 'text-[var(--ink-3)]')} />
              <span className="truncate text-[11px] font-semibold text-[var(--ink-1)]">{n.label}</span>
            </span>
            <span className="w-full truncate text-[10.5px] text-[var(--ink-3)]">{n.detail}</span>
          </button>
        </React.Fragment>
      ))}
    </nav>
  );
}
