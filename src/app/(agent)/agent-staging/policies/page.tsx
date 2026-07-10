'use client';

import { useState, useEffect, useCallback } from 'react';
import { PolicyList } from '@/components/agent-lab/policies/PolicyList';
import { PolicyEditor } from '@/components/agent-lab/policies/PolicyEditor';

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

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<PolicyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PolicyEntry | null>(null);
  const [creating, setCreating] = useState(false);

  const loadPolicies = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/policies');
      const json = await res.json();
      setPolicies(json.items || []);
    } catch {
      setPolicies([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPolicies(); }, [loadPolicies]);

  const handleSave = useCallback(async (data: Record<string, any>) => {
    if (data.id) {
      await fetch(`/api/policies/${data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    } else {
      await fetch('/api/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    }
    setEditing(null);
    setCreating(false);
    loadPolicies();
  }, [loadPolicies]);

  return (
    <div className="p-6 max-w-6xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Policies</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Guardrails as code · Cost ceilings · Tool allowlists</p>
      </div>

      {(creating || editing) ? (
        <div className="border rounded-lg dark:border-[#2d333b] bg-white dark:bg-[#0f131a] p-4">
          <PolicyEditor
            initial={editing || undefined}
            onSave={handleSave}
            onCancel={() => { setEditing(null); setCreating(false); }}
          />
        </div>
      ) : (
        <PolicyList
          policies={policies}
          loading={loading}
          onSelect={setEditing}
          onCreateNew={() => setCreating(true)}
        />
      )}
    </div>
  );
}
