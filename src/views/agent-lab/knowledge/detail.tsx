'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Archive, ArchiveRestore, ArrowLeft, Building2, Loader2, Lock, Settings, Trash2, X } from 'lucide-react';
import Link from '@/lib/navigation/link';
import { useParams, useRouter } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { Chip, Segmented, btn } from '@/views/agent-lab/flows/ui';
import { AgentsTab } from './agents';
import { DocumentsTab } from './documents';
import { QaTab } from './qa';
import { SearchTab } from './search';
import { api, area, field, inProgress, plural, ScopeChip, type KnowledgeBase, type KnowledgeDocument, type PageContext } from './shared';

type Tab = 'documents' | 'qa' | 'search' | 'agents';
type Notice = { tone: 'ok' | 'bad'; text: string } | null;

function SettingsPanel({ kb, ctx, onSaved, onDeleted, onClose }: { kb: KnowledgeBase; ctx: PageContext; onSaved: (kb: KnowledgeBase) => void; onDeleted: () => void; onClose: () => void }) {
  const [name, setName] = useState(kb.name);
  const [description, setDescription] = useState(kb.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const patch = async (what: string, body: Record<string, unknown>) => {
    setBusy(what);
    setError(null);
    const res = await api<{ knowledgeBase?: KnowledgeBase }>(`/api/knowledge/${kb.id}`, { method: 'PATCH', body });
    setBusy(null);
    if (res.ok && res.data.knowledgeBase) onSaved(res.data.knowledgeBase);
    else setError(res.data.error ?? 'Could not save');
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    void patch('save', { name, description });
  };
  const confirmThen = (text: string, fn: () => void) => () => {
    if (typeof window.confirm !== 'function' || window.confirm(text)) fn();
  };
  const remove = async () => {
    setBusy('delete');
    const res = await api(`/api/knowledge/${kb.id}`, { method: 'DELETE' });
    setBusy(null);
    if (res.ok) onDeleted();
    else setError(res.data.error ?? 'Could not delete');
  };

  return (
    <section aria-label="Settings" className="mt-6 space-y-5 rounded-2xl border border-[var(--line-1)] bg-[var(--surface-1)] p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-size-body-lg font-semibold text-[var(--ink-1)]">Settings</h2>
        <button type="button" className={btn.icon} aria-label="Close settings" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </div>
      <form onSubmit={save} className="space-y-3">
        <label className="block">
          <span className="text-size-ui font-medium text-[var(--ink-1)]">Name</span>
          <input className={cn(field, 'mt-1')} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-size-ui font-medium text-[var(--ink-1)]">What is in it</span>
          <textarea className={cn(area, 'mt-1')} rows={2} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
          <span className="mt-1 block text-size-caption text-[var(--ink-3)]">Agents read this to decide when to search this knowledge base, so say what it covers.</span>
        </label>
        <div className="flex justify-end">
          <button type="submit" className={btn.primary} disabled={!!busy || !name.trim() || (name === kb.name && description === (kb.description ?? ''))}>
            {busy === 'save' && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </button>
        </div>
      </form>

      {ctx.isAdmin && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line-1)] pt-4">
          <div>
            <p className="text-size-ui font-medium text-[var(--ink-1)]">Who can use it</p>
            <p className="text-size-caption text-[var(--ink-3)]">
              {kb.scope === 'org' ? 'Everyone in the organisation can search it; admins manage it.' : `Only ${kb.mine ? 'you' : (kb.ownerName ?? 'its owner')}.`}
            </p>
          </div>
          {kb.scope === 'org' ? (
            <button
              type="button"
              className={btn.secondary}
              disabled={!!busy}
              onClick={confirmThen('Make it personal again? Colleagues, and their agents and automations, lose access to it.', () => void patch('scope', { scope: 'personal' }))}
            >
              <Lock className="h-4 w-4" /> Make personal
            </button>
          ) : (
            <button
              type="button"
              className={btn.secondary}
              disabled={!!busy}
              onClick={confirmThen('Share it with the whole organisation? Everyone can then search it and cite it; only admins can change it.', () => void patch('scope', { scope: 'org' }))}
            >
              <Building2 className="h-4 w-4" /> Share with the organisation
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line-1)] pt-4">
        <div>
          <p className="text-size-ui font-medium text-[var(--ink-1)]">{kb.archived ? 'Archived' : 'Archive'}</p>
          <p className="text-size-caption text-[var(--ink-3)]">
            {kb.archived ? 'Not searched by anyone. Restore it to use it again, or delete it for good.' : 'Stops all searches of it and hides it; nothing is deleted.'}
          </p>
        </div>
        <div className="flex gap-2">
          {kb.archived ? (
            <>
              <button type="button" className={btn.secondary} disabled={!!busy} onClick={() => void patch('archive', { archived: false })}>
                <ArchiveRestore className="h-4 w-4" /> Restore
              </button>
              <button
                type="button"
                className={cn(btn.secondary, 'text-[var(--bad)]')}
                disabled={!!busy}
                onClick={confirmThen(`Delete "${kb.name}" for good? ${plural(kb.documents, 'document')}, their stored files and all Q&A are removed. This cannot be undone.`, () => void remove())}
              >
                {busy === 'delete' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete
              </button>
            </>
          ) : (
            <button
              type="button"
              className={btn.secondary}
              disabled={!!busy}
              onClick={confirmThen('Archive it? Agents and automations that use it stop finding anything in it until it is restored.', () => void patch('archive', { archived: true }))}
            >
              <Archive className="h-4 w-4" /> Archive
            </button>
          )}
        </div>
      </div>
      {error && <p className="rounded-lg bg-[var(--bad-bg)] px-3 py-2 text-size-ui text-[var(--bad)]">{error}</p>}
    </section>
  );
}

function KnowledgeBaseView({ id }: { id: string }) {
  const router = useRouter();
  const [kb, setKb] = useState<KnowledgeBase | null>(null);
  const [ctx, setCtx] = useState<PageContext>({ isAdmin: false, uploads: { ready: true, maxMb: 50 } });
  const [docs, setDocs] = useState<KnowledgeDocument[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('documents');
  const [settings, setSettings] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [agentCount, setAgentCount] = useState<number | null>(null);
  const notify = useCallback((tone: 'ok' | 'bad', text: string) => setNotice({ tone, text }), []);

  const reload = useCallback(() => {
    void api<{ knowledgeBase?: KnowledgeBase } & Partial<PageContext>>(`/api/knowledge/${id}`).then((res) => {
      if (!res.ok || !res.data.knowledgeBase) return setLoadError(res.status === 404 ? 'This knowledge base does not exist or is not shared with you.' : (res.data.error ?? 'Could not load it'));
      setKb(res.data.knowledgeBase); // counts change as documents become ready
      setCtx({ isAdmin: !!res.data.isAdmin, uploads: res.data.uploads ?? { ready: true, maxMb: 50 } });
    });
    void api<{ documents?: KnowledgeDocument[] }>(`/api/knowledge/${id}/documents`).then((res) => {
      if (res.ok) setDocs(res.data.documents ?? []);
    });
  }, [id]);

  useEffect(reload, [reload]);

  // While documents are being read, check again every few seconds.
  const reading = (docs ?? []).filter(inProgress).length;
  useEffect(() => {
    if (!reading) return;
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [reading, reload]);

  if (loadError)
    return (
      <div className="mx-auto max-w-5xl px-6 py-10">
        <Link href="/agent-lab/knowledge" className={btn.ghost}>
          <ArrowLeft className="h-4 w-4" /> Knowledge
        </Link>
        <p className="mt-6 rounded-xl bg-[var(--bad-bg)] px-3 py-2 text-size-ui text-[var(--bad)]">{loadError}</p>
      </div>
    );
  if (!kb || !docs)
    return (
      <div className="mx-auto max-w-5xl px-6 py-10" aria-busy>
        <div className="h-8 w-64 animate-pulse rounded-lg bg-[var(--surface-2)]" />
        <div className="mt-6 h-40 animate-pulse rounded-xl border border-[var(--line-1)] bg-[var(--surface-1)]" />
      </div>
    );

  const files = docs.filter((d) => d.kind === 'file').length;
  const qa = docs.length - files;
  const canEdit = kb.canManage && !kb.archived;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/agent-lab/knowledge" className={cn(btn.ghost, '-ml-2.5')}>
        <ArrowLeft className="h-4 w-4" /> Knowledge
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-size-kpi-lg font-semibold tracking-tight text-[var(--ink-1)]">{kb.name}</h1>
            <ScopeChip kb={kb} />
            {kb.archived && (
              <Chip>
                <Archive className="h-3 w-3" aria-hidden /> Archived
              </Chip>
            )}
          </div>
          {kb.description && <p className="mt-1 max-w-2xl text-size-body text-[var(--ink-3)]">{kb.description}</p>}
          <p className="mt-1 text-size-caption text-[var(--ink-3)]">
            {plural(kb.documents, 'document')} ready · {plural(kb.pieces, 'piece')}
            {reading ? ` · ${reading} being read` : ''}
          </p>
        </div>
        {kb.canManage && !settings && (
          <button type="button" className={btn.secondary} onClick={() => setSettings(true)}>
            <Settings className="h-4 w-4" /> Settings
          </button>
        )}
      </div>

      {settings && (
        <SettingsPanel
          kb={kb}
          ctx={ctx}
          onClose={() => setSettings(false)}
          onSaved={(next) => {
            setKb(next);
            notify('ok', 'Saved.');
          }}
          onDeleted={() => router.push('/agent-lab/knowledge')}
        />
      )}

      {notice && (
        <div role="status" className={cn('mt-4 flex items-start gap-2 rounded-xl px-3 py-2 text-size-ui', notice.tone === 'ok' ? 'bg-[var(--ok-bg)] text-[var(--ok)]' : 'bg-[var(--bad-bg)] text-[var(--bad)]')}>
          <span className="flex-1 break-words">{notice.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="mt-6 flex items-center justify-between">
        <Segmented
          label="Knowledge base sections"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'documents', label: `Documents${files ? ` (${files})` : ''}` },
            { value: 'qa', label: `Q&A${qa ? ` (${qa})` : ''}` },
            { value: 'search', label: 'Try a search' },
            { value: 'agents', label: `Agents${agentCount ? ` (${agentCount})` : ''}` },
          ]}
        />
      </div>
      <div className="mt-4">
        {/* Kept mounted so uploads in progress carry on (and stay visible) while another tab is open. */}
        <div hidden={tab !== 'documents'}>
          <DocumentsTab kbId={kb.id} docs={docs} ctx={ctx} canManage={canEdit} archived={kb.archived} reload={reload} notify={notify} />
        </div>
        {tab === 'qa' && <QaTab kbId={kb.id} docs={docs} canEdit={canEdit} reload={reload} notify={notify} />}
        {tab === 'search' && <SearchTab kbId={kb.id} readyDocuments={kb.documents} />}
        {tab === 'agents' && <AgentsTab kb={kb} canEdit={canEdit} notify={notify} onCount={setAgentCount} />}
      </div>
    </div>
  );
}

export default function KnowledgeBasePage() {
  const { id } = useParams<{ id: string }>();
  // Keyed by id so moving between knowledge bases starts fresh (uploads, tab, settings).
  return <KnowledgeBaseView key={id} id={id} />;
}
