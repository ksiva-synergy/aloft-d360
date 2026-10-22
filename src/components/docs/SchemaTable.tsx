'use client';

import { cn } from '@/lib/utils';

interface SchemaProperty {
  type?: string;
  description?: string;
  enum?: string[];
  default?: any;
  items?: SchemaProperty;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
}

interface SchemaTableProps {
  schema: Record<string, any> | null;
  title?: string;
  className?: string;
}

function flattenProperties(
  properties: Record<string, SchemaProperty>,
  required: string[] = [],
  prefix = ''
): Array<{
  name: string;
  type: string;
  required: boolean;
  description: string;
  default?: string;
}> {
  const rows: Array<{
    name: string;
    type: string;
    required: boolean;
    description: string;
    default?: string;
  }> = [];

  for (const [key, prop] of Object.entries(properties)) {
    const fullName = prefix ? `${prefix}.${key}` : key;
    let typeLabel = prop.type || 'any';

    if (prop.type === 'array' && prop.items) {
      typeLabel = `${prop.items.type || 'any'}[]`;
    }
    if (prop.enum) {
      typeLabel = prop.enum.map(v => `"${v}"`).join(' | ');
    }

    rows.push({
      name: fullName,
      type: typeLabel,
      required: required.includes(key),
      description: prop.description || '',
      default: prop.default !== undefined ? JSON.stringify(prop.default) : undefined,
    });

    if (prop.type === 'object' && prop.properties) {
      rows.push(
        ...flattenProperties(prop.properties, prop.required || [], fullName)
      );
    }
  }

  return rows;
}

export function SchemaTable({ schema, title, className }: SchemaTableProps) {
  if (!schema) {
    return (
      <p className="text-sm text-[var(--ink-3)] italic">No schema defined</p>
    );
  }

  const properties = schema.properties || schema;
  const required = schema.required || [];

  if (typeof properties !== 'object' || Object.keys(properties).length === 0) {
    return (
      <div className={cn('rounded-lg border border-[color:var(--line-1)] dark:border-[var(--line-1)] p-4', className)}>
        <pre className="text-xs text-[color:var(--ink-2)] dark:text-[color:var(--ink-2)] overflow-auto whitespace-pre-wrap">
          {JSON.stringify(schema, null, 2)}
        </pre>
      </div>
    );
  }

  const rows = flattenProperties(properties, required);

  return (
    <div className={cn('overflow-hidden rounded-lg border border-[color:var(--line-1)] dark:border-[var(--line-1)]', className)}>
      {title && (
        <div className="px-4 py-2 bg-[color:var(--surface-2)] dark:bg-[var(--surface-1)] border-b border-[color:var(--line-1)] dark:border-[var(--line-1)]">
          <h4 className="text-xs font-semibold text-[color:var(--ink-2)] dark:text-[color:var(--ink-1)] uppercase tracking-wider">
            {title}
          </h4>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-[color:color-mix(in_srgb,var(--surface-2)_50%,transparent)] dark:bg-[var(--background)] border-b border-[color:var(--line-1)] dark:border-[var(--line-1)]">
              <th className="text-left px-4 py-2 font-semibold text-[color:var(--ink-2)] dark:text-[color:var(--ink-2)]">Parameter</th>
              <th className="text-left px-4 py-2 font-semibold text-[color:var(--ink-2)] dark:text-[color:var(--ink-2)]">Type</th>
              <th className="text-center px-4 py-2 font-semibold text-[color:var(--ink-2)] dark:text-[color:var(--ink-2)]">Required</th>
              <th className="text-left px-4 py-2 font-semibold text-[color:var(--ink-2)] dark:text-[color:var(--ink-2)]">Description</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.name}
                className={cn(
                  'border-b border-[color:var(--line-1)] dark:border-[#1e2430] last:border-0',
                  i % 2 === 0 ? 'bg-[color:var(--surface-1)] dark:bg-[var(--surface-1)]' : 'bg-[color:color-mix(in_srgb,var(--surface-2)_30%,transparent)] dark:bg-[color-mix(in_srgb,var(--background)_50%,transparent)]'
                )}
              >
                <td className="px-4 py-2 font-mono text-[color:var(--brand-a-ink)] dark:text-[color:var(--brand-a-ink)]">
                  {row.name}
                </td>
                <td className="px-4 py-2 font-mono text-emerald-600 dark:text-emerald-400">
                  {row.type}
                </td>
                <td className="px-4 py-2 text-center">
                  {row.required ? (
                    <span className="inline-block w-2 h-2 rounded-full bg-amber-500" title="Required" />
                  ) : (
                    <span className="text-[color:var(--ink-3)] dark:text-[color:var(--ink-2)]">-</span>
                  )}
                </td>
                <td className="px-4 py-2 text-[color:var(--ink-2)] dark:text-[color:var(--ink-3)]">
                  {row.description}
                  {row.default && (
                    <span className="ml-2 text-xs text-[var(--ink-3)] dark:text-[color:var(--ink-3)]">
                      (default: {row.default})
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
