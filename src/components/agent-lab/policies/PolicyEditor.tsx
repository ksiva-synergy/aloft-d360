'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Save, X } from 'lucide-react';

interface PolicyEditorProps {
  initial?: {
    id?: string;
    name?: string;
    type?: string;
    scope?: string;
    scope_id?: string;
    config?: Record<string, any>;
    enforcement?: string;
  };
  onSave: (policy: Record<string, any>) => Promise<void>;
  onCancel: () => void;
}

const TYPES = [
  { value: 'cost_ceiling', label: 'Cost Ceiling' },
  { value: 'tool_allowlist', label: 'Tool Allowlist' },
  { value: 'tool_denylist', label: 'Tool Denylist' },
  { value: 'model_allowlist', label: 'Model Allowlist' },
  { value: 'env_scope', label: 'Environment Scope' },
  { value: 'rate_limit', label: 'Rate Limit' },
  { value: 'data_classification', label: 'Data Classification' },
];

const SCOPES = [
  { value: 'global', label: 'Global' },
  { value: 'catalog_entry', label: 'Catalog Entry' },
  { value: 'pipeline', label: 'Pipeline' },
  { value: 'environment', label: 'Environment' },
];

const ENFORCEMENTS = [
  { value: 'block', label: 'Block', desc: 'Prevent action entirely' },
  { value: 'warn', label: 'Warn', desc: 'Allow but flag warning' },
  { value: 'log', label: 'Log', desc: 'Record silently' },
];

export function PolicyEditor({ initial, onSave, onCancel }: PolicyEditorProps) {
  const [name, setName] = useState(initial?.name || '');
  const [type, setType] = useState(initial?.type || 'cost_ceiling');
  const [scope, setScope] = useState(initial?.scope || 'global');
  const [scopeId, setScopeId] = useState(initial?.scope_id || '');
  const [enforcement, setEnforcement] = useState(initial?.enforcement || 'block');
  const [configJson, setConfigJson] = useState(
    JSON.stringify(initial?.config || {}, null, 2)
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      let config: Record<string, any>;
      try {
        config = JSON.parse(configJson);
      } catch {
        return;
      }

      await onSave({
        ...(initial?.id ? { id: initial.id } : {}),
        name,
        type,
        scope,
        scope_id: scopeId || undefined,
        config,
        enforcement,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {initial?.id ? 'Edit Policy' : 'New Policy'}
        </h3>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <X className="h-3.5 w-3.5 mr-1" /> Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!name || saving}>
            <Save className="h-3.5 w-3.5 mr-1" /> {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium block mb-1.5">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. ParserAgent cost ceiling"
            className="w-full px-3 py-1.5 text-sm border rounded-md bg-white dark:bg-[#161b24] dark:border-[#2d333b] focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium block mb-1.5">
            Type
          </label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full px-3 py-1.5 text-sm border rounded-md bg-white dark:bg-[#161b24] dark:border-[#2d333b] focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium block mb-1.5">
            Scope
          </label>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="w-full px-3 py-1.5 text-sm border rounded-md bg-white dark:bg-[#161b24] dark:border-[#2d333b] focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {SCOPES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        {scope !== 'global' && (
          <div>
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium block mb-1.5">
              Scope ID
            </label>
            <input
              type="text"
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
              placeholder="Entry/pipeline/env ID"
              className="w-full px-3 py-1.5 text-sm border rounded-md bg-white dark:bg-[#161b24] dark:border-[#2d333b] focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        )}
      </div>

      <div>
        <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium block mb-1.5">
          Enforcement
        </label>
        <div className="flex gap-2">
          {ENFORCEMENTS.map((e) => (
            <button
              key={e.value}
              onClick={() => setEnforcement(e.value)}
              className={cn(
                'px-3 py-1.5 text-xs rounded-md border transition-colors',
                enforcement === e.value
                  ? 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-300 dark:border-indigo-500/30 text-indigo-600 dark:text-indigo-400'
                  : 'bg-white dark:bg-[#161b24] border-slate-200 dark:border-[#2d333b] text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-[#1c2128]',
              )}
            >
              <span className="font-medium">{e.label}</span>
              <span className="text-muted-foreground ml-1">· {e.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium block mb-1.5">
          Config (JSON)
        </label>
        <textarea
          value={configJson}
          onChange={(e) => setConfigJson(e.target.value)}
          rows={6}
          spellCheck={false}
          className="w-full px-3 py-2 text-xs font-mono border rounded-md bg-white dark:bg-[#161b24] dark:border-[#2d333b] focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-y"
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          {type === 'cost_ceiling' && 'e.g. { "max_cost_per_run": 0.50, "currency": "USD" }'}
          {type === 'tool_allowlist' && 'e.g. { "tools": ["search_contracts", "parse_pdf"] }'}
          {type === 'tool_denylist' && 'e.g. { "tools": ["delete_contract"] }'}
          {type === 'model_allowlist' && 'e.g. { "models": ["claude-sonnet-4-20250514", "gpt-4o"] }'}
          {type === 'env_scope' && 'e.g. { "environments": ["dev", "staging"] }'}
          {type === 'rate_limit' && 'e.g. { "max_rps": 10, "window_seconds": 60 }'}
          {type === 'data_classification' && 'e.g. { "required_classification": "PIIRedacted" }'}
        </p>
      </div>
    </div>
  );
}
