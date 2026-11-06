'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Plus, Search, Shield, Loader2 } from 'lucide-react';

interface PolicyEntry {
  id: string;
  name: string;
  slug: string;
  type: string;
  scope: string;
  scope_id?: string;
  config: Record<string, any>;
  enforcement: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface PolicyListProps {
  policies: PolicyEntry[];
  loading?: boolean;
  onSelect?: (policy: PolicyEntry) => void;
  onCreateNew?: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  tool_allowlist: 'Tool Allowlist',
  tool_denylist: 'Tool Denylist',
  model_allowlist: 'Model Allowlist',
  cost_ceiling: 'Cost Ceiling',
  env_scope: 'Env Scope',
  rate_limit: 'Rate Limit',
  data_classification: 'Data Class.',
};

const SCOPE_LABELS: Record<string, string> = {
  global: 'Global',
  catalog_entry: 'Catalog Entry',
  pipeline: 'Pipeline',
  environment: 'Environment',
};

const ENFORCEMENT_STYLES: Record<string, string> = {
  block: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400',
  warn: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  log: 'bg-[color:var(--surface-2)] text-[color:var(--ink-2)] dark:bg-[color:var(--surface-2)] dark:text-[color:var(--ink-3)]',
};

export function PolicyList({ policies, loading, onSelect, onCreateNew }: PolicyListProps) {
  const [search, setSearch] = useState('');

  const filtered = policies.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.type.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search policies..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-size-body border rounded-md bg-[color:var(--surface-1)] dark:bg-[var(--surface-1)] dark:border-[var(--line-1)] focus:outline-none focus:ring-1 focus:ring-[color:var(--brand-a)]"
          />
        </div>
        {onCreateNew && (
          <Button size="sm" onClick={onCreateNew} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            New Policy
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading policies...
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Shield className="h-8 w-8 mb-2 opacity-20" />
          <p className="text-size-body">No policies found</p>
        </div>
      ) : (
        <div className="border rounded-lg dark:border-[var(--line-1)] overflow-hidden">
          <table className="w-full text-size-body">
            <thead>
              <tr className="border-b dark:border-[var(--line-1)] bg-[color:var(--surface-2)] dark:bg-[var(--background)]">
                <th className="text-left px-4 py-2.5 text-size-ui uppercase tracking-wide text-muted-foreground font-medium">Name</th>
                <th className="text-left px-4 py-2.5 text-size-ui uppercase tracking-wide text-muted-foreground font-medium">Type</th>
                <th className="text-left px-4 py-2.5 text-size-ui uppercase tracking-wide text-muted-foreground font-medium">Scope</th>
                <th className="text-left px-4 py-2.5 text-size-ui uppercase tracking-wide text-muted-foreground font-medium">Enforcement</th>
                <th className="text-left px-4 py-2.5 text-size-ui uppercase tracking-wide text-muted-foreground font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((policy) => (
                <tr
                  key={policy.id}
                  onClick={() => onSelect?.(policy)}
                  className="border-b last:border-b-0 dark:border-[var(--line-1)] hover:bg-[color:var(--surface-2)] dark:hover:bg-[var(--surface-2)] cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 font-medium">{policy.name}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="text-size-ui">
                      {TYPE_LABELS[policy.type] || policy.type}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-size-ui font-mono">
                    {SCOPE_LABELS[policy.scope] || policy.scope}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('text-size-ui px-2 py-0.5 rounded-full font-medium', ENFORCEMENT_STYLES[policy.enforcement])}>
                      {policy.enforcement}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'inline-flex items-center gap-1 text-size-ui',
                      policy.status === 'active' ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--ink-3)]'
                    )}>
                      <span className={cn('w-1.5 h-1.5 rounded-full', policy.status === 'active' ? 'bg-emerald-500' : 'bg-[color:var(--line-2)]')} />
                      {policy.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
