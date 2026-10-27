'use client';

import Link from '@/lib/navigation/link';
import { ArrowLeft, ExternalLink, Tag, Calendar, User, Wrench } from 'lucide-react';
import { SchemaTable } from './SchemaTable';
import { CodeExample } from './CodeExample';
import type { ToolCatalogEntry } from '@/types/catalog';

interface ToolDocPageProps {
  tool: ToolCatalogEntry;
  relatedTools?: ToolCatalogEntry[];
}

function generateUsageExample(tool: ToolCatalogEntry): string {
  const args: Record<string, any> = {};
  if (tool.input_schema?.properties) {
    for (const [key, prop] of Object.entries(tool.input_schema.properties as Record<string, any>)) {
      if (prop.type === 'string') args[key] = prop.example || `<${key}>`;
      else if (prop.type === 'number') args[key] = prop.example || 0;
      else if (prop.type === 'boolean') args[key] = prop.example ?? true;
      else if (prop.type === 'array') args[key] = [];
      else if (prop.type === 'object') args[key] = {};
      else args[key] = null;
    }
  }

  return JSON.stringify(
    {
      tool_name: tool.name,
      args,
    },
    null,
    2
  );
}

const TYPE_COLORS: Record<string, string> = {
  api_call: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  db_query: 'bg-[color:var(--brand-a-soft)] text-[color:var(--brand-a-ink)] dark:bg-[color:color-mix(in_srgb,var(--brand-a)_30%,transparent)] dark:text-[color:var(--brand-a-ink)]',
  file_op: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  transform: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  validation: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  custom: 'bg-[color:var(--surface-2)] text-[color:var(--ink-2)] dark:bg-[color:color-mix(in_srgb,var(--surface-1)_30%,transparent)] dark:text-[color:var(--ink-2)]',
};

export function ToolDocPage({ tool, relatedTools = [] }: ToolDocPageProps) {
  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-size-ui text-[var(--ink-3)] dark:text-[color:var(--ink-3)] mb-6">
        <Link href="/docs" className="hover:text-[color:var(--brand-a-ink)] dark:hover:text-[color:var(--brand-a-ink)] transition-colors">
          Docs
        </Link>
        <span>/</span>
        <Link href="/docs/tools" className="hover:text-[color:var(--brand-a-ink)] dark:hover:text-[color:var(--brand-a-ink)] transition-colors">
          Tools
        </Link>
        <span>/</span>
        <span className="text-[color:var(--ink-2)] dark:text-[color:var(--ink-1)] font-medium">{tool.name}</span>
      </nav>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <h1 className="text-size-kpi-lg font-semibold text-[color:var(--ink-1)] dark:text-[color:var(--ink-1)]">
            {tool.name}
          </h1>
          <span className={`text-size-ui font-semibold uppercase px-2 py-0.5 rounded-full ${TYPE_COLORS[tool.type] || TYPE_COLORS.custom}`}>
            {tool.type}
          </span>
        </div>
        <p className="text-size-body text-[color:var(--ink-2)] dark:text-[color:var(--ink-2)] leading-relaxed max-w-2xl">
          {tool.description || 'No description available.'}
        </p>

        {/* Metadata */}
        <div className="flex flex-wrap items-center gap-4 mt-4 text-size-ui text-[var(--ink-3)] dark:text-[color:var(--ink-3)]">
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            v{tool.version}
          </span>
          {tool.author && (
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {tool.author}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Wrench className="h-3 w-3" />
            {tool.status}
          </span>
        </div>

        {/* Tags */}
        {tool.tags && tool.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mt-3">
            <Tag className="h-3 w-3 text-[var(--ink-3)]" />
            {tool.tags.map(tag => (
              <span
                key={tag}
                className="text-size-ui px-2 py-0.5 rounded-full bg-[color:var(--surface-2)] dark:bg-[color:var(--surface-2)] text-[color:var(--ink-2)] dark:text-[color:var(--ink-2)]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Input Schema */}
      <section className="mb-8">
        <h2 className="text-size-body font-semibold text-[color:var(--ink-1)] dark:text-[color:var(--ink-1)] mb-3">
          Input Parameters
        </h2>
        <SchemaTable schema={tool.input_schema} title="Input Schema" />
      </section>

      {/* Output Schema */}
      <section className="mb-8">
        <h2 className="text-size-body font-semibold text-[color:var(--ink-1)] dark:text-[color:var(--ink-1)] mb-3">
          Output
        </h2>
        <SchemaTable schema={tool.output_schema} title="Output Schema" />
      </section>

      {/* Usage Example */}
      <section className="mb-8">
        <h2 className="text-size-body font-semibold text-[color:var(--ink-1)] dark:text-[color:var(--ink-1)] mb-3">
          Usage Example
        </h2>
        <CodeExample
          code={generateUsageExample(tool)}
          language="json"
          title="POST /api/backfill/agent-staging/tool-playground"
        />
      </section>

      {/* Try It */}
      <section className="mb-8">
        <Link
          href="/inspector"
          className="inline-flex items-center gap-2 text-size-body font-medium text-[color:var(--brand-a-ink)] dark:text-[color:var(--brand-a-ink)] hover:text-[color:var(--brand-a-ink)] dark:hover:text-[color:var(--brand-a-ink)] transition-colors"
        >
          <ExternalLink className="h-4 w-4" />
          Try in Inspector
        </Link>
      </section>

      {/* Configuration */}
      {tool.config && Object.keys(tool.config).length > 0 && (
        <section className="mb-8">
          <h2 className="text-size-body font-semibold text-[color:var(--ink-1)] dark:text-[color:var(--ink-1)] mb-3">
            Configuration
          </h2>
          <CodeExample
            code={JSON.stringify(tool.config, null, 2)}
            language="json"
            title="Tool Configuration"
          />
        </section>
      )}

      {/* Related Tools */}
      {relatedTools.length > 0 && (
        <section className="mb-8">
          <h2 className="text-size-body font-semibold text-[color:var(--ink-1)] dark:text-[color:var(--ink-1)] mb-3">
            Related Tools
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {relatedTools.map(related => (
              <Link
                key={related.id}
                href={`/docs/tools/${related.slug}`}
                className="flex items-start gap-3 p-3 rounded-lg border border-[color:var(--line-1)] dark:border-[var(--line-1)] hover:border-[color:color-mix(in_srgb,var(--brand-a)_35%,transparent)] dark:hover:border-[color:var(--brand-a)] transition-colors bg-[color:var(--surface-1)] dark:bg-[var(--surface-1)]"
              >
                <Wrench className="h-4 w-4 text-[var(--ink-3)] mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-size-ui font-semibold text-[color:var(--ink-1)] dark:text-[color:var(--ink-1)] truncate">
                    {related.name}
                  </p>
                  <p className="text-size-ui text-[var(--ink-3)] dark:text-[color:var(--ink-3)] line-clamp-2 mt-0.5">
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
          href="/docs/tools"
          className="inline-flex items-center gap-1.5 text-size-ui text-[var(--ink-3)] hover:text-[color:var(--ink-2)] dark:hover:text-[color:var(--ink-3)] dark:hover:text-[color:var(--ink-1)] transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to all tools
        </Link>
      </div>
    </div>
  );
}
