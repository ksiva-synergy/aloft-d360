'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bot, ExternalLink, Loader2, Plus, X } from 'lucide-react';
import Link from '@/lib/navigation/link';
import { Chip, btn } from '@/views/agent-lab/flows/ui';
import { api, field, type KnowledgeBase } from './shared';

// Which saved agents may search this knowledge base. Whoever manages the knowledge base decides.
// An agent searches it only for people who may see it, so linking a personal knowledge base to a
// shared agent never shows it to anyone else.

type Link = { agentId: string; slug: string | null; name: string; status: string | null };
type AgentOption = { slug: string; name: string; status: string | null; description: string | null };

export function AgentsTab({ kb, canEdit, notify, onCount }: { kb: KnowledgeBase; canEdit: boolean; notify: (tone: 'ok' | 'bad', text: string) => void; onCount: (n: number) => void }) {
  const [links, setLinks] = useState<Link[] | null>(null);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void api<{ links?: Link[]; agents?: AgentOption[] }>(`/api/knowledge/${kb.id}/agents`).then((res) => {
      if (!res.ok) return notify('bad', res.data.error ?? 'Could not load the agents');
      setLinks(res.data.links ?? []);
      setAgents(res.data.agents ?? []);
      onCount(res.data.links?.length ?? 0);
    });
  }, [kb.id, notify, onCount]);
  useEffect(load, [load]);

  const add = async () => {
    setBusy(true);
    const res = await api(`/api/knowledge/${kb.id}/agents`, { method: 'POST', body: { agentSlug: choice } });
    setBusy(false);
    if (!res.ok) return notify('bad', res.data.error ?? 'Could not add the agent');
    setChoice('');
    load();
  };
  const remove = async (l: Link) => {
    const res = await api(`/api/knowledge/${kb.id}/agents/${l.agentId}`, { method: 'DELETE' });
    if (!res.ok) return notify('bad', res.data.error ?? 'Could not remove the agent');
    load();
  };

  if (!links) return <Loader2 className="mx-auto h-5 w-5 animate-spin text-[var(--ink-3)]" aria-label="Loading agents" />;
  const available = agents.filter((a) => !links.some((l) => l.slug === a.slug));
  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-size-ui text-[var(--ink-3)]">
        These agents can search this knowledge base and cite it when they answer, in agent chat and in Automate.{' '}
        {kb.scope === 'org'
          ? 'Everyone who uses them gets answers from it.'
          : 'It stays personal: only people who can see it get answers from it, even when others use the same agent.'}
      </p>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <select className={`${field} max-w-sm`} aria-label="Agent to add" value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">{available.length ? 'Choose a saved agent…' : 'No other saved agents'}</option>
            {available.map((a) => (
              <option key={a.slug} value={a.slug}>
                {a.name}
                {a.status ? ` · ${a.status}` : ''}
              </option>
            ))}
          </select>
          <button type="button" className={`${btn.primary} h-9`} disabled={!choice || busy} onClick={() => void add()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add agent
          </button>
        </div>
      )}
      {links.length === 0 ? (
        <p className="py-6 text-center text-size-ui text-[var(--ink-3)]">No agent uses this knowledge base yet.</p>
      ) : (
        <ul aria-label="Agents using this knowledge base" className="divide-y divide-[var(--line-1)] overflow-hidden rounded-xl border border-[var(--line-1)] bg-[var(--surface-1)]">
          {links.map((l) => (
            <li key={l.agentId} className="flex items-center gap-3 px-4 py-2.5">
              <Bot className="h-4 w-4 shrink-0 text-[var(--ink-3)]" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-size-ui font-medium text-[var(--ink-1)]">{l.name}</span>
              {l.status && <Chip>{l.status}</Chip>}
              {l.slug && (
                <Link href={`/agent-lab/agents/${l.slug}`} className={btn.icon} aria-label={`Open ${l.name}`} title="Chat with this agent">
                  <ExternalLink className="h-4 w-4" />
                </Link>
              )}
              {canEdit && (
                <button type="button" className={btn.icon} aria-label={`Remove ${l.name}`} onClick={() => void remove(l)}>
                  <X className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
