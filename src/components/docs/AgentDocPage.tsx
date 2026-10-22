'use client';

import Link from 'next/link';
import { ArrowLeft, ExternalLink, Tag, Calendar, User, Bot, Wrench } from 'lucide-react';
import { SchemaTable } from './SchemaTable';
import { CodeExample } from './CodeExample';
import type { AgentCatalogEntry } from '@/types/catalog';

interface AgentDocPageProps {
  agent: AgentCatalogEntry;
  relatedAgents?: AgentCatalogEntry[];
}

const TYPE_COLORS: Record<string, string> = {
  orchestrator: 'bg-[color:var(--brand-a-soft)] text-[color:var(--brand-a-ink)] dark:bg-[color:color-mix(in_srgb,var(--brand-a)_30%,transparent)] dark:text-[color:var(--brand-a-ink)]',
  worker: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  planner: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  validator: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  router: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
};

function schemaFieldToObject(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj).length > 0 ? obj : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

function catalogToolsList(tools: unknown): string[] {
  if (!Array.isArray(tools)) return [];
  return tools.map((t) => (typeof t === 'string' ? t : String(t)));
}

export function AgentDocPage({ agent, relatedAgents = [] }: AgentDocPageProps) {
  const inputSchema = schemaFieldToObject(agent.input_schema);
  const outputSchema = schemaFieldToObject(agent.output_schema);
  const toolNames = catalogToolsList(agent.tools);
  const prompt = typeof agent.config?.systemPrompt === 'string' ? agent.config.systemPrompt.trim() : '';
  const canUse = prompt.length >= 20;
  const source = agent.config?.source;
  const workbenchSessionId = source && typeof source === 'object' && typeof (source as { workbenchSessionId?: unknown }).workbenchSessionId === 'string'
    ? (source as { workbenchSessionId: string }).workbenchSessionId
    : null;
  const editUrl = workbenchSessionId ? `/agent-lab/workbench/${workbenchSessionId}` : null;

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs text-[var(--ink-3)] dark:text-[color:var(--ink-3)] mb-6">
        <Link href="/docs" className="hover:text-[color:var(--brand-a-ink)] dark:hover:text-[color:var(--brand-a-ink)] transition-colors">
          Docs
        </Link>
        <span>/</span>
        <Link href="/docs/agents" className="hover:text-[color:var(--brand-a-ink)] dark:hover:text-[color:var(--brand-a-ink)] transition-colors">
          Agents
        </Link>
        <span>/</span>
        <span className="text-[color:var(--ink-2)] dark:text-[color:var(--ink-1)] font-medium">{agent.name}</span>
      </nav>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <h1 className="text-2xl font-bold text-[color:var(--ink-1)] dark:text-[color:var(--ink-1)]">
            {agent.name}
          </h1>
          <span className={`text-xs font-semibold uppercase px-2 py-0.5 rounded-full ${TYPE_COLORS[agent.type] || 'bg-[color:var(--surface-2)] text-[color:var(--ink-2)] dark:bg-[color:color-mix(in_srgb,var(--surface-1)_30%,transparent)] dark:text-[color:var(--ink-2)]'}`}>
            {agent.type}
          </span>
        </div>
        <p className="text-sm text-[color:var(--ink-2)] dark:text-[color:var(--ink-2)] leading-relaxed max-w-2xl">
          {agent.description || 'No description available.'}
        </p>

        {/* Metadata */}
        <div className="flex flex-wrap items-center gap-4 mt-4 text-xs text-[var(--ink-3)] dark:text-[color:var(--ink-3)]">
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            v{agent.version}
          </span>
          {agent.author && (
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {agent.author}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Bot className="h-3 w-3" />
            {agent.status}
          </span>
        </div>

        {/* Tags */}
        {agent.tags && agent.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mt-3">
            <Tag className="h-3 w-3 text-[var(--ink-3)]" />
            {agent.tags.map(tag => (
              <span
                key={tag}
                className="text-xs px-2 py-0.5 rounded-full bg-[color:var(--surface-2)] dark:bg-[color:var(--surface-2)] text-[color:var(--ink-2)] dark:text-[color:var(--ink-2)]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Tools Used */}
      {toolNames.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-[color:var(--ink-1)] dark:text-[color:var(--ink-1)] mb-3">
            Tools
          </h2>
          <div className="flex flex-wrap gap-2">
            {toolNames.map(toolName => (
              <Link
                key={toolName}
                href={`/docs/tools/${toolName}`}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[color:var(--line-1)] dark:border-[var(--line-1)] hover:border-[color:color-mix(in_srgb,var(--brand-a)_35%,transparent)] dark:hover:border-[color:var(--brand-a)] transition-colors bg-[color:var(--surface-1)] dark:bg-[var(--surface-1)]"
              >
                <Wrench className="h-3 w-3 text-[var(--ink-3)]" />
                <span className="text-[color:var(--ink-2)] dark:text-[color:var(--ink-2)]">{toolName}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Input Schema */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-[color:var(--ink-1)] dark:text-[color:var(--ink-1)] mb-3">
          Input Schema
        </h2>
        <SchemaTable schema={inputSchema} title="Input" />
      </section>

      {/* Output Schema */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-[color:var(--ink-1)] dark:text-[color:var(--ink-1)] mb-3">
          Output Schema
        </h2>
        <SchemaTable schema={outputSchema} title="Output" />
      </section>

      {/* Configuration */}
      {agent.config && Object.keys(agent.config).length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-[color:var(--ink-1)] dark:text-[color:var(--ink-1)] mb-3">
            Configuration
          </h2>
          <CodeExample
            code={JSON.stringify(agent.config, null, 2)}
            language="json"
            title="Agent Configuration"
          />
        </section>
      )}

      {/* Bus Subscriptions/Publications */}
      {(agent.bus_subscriptions?.length > 0 || agent.bus_publications?.length > 0) && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-[color:var(--ink-1)] dark:text-[color:var(--ink-1)] mb-3">
            Event Bus
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {agent.bus_subscriptions?.length > 0 && (
              <div className="p-3 rounded-lg border border-[color:var(--line-1)] dark:border-[var(--line-1)] bg-[color:var(--surface-1)] dark:bg-[var(--surface-1)]">
                <p className="text-xs font-semibold uppercase text-[var(--ink-3)] mb-2">Subscribes to</p>
                <div className="space-y-1">
                  {agent.bus_subscriptions.map(sub => (
                    <p key={sub} className="text-xs font-mono text-[color:var(--ink-2)] dark:text-[color:var(--ink-2)]">{sub}</p>
                  ))}
                </div>
              </div>
            )}
            {agent.bus_publications?.length > 0 && (
              <div className="p-3 rounded-lg border border-[color:var(--line-1)] dark:border-[var(--line-1)] bg-[color:var(--surface-1)] dark:bg-[var(--surface-1)]">
                <p className="text-xs font-semibold uppercase text-[var(--ink-3)] mb-2">Publishes to</p>
                <div className="space-y-1">
                  {agent.bus_publications.map(pub => (
                    <p key={pub} className="text-xs font-mono text-[color:var(--ink-2)] dark:text-[color:var(--ink-2)]">{pub}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Use, view is this page, edit returns to the workbench session */}
      <section className="mb-8 flex flex-wrap gap-4">
        {canUse ? (
          <Link
            href={`/agent-lab/agents/${encodeURIComponent(agent.slug)}`}
            className="inline-flex items-center gap-2 text-sm font-medium text-[color:var(--brand-a-ink)] hover:underline"
          >
            <ExternalLink className="h-4 w-4" />
            Use this agent
          </Link>
        ) : (
          <Link
            href={`/agent-staging/try?agent=${encodeURIComponent(agent.slug)}`}
            className="inline-flex items-center gap-2 text-sm font-medium text-[color:var(--brand-a-ink)] hover:underline"
          >
            <ExternalLink className="h-4 w-4" />
            Try in Inspector (staging)
          </Link>
        )}
        {editUrl && (
          <Link
            href={editUrl}
            className="inline-flex items-center gap-2 text-sm font-medium text-[color:var(--brand-a-ink)] hover:underline"
          >
            Edit in Workbench
          </Link>
        )}
      </section>

      {/* Related Agents */}
      {relatedAgents.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-[color:var(--ink-1)] dark:text-[color:var(--ink-1)] mb-3">
            Related Agents
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {relatedAgents.map(related => (
              <Link
                key={related.id}
                href={`/docs/agents/${related.slug}`}
                className="flex items-start gap-3 p-3 rounded-lg border border-[color:var(--line-1)] dark:border-[var(--line-1)] hover:border-[color:color-mix(in_srgb,var(--brand-a)_35%,transparent)] dark:hover:border-[color:var(--brand-a)] transition-colors bg-[color:var(--surface-1)] dark:bg-[var(--surface-1)]"
              >
                <Bot className="h-4 w-4 text-[var(--ink-3)] mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[color:var(--ink-1)] dark:text-[color:var(--ink-1)] truncate">
                    {related.name}
                  </p>
                  <p className="text-xs text-[var(--ink-3)] dark:text-[color:var(--ink-3)] line-clamp-2 mt-0.5">
                    {related.description}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Back link */}
      <div className="pt-4 border-t border-[color:var(--line-1)] dark:border-[var(--line-1)]">
        <Link
          href="/docs/agents"
          className="inline-flex items-center gap-1.5 text-xs text-[var(--ink-3)] hover:text-[color:var(--ink-2)] dark:hover:text-[color:var(--ink-3)] dark:hover:text-[color:var(--ink-1)] transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to all agents
        </Link>
      </div>
    </div>
  );
}
