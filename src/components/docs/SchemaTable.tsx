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
      <p className="text-sm text-slate-400 italic">No schema defined</p>
    );
  }

  const properties = schema.properties || schema;
  const required = schema.required || [];

  if (typeof properties !== 'object' || Object.keys(properties).length === 0) {
    return (
      <div className={cn('rounded-lg border border-slate-200 dark:border-[#2d333b] p-4', className)}>
        <pre className="text-xs text-slate-600 dark:text-slate-300 overflow-auto whitespace-pre-wrap">
          {JSON.stringify(schema, null, 2)}
        </pre>
      </div>
    );
  }

  const rows = flattenProperties(properties, required);

  return (
    <div className={cn('overflow-hidden rounded-lg border border-slate-200 dark:border-[#2d333b]', className)}>
      {title && (
        <div className="px-4 py-2 bg-slate-50 dark:bg-[#161b22] border-b border-slate-200 dark:border-[#2d333b]">
          <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wider">
            {title}
          </h4>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50/50 dark:bg-[#0d1117] border-b border-slate-200 dark:border-[#2d333b]">
              <th className="text-left px-4 py-2 font-semibold text-slate-600 dark:text-slate-300">Parameter</th>
              <th className="text-left px-4 py-2 font-semibold text-slate-600 dark:text-slate-300">Type</th>
              <th className="text-center px-4 py-2 font-semibold text-slate-600 dark:text-slate-300">Required</th>
              <th className="text-left px-4 py-2 font-semibold text-slate-600 dark:text-slate-300">Description</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.name}
                className={cn(
                  'border-b border-slate-100 dark:border-[#1e2430] last:border-0',
                  i % 2 === 0 ? 'bg-white dark:bg-[#161b22]' : 'bg-slate-50/30 dark:bg-[#0d1117]/50'
                )}
              >
                <td className="px-4 py-2 font-mono text-indigo-600 dark:text-indigo-400">
                  {row.name}
                </td>
                <td className="px-4 py-2 font-mono text-emerald-600 dark:text-emerald-400">
                  {row.type}
                </td>
                <td className="px-4 py-2 text-center">
                  {row.required ? (
                    <span className="inline-block w-2 h-2 rounded-full bg-amber-500" title="Required" />
                  ) : (
                    <span className="text-slate-300 dark:text-slate-600">-</span>
                  )}
                </td>
                <td className="px-4 py-2 text-slate-600 dark:text-slate-400">
                  {row.description}
                  {row.default && (
                    <span className="ml-2 text-[10px] text-slate-400 dark:text-slate-500">
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
