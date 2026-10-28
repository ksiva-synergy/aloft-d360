'use client';

import { useState, type FormEvent } from 'react';
import { Loader2, MessageSquareText, Pencil, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { btn } from '@/views/agent-lab/flows/ui';
import { api, area, DocStatus, when, type KnowledgeDocument } from './shared';

// Questions and answers written in the app: the things people keep asking that no manual says
// plainly. Each entry is searched as one piece; editing saves a new version.

function QaForm({ kbId, existing, onDone, onCancel }: { kbId: string; existing?: KnowledgeDocument; onDone: () => void; onCancel: () => void }) {
  const [question, setQuestion] = useState(existing?.question ?? '');
  const [answer, setAnswer] = useState(existing?.answer ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = existing
      ? await api(`/api/knowledge/${kbId}/documents/${existing.id}`, { method: 'PATCH', body: { question, answer } })
      : await api(`/api/knowledge/${kbId}/qa`, { method: 'POST', body: { question, answer } });
    setBusy(false);
    if (res.ok) onDone();
    else setError(res.data.error ?? 'Could not save');
  };
  return (
    <form onSubmit={submit} aria-label={existing ? 'Edit Q&A' : 'New Q&A'} className="space-y-3 rounded-xl border border-[var(--line-1)] bg-[var(--surface-1)] p-4">
      <label className="block">
        <span className="text-size-ui font-medium text-[var(--ink-1)]">Question</span>
        <textarea autoFocus className={cn(area, 'mt-1')} rows={2} maxLength={1000} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Who signs the Oil Record Book Part I?" />
      </label>
      <label className="block">
        <span className="text-size-ui font-medium text-[var(--ink-1)]">Answer</span>
        <textarea
          className={cn(area, 'mt-1')}
          rows={4}
          maxLength={10000}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="The officer in charge of each operation signs the entry; the master signs each completed page (MARPOL Annex I, reg. 17)."
        />
      </label>
      {error && <p className="rounded-lg bg-[var(--bad-bg)] px-3 py-2 text-size-ui text-[var(--bad)]">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btn.ghost} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className={btn.primary} disabled={busy || !question.trim() || !answer.trim()}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save
        </button>
      </div>
    </form>
  );
}

export function QaTab({
  kbId,
  docs,
  canEdit,
  reload,
  notify,
}: {
  kbId: string;
  docs: KnowledgeDocument[];
  canEdit: boolean;
  reload: () => void;
  notify: (tone: 'ok' | 'bad', text: string) => void;
}) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const entries = docs.filter((d) => d.kind === 'qa');
  const remove = async (d: KnowledgeDocument) => {
    if (typeof window.confirm === 'function' && !window.confirm('Delete this question and answer?')) return;
    const res = await api(`/api/knowledge/${kbId}/documents/${d.id}`, { method: 'DELETE' });
    if (res.ok) reload();
    else notify('bad', res.data.error ?? 'Could not delete');
  };
  const done = () => {
    setEditing(null);
    reload();
  };

  return (
    <div className="space-y-3">
      {canEdit && editing !== 'new' && (
        <button type="button" className={btn.secondary} onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" /> Add a question and answer
        </button>
      )}
      {editing === 'new' && <QaForm kbId={kbId} onDone={done} onCancel={() => setEditing(null)} />}
      {entries.length === 0 && editing !== 'new' && (
        <p className="py-8 text-center text-size-ui text-[var(--ink-3)]">No Q&amp;A yet. Write down what people keep asking and the answer you give them.</p>
      )}
      <ul aria-label="Questions and answers" className="space-y-2">
        {entries.map((d) =>
          editing === d.id ? (
            <li key={d.id}>
              <QaForm kbId={kbId} existing={d} onDone={done} onCancel={() => setEditing(null)} />
            </li>
          ) : (
            <li key={d.id} className="rounded-xl border border-[var(--line-1)] bg-[var(--surface-1)] px-4 py-3">
              <div className="flex items-start gap-3">
                <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ink-3)]" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-size-ui font-medium text-[var(--ink-1)]">{d.question}</p>
                  <p className="mt-1 whitespace-pre-wrap text-size-ui text-[var(--ink-2)]">{d.answer}</p>
                  <p className="mt-1.5 flex flex-wrap items-center gap-2 text-size-caption text-[var(--ink-3)]">
                    <DocStatus d={d} />
                    {d.uploadedByName && <span>{d.uploadedByName}</span>}
                    <span>{when(d.createdAt)}</span>
                    {d.version > 1 && <span>edited (v{d.version})</span>}
                  </p>
                  {d.status === 'failed' && d.error && <p className="mt-1 text-size-caption text-[var(--bad)]">{d.error}</p>}
                </div>
                {canEdit && (
                  <div className="flex shrink-0 gap-1">
                    <button type="button" className={btn.icon} aria-label="Edit" onClick={() => setEditing(d.id)}>
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button type="button" className={btn.icon} aria-label="Delete" onClick={() => void remove(d)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
