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
  orchestrator: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  worker: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  planner: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  validator: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  router: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
};

export function AgentDocPage({ agent, relatedAgents = [] }: AgentDocPageProps) {
  const inputSchema = agent.input_schema ? JSON.parse(agent.input_schema) : null;
  const outputSchema = agent.output_schema ? JSON.parse(agent.output_schema) : null;

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-6">
        <Link href="/docs" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
          Docs
        </Link>
        <span>/</span>
        <Link href="/docs/agents" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
          Agents
        </Link>
        <span>/</span>
        <span className="text-slate-700 dark:text-slate-200 font-medium">{agent.name}</span>
      </nav>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {agent.name}
          </h1>
          <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${TYPE_COLORS[agent.type] || 'bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-300'}`}>
            {agent.type}
          </span>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
          {agent.description || 'No description available.'}
        </p>

        {/* Metadata */}
        <div className="flex flex-wrap items-center gap-4 mt-4 text-xs text-slate-500 dark:text-slate-400">
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
            <Tag className="h-3 w-3 text-slate-400" />
            {agent.tags.map(tag => (
              <span
                key={tag}
                className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Tools Used */}
      {agent.tools && agent.tools.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-3">
            Tools
          </h2>
          <div className="flex flex-wrap gap-2">
            {agent.tools.map(toolName => (
              <Link
                key={toolName}
                href={`/docs/tools/${toolName}`}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#2d333b] hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors bg-white dark:bg-[#161b22]"
              >
                <Wrench className="h-3 w-3 text-slate-400" />
                <span className="text-slate-700 dark:text-slate-300">{toolName}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Input Schema */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-3">
          Input Schema
        </h2>
        <SchemaTable schema={inputSchema} title="Input" />
      </section>

      {/* Output Schema */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-3">
          Output Schema
        </h2>
        <SchemaTable schema={outputSchema} title="Output" />
      </section>

      {/* Configuration */}
      {agent.config && Object.keys(agent.config).length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-3">
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
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-3">
            Event Bus
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {agent.bus_subscriptions?.length > 0 && (
              <div className="p-3 rounded-lg border border-slate-200 dark:border-[#2d333b] bg-white dark:bg-[#161b22]">
                <p className="text-[10px] font-semibold uppercase text-slate-500 mb-2">Subscribes to</p>
                <div className="space-y-1">
                  {agent.bus_subscriptions.map(sub => (
                    <p key={sub} className="text-xs font-mono text-slate-700 dark:text-slate-300">{sub}</p>
                  ))}
                </div>
              </div>
            )}
            {agent.bus_publications?.length > 0 && (
              <div className="p-3 rounded-lg border border-slate-200 dark:border-[#2d333b] bg-white dark:bg-[#161b22]">
                <p className="text-[10px] font-semibold uppercase text-slate-500 mb-2">Publishes to</p>
                <div className="space-y-1">
                  {agent.bus_publications.map(pub => (
                    <p key={pub} className="text-xs font-mono text-slate-700 dark:text-slate-300">{pub}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Try it */}
      <section className="mb-8">
        <Link
          href="/agent-staging"
          className="inline-flex items-center gap-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
        >
          <ExternalLink className="h-4 w-4" />
          Try it in Agent Staging
        </Link>
      </section>

      {/* Related Agents */}
      {relatedAgents.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-3">
            Related Agents
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {relatedAgents.map(related => (
              <Link
                key={related.id}
                href={`/docs/agents/${related.slug}`}
                className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 dark:border-[#2d333b] hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors bg-white dark:bg-[#161b22]"
              >
                <Bot className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                    {related.name}
                  </p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5">
                    {related.description}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Back link */}
      <div className="pt-4 border-t border-slate-200 dark:border-[#2d333b]">
        <Link
          href="/docs/agents"
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-400 dark:hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to all agents
        </Link>
      </div>
    </div>
  );
}
