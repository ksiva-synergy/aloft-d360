'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Archive, BookOpen, ChevronRight, Info, Loader2, Plus } from 'lucide-react';
import Link from '@/lib/navigation/link';
import { useRouter } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { Chip, btn } from '@/views/agent-lab/flows/ui';
import { api, area, field, plural, ScopeChip, when, type KnowledgeBase, type PageContext } from './shared';

// Knowledge bases: documents and Q&A that agents and automations can search, with citations.
// Personal ones belong to their owner; organisation ones are created (or promoted) by admins and
// everyone can search them. Teams come later. Who may change what is decided by the server.

function CreateForm({ ctx, onCancel, onCreated }: { ctx: PageContext; onCancel: () => void; onCreated: (kb: KnowledgeBase) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<'personal' | 'org'>('personal');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await api<{ knowledgeBase?: KnowledgeBase }>('/api/knowledge', { method: 'POST', body: { name, description, scope } });
    setBusy(false);
    if (res.ok && res.data.knowledgeBase) onCreated(res.data.knowledgeBase);
    else setError(res.data.error ?? `Could not create it (${res.status})`);
  };

  return (
    <form onSubmit={submit} aria-label="New knowledge base" className="mt-6 space-y-4 rounded-2xl border border-[var(--line-1)] bg-[var(--surface-1)] p-5 shadow-sm">
      <h2 className="text-size-body-lg font-semibold text-[var(--ink-1)]">New knowledge base</h2>
      <label className="block">
        <span className="text-size-ui font-medium text-[var(--ink-1)]">Name</span>
        <input autoFocus className={cn(field, 'mt-1')} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Ballast water management" />
      </label>
      <label className="block">
        <span className="text-size-ui font-medium text-[var(--ink-1)]">
          What is in it <span className="font-normal text-[var(--ink-3)]">(optional)</span>
        </span>
        <textarea
          className={cn(area, 'mt-1')}
          rows={2}
          maxLength={1000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="The BWM plan, record book guidance and port state circulars. Agents read this to decide when to search it."
        />
      </label>
      {ctx.isAdmin && (
        <fieldset>
          <legend className="text-size-ui font-medium text-[var(--ink-1)]">Who can use it</legend>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {(
              [
                ['personal', 'Only me', 'Private to you. You can share it with the organisation later.'],
                ['org', 'Everyone in the organisation', 'Everyone can search it; admins manage it.'],
              ] as const
            ).map(([value, label, hint]) => (
              <label key={value} className={cn('flex cursor-pointer gap-2 rounded-xl border p-3', scope === value ? 'border-[var(--brand-a)] bg-[var(--brand-a-soft)]' : 'border-[var(--line-1)]')}>
                <input type="radio" name="scope" className="mt-1" checked={scope === value} onChange={() => setScope(value)} />
                <span>
                  <span className="block text-size-ui font-medium text-[var(--ink-1)]">{label}</span>
                  <span className="block text-size-caption text-[var(--ink-3)]">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {error && <p className="rounded-lg bg-[var(--bad-bg)] px-3 py-2 text-size-ui text-[var(--bad)]">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btn.ghost} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className={btn.primary} disabled={busy || !name.trim()}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Create
        </button>
      </div>
    </form>
  );
}

function Row({ kb }: { kb: KnowledgeBase }) {
  return (
    <li>
      <Link href={`/agent-lab/knowledge/${kb.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-2)]">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-a-soft)] text-[var(--brand-a-ink)]">
          <BookOpen className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-size-body font-medium text-[var(--ink-1)]">{kb.name}</span>
            <ScopeChip kb={kb} />
            {kb.archived && (
              <Chip>
                <Archive className="h-3 w-3" aria-hidden /> Archived
              </Chip>
            )}
          </span>
          {kb.description && <span className="mt-0.5 block truncate text-size-ui text-[var(--ink-3)]">{kb.description}</span>}
          <span className="mt-0.5 block text-size-caption text-[var(--ink-3)]">
            {plural(kb.documents, 'document')} ready · {plural(kb.pieces, 'piece')}
            {kb.lastIndexedAt ? ` · updated ${when(kb.lastIndexedAt)}` : ''}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-[var(--ink-3)]" aria-hidden />
      </Link>
    </li>
  );
}

export default function KnowledgePage() {
  const router = useRouter();
  const [list, setList] = useState<KnowledgeBase[] | null>(null);
  const [ctx, setCtx] = useState<PageContext>({ isAdmin: false, uploads: { ready: true, maxMb: 50 } });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api<{ knowledgeBases?: KnowledgeBase[] } & Partial<PageContext>>('/api/knowledge').then((res) => {
      if (cancelled) return;
      if (!res.ok) return setLoadError(res.data.error ?? `Could not load knowledge bases (${res.status})`);
      setList(res.data.knowledgeBases ?? []);
      setCtx({ isAdmin: !!res.data.isAdmin, uploads: res.data.uploads ?? { ready: true, maxMb: 50 } });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const active = (list ?? []).filter((k) => !k.archived);
  const archived = (list ?? []).filter((k) => k.archived);
  const groups = [
    ['Yours', active.filter((k) => k.scope !== 'org' && k.mine)],
    ['Organisation', active.filter((k) => k.scope === 'org')],
    // Only platform admins see colleagues' personal knowledge bases.
    ["Colleagues' personal", active.filter((k) => k.scope !== 'org' && !k.mine)],
  ] as const;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-size-kpi-lg font-semibold tracking-tight text-[var(--ink-1)]">Knowledge</h1>
          <p className="mt-1 max-w-2xl text-size-body text-[var(--ink-3)]">
            Manuals, procedures, circulars and your own Q&amp;A, made searchable for your agents and automations. Every answer they give from it cites the document and
            page.
          </p>
        </div>
        {!creating && (
          <button type="button" className={btn.primary} onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New knowledge base
          </button>
        )}
      </div>

      {list && !ctx.uploads.ready && (
        <p role="note" className="mt-4 flex items-start gap-2 rounded-xl bg-[var(--warn-bg)] px-3 py-2 text-size-ui text-[var(--warn)]">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          File storage for knowledge is not set up yet, so files cannot be added. Q&amp;A written here works. An administrator sets KNOWLEDGE_BUCKET on the server.
        </p>
      )}

      {creating && <CreateForm ctx={ctx} onCancel={() => setCreating(false)} onCreated={(kb) => router.push(`/agent-lab/knowledge/${kb.id}`)} />}

      {loadError && <p className="mt-6 rounded-xl bg-[var(--bad-bg)] px-3 py-2 text-size-ui text-[var(--bad)]">{loadError}</p>}
      {!list && !loadError && (
        <div className="mt-6 space-y-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl border border-[var(--line-1)] bg-[var(--surface-1)]" />
          ))}
        </div>
      )}

      {list && active.length === 0 && !creating && (
        <div className="mt-8 rounded-2xl border border-dashed border-[var(--line-2)] px-6 py-12 text-center">
          <p className="text-size-body font-medium text-[var(--ink-1)]">No knowledge bases yet</p>
          <p className="mx-auto mt-1 max-w-md text-size-ui text-[var(--ink-3)]">
            Create one, then add PDFs, Word, Excel or PowerPoint files, scans and photos, or write questions and answers. Knowledge bases admins share with the
            organisation show up here too.
          </p>
        </div>
      )}

      {groups
        .filter(([, items]) => items.length > 0)
        .map(([title, items]) => (
          <section key={title} className="mt-6">
            <h2 className="mb-2 text-size-caption font-semibold uppercase tracking-wide text-[var(--ink-3)]">{title}</h2>
            <ul aria-label={title} className="divide-y divide-[var(--line-1)] overflow-hidden rounded-xl border border-[var(--line-1)] bg-[var(--surface-1)]">
              {items.map((kb) => (
                <Row key={kb.id} kb={kb} />
              ))}
            </ul>
          </section>
        ))}

      {archived.length > 0 && (
        <section className="mt-6">
          <button type="button" className={btn.ghost} aria-expanded={showArchived} onClick={() => setShowArchived((v) => !v)}>
            <Archive className="h-4 w-4" /> {showArchived ? 'Hide' : 'Show'} archived ({archived.length})
          </button>
          {showArchived && (
            <ul aria-label="Archived" className="mt-2 divide-y divide-[var(--line-1)] overflow-hidden rounded-xl border border-[var(--line-1)] bg-[var(--surface-1)] opacity-80">
              {archived.map((kb) => (
                <Row key={kb.id} kb={kb} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
