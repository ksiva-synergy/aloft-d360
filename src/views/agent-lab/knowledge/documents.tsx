'use client';

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  File as FileIcon,
  FileImage,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  FolderUp,
  Loader2,
  Presentation,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Chip, btn } from '@/views/agent-lab/flows/ui';
import { api, DocStatus, fileSize, pageList, plural, when, type KnowledgeDocument, type PageContext } from './shared';
import { ACCEPT, filesFromDrop, folderOf, sendFile, settle, toItems, uploadLanes, type PickedFile, type UploadItem } from './uploads';

function TypeIcon({ name, className }: { name: string; className: string }) {
  if (/\.(xlsx|csv)$/i.test(name)) return <FileSpreadsheet className={className} aria-hidden />;
  if (/\.pptx$/i.test(name)) return <Presentation className={className} aria-hidden />;
  if (/\.(png|jpe?g)$/i.test(name)) return <FileImage className={className} aria-hidden />;
  if (/\.(pdf|docx|txt|md|markdown)$/i.test(name)) return <FileText className={className} aria-hidden />;
  return <FileIcon className={className} aria-hidden />;
}

// ── Uploads ───────────────────────────────────────────────────────────────────────────────────

function UploadRow({ item, onRetry }: { item: UploadItem; onRetry: () => void }) {
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <TypeIcon name={item.file.name} className="h-4 w-4 shrink-0 text-[var(--ink-3)]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-size-ui text-[var(--ink-1)]">
          {item.folder && <span className="text-[var(--ink-3)]">{item.folder}/</span>}
          {item.file.name}
        </span>
        {item.state === 'uploading' && (
          <span className="mt-1 block h-1 overflow-hidden rounded-full bg-[var(--surface-2)]" role="progressbar" aria-valuenow={Math.round(item.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`Uploading ${item.file.name}`}>
            <span className="block h-full rounded-full bg-[var(--brand-a)] transition-[width]" style={{ width: `${Math.max(3, item.progress * 100)}%` }} />
          </span>
        )}
        {item.message && <span className={cn('block text-size-caption', item.state === 'failed' || item.state === 'skipped' ? 'text-[var(--bad)]' : 'text-[var(--ink-3)]')}>{item.message}</span>}
      </span>
      <span className="shrink-0 text-size-caption text-[var(--ink-3)]">{fileSize(item.file.size)}</span>
      <span className="w-28 shrink-0 text-right">
        {item.state === 'waiting' && <Chip>Waiting</Chip>}
        {item.state === 'uploading' && <Chip tone="brand">{Math.round(item.progress * 100)}%</Chip>}
        {item.state === 'saving' && (
          <Chip tone="brand">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Checking
          </Chip>
        )}
        {item.state === 'queued' && (
          <Chip tone="ok">
            <CheckCircle2 className="h-3 w-3" aria-hidden /> Added
          </Chip>
        )}
        {item.state === 'unchanged' && <Chip>Unchanged</Chip>}
        {item.state === 'skipped' && <Chip tone="bad">Not added</Chip>}
        {item.state === 'failed' &&
          (item.retryable ? (
            <button type="button" className={btn.ghost} onClick={onRetry}>
              <RotateCcw className="h-3.5 w-3.5" /> Try again
            </button>
          ) : (
            <Chip tone="bad">Refused</Chip>
          ))}
      </span>
    </li>
  );
}

function useUploads(knowledgeBaseId: string, maxMb: number, onSettled: () => void) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const seq = useRef({ n: 0 });
  const patch = (key: string, p: Partial<UploadItem>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));

  // One queue for the page's lifetime (the page is keyed by knowledge base).
  const [lanes] = useState(() =>
    uploadLanes<UploadItem>(2, async (item) => {
      const set = (p: Partial<UploadItem>) => setItems((list) => list.map((i) => (i.key === item.key ? { ...i, ...p } : i)));
      set({ state: 'uploading', progress: 0, message: undefined });
      const res = await sendFile(knowledgeBaseId, item, (sent) => set(sent >= 1 ? { state: 'saving', progress: 1 } : { progress: sent }));
      set(settle(res));
    }),
  );

  // Refresh the document list once files are added; several finishing together refresh it once.
  const added = items.filter((i) => i.state === 'queued').length;
  useEffect(() => {
    if (!added) return;
    const t = setTimeout(onSettled, 600);
    return () => clearTimeout(t);
  }, [added, onSettled]);

  const busy = items.some((i) => i.state === 'waiting' || i.state === 'uploading' || i.state === 'saving');
  // Leaving the page cancels uploads in flight; ask first.
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  return {
    items,
    busy,
    add(picked: PickedFile[]) {
      const next = toItems(picked, maxMb, seq.current);
      setItems((list) => [...list, ...next]);
      lanes.push(...next.filter((i) => i.state === 'waiting'));
    },
    retry(item: UploadItem) {
      patch(item.key, { state: 'waiting', message: undefined, retryable: undefined });
      lanes.push(item);
    },
    clearFinished: () => setItems((list) => list.filter((i) => i.state === 'waiting' || i.state === 'uploading' || i.state === 'saving' || (i.state === 'failed' && i.retryable))),
  };
}

function DropZone({ disabledReason, maxMb, onFiles }: { disabledReason: string | null; maxMb: number; onFiles: (f: PickedFile[]) => void }) {
  const [over, setOver] = useState(false);
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement | null>(null);
  const fromInput = (list: FileList | null) => {
    if (!list?.length) return;
    onFiles([...list].map((file) => ({ file, folder: folderOf((file as File & { webkitRelativePath?: string }).webkitRelativePath ?? '') })));
  };
  const drop = async (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (!disabledReason) onFiles(await filesFromDrop(e.dataTransfer));
  };

  if (disabledReason) return <p className="rounded-xl border border-dashed border-[var(--line-2)] px-4 py-6 text-center text-size-ui text-[var(--ink-3)]">{disabledReason}</p>;
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => void drop(e)}
      className={cn('rounded-xl border border-dashed px-4 py-6 text-center transition-colors', over ? 'border-[var(--brand-a)] bg-[var(--brand-a-soft)]' : 'border-[var(--line-2)]')}
    >
      <Upload className="mx-auto h-6 w-6 text-[var(--ink-3)]" aria-hidden />
      <p className="mt-2 text-size-ui font-medium text-[var(--ink-1)]">Drop files or whole folders here</p>
      <p className="mt-0.5 text-size-caption text-[var(--ink-3)]">PDF (digital or scanned), Word, Excel, CSV, PowerPoint, PNG, JPEG, text and Markdown · up to {maxMb} MB each</p>
      <div className="mt-3 flex justify-center gap-2">
        <button type="button" className={btn.secondary} onClick={() => files.current?.click()}>
          <Upload className="h-4 w-4" /> Choose files
        </button>
        <button type="button" className={btn.secondary} onClick={() => folder.current?.click()}>
          <FolderUp className="h-4 w-4" /> Choose a folder
        </button>
      </div>
      <input
        ref={files}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        data-testid="file-input"
        onChange={(e) => {
          fromInput(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={(el) => {
          folder.current = el;
          // Not in React's input props; set directly so a whole folder can be chosen.
          el?.setAttribute('webkitdirectory', '');
        }}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          fromInput(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

// ── Documents ─────────────────────────────────────────────────────────────────────────────────

function DocumentRow({ kbId, d, canManage, onRetry, onDelete }: { kbId: string; d: KnowledgeDocument; canManage: boolean; onRetry: () => void; onDelete: () => void }) {
  const facts = [
    d.pages ? plural(d.pages, 'page') : null,
    d.ocrPages ? `${d.ocrPages} read from scans` : null,
    d.status === 'indexed' ? plural(d.pieces, 'piece') : null,
    fileSize(d.sizeBytes) || null,
    d.uploadedByName,
    when(d.createdAt),
  ].filter(Boolean);
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <TypeIcon name={d.name} className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ink-3)]" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-size-ui font-medium text-[var(--ink-1)]">{d.name}</span>
          {d.version > 1 && <Chip>v{d.version}</Chip>}
          <DocStatus d={d} />
        </div>
        <p className="mt-0.5 text-size-caption text-[var(--ink-3)]">{facts.join(' · ')}</p>
        {d.replacing && <p className="mt-0.5 text-size-caption text-[var(--ink-3)]">The previous version stays searchable until this one is ready.</p>}
        {d.status === 'failed' && d.error && <p className="mt-1 text-size-caption text-[var(--bad)]">{d.error}</p>}
        {d.status === 'indexed' && d.failedPages.length > 0 && (
          <p className="mt-1 text-size-caption text-[var(--warn)]">{pageList(d.failedPages)} could not be read and are not searchable. A clearer scan fixes this.</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {canManage && d.status === 'failed' && (
          <button type="button" className={btn.ghost} onClick={onRetry}>
            <RotateCcw className="h-3.5 w-3.5" /> Retry
          </button>
        )}
        <a href={`/api/knowledge/${kbId}/documents/${d.id}`} className={btn.icon} aria-label={`Download ${d.name}`} title="Download the original">
          <Download className="h-4 w-4" />
        </a>
        {canManage && (
          <button type="button" className={btn.icon} onClick={onDelete} aria-label={`Delete ${d.name}`}>
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </li>
  );
}

export function DocumentsTab({
  kbId,
  docs,
  ctx,
  canManage,
  archived,
  reload,
  notify,
}: {
  kbId: string;
  docs: KnowledgeDocument[];
  ctx: PageContext;
  canManage: boolean;
  archived: boolean;
  reload: () => void;
  notify: (tone: 'ok' | 'bad', text: string) => void;
}) {
  const uploads = useUploads(kbId, ctx.uploads.maxMb, reload);
  const [filter, setFilter] = useState('');

  const files = useMemo(() => docs.filter((d) => d.kind === 'file'), [docs]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? files.filter((d) => `${d.folder ?? ''}/${d.name}`.toLowerCase().includes(q)) : files;
  }, [files, filter]);

  const done = uploads.items.filter((i) => i.state === 'queued' || i.state === 'unchanged').length;
  const problems = uploads.items.filter((i) => i.state === 'failed' || i.state === 'skipped').length;

  const retry = async (d: KnowledgeDocument) => {
    const res = await api(`/api/knowledge/${kbId}/documents/${d.id}`, { method: 'PATCH', body: { retry: true } });
    if (res.ok) reload();
    else notify('bad', res.data.error ?? 'Could not retry');
  };
  const remove = async (d: KnowledgeDocument) => {
    if (typeof window.confirm === 'function' && !window.confirm(`Delete "${d.name}"? Every version and the stored file are removed, and agents can no longer cite it.`)) return;
    const res = await api(`/api/knowledge/${kbId}/documents/${d.id}`, { method: 'DELETE' });
    if (res.ok) {
      notify('ok', `Deleted ${d.name}.`);
      reload();
    } else notify('bad', res.data.error ?? 'Could not delete');
  };

  const disabledReason = archived
    ? 'This knowledge base is archived. Restore it to add files.'
    : !ctx.uploads.ready
      ? 'File storage for knowledge is not set up yet (KNOWLEDGE_BUCKET), so files cannot be added. Q&A works.'
      : null;

  return (
    <div className="space-y-4">
      {canManage && <DropZone disabledReason={disabledReason} maxMb={ctx.uploads.maxMb} onFiles={uploads.add} />}

      {uploads.items.length > 0 && (
        <section aria-label="Uploads" className="overflow-hidden rounded-xl border border-[var(--line-1)] bg-[var(--surface-1)]">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--line-1)] px-3 py-2">
            <p className="text-size-ui text-[var(--ink-2)]">
              {uploads.busy ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              {done} of {uploads.items.length} added{problems ? `, ${problems} not added` : ''}
              {uploads.busy ? ' · keep this page open until uploads finish' : ''}
            </p>
            {!uploads.busy && (
              <button type="button" className={btn.ghost} onClick={uploads.clearFinished}>
                <X className="h-3.5 w-3.5" /> Clear
              </button>
            )}
          </div>
          <ul className="max-h-72 divide-y divide-[var(--line-1)] overflow-y-auto">
            {uploads.items.map((i) => (
              <UploadRow key={i.key} item={i} onRetry={() => uploads.retry(i)} />
            ))}
          </ul>
        </section>
      )}

      {files.length > 8 && (
        <label className="flex items-center gap-2 rounded-lg border border-[var(--line-1)] bg-[var(--surface-1)] px-2.5">
          <Search className="h-4 w-4 text-[var(--ink-3)]" aria-hidden />
          <input className="h-9 min-w-0 flex-1 bg-transparent text-size-ui outline-none" placeholder={`Find among ${files.length} documents`} value={filter} onChange={(e) => setFilter(e.target.value)} />
        </label>
      )}

      {files.length === 0 ? (
        <p className="py-8 text-center text-size-ui text-[var(--ink-3)]">No documents yet.</p>
      ) : (
        <ul aria-label="Documents" className="divide-y divide-[var(--line-1)] overflow-hidden rounded-xl border border-[var(--line-1)] bg-[var(--surface-1)]">
          {shown.map((d, i) => {
            // A heading where the folder changes (the list is sorted by folder).
            const header = d.folder && d.folder !== shown[i - 1]?.folder ? d.folder : null;
            return [
              header && (
                <li key={`folder:${header}`} className="flex items-center gap-2 bg-[var(--surface-2)] px-4 py-1.5 text-size-caption font-medium text-[var(--ink-2)]">
                  <FolderOpen className="h-3.5 w-3.5" aria-hidden /> {header}
                </li>
              ),
              <DocumentRow key={d.id} kbId={kbId} d={d} canManage={canManage} onRetry={() => void retry(d)} onDelete={() => void remove(d)} />,
            ];
          })}
          {shown.length === 0 && <li className="px-4 py-6 text-center text-size-ui text-[var(--ink-3)]">Nothing matches “{filter}”.</li>}
        </ul>
      )}
      {files.some((d) => d.status === 'failed') && (
        <p className="flex items-center gap-1.5 text-size-caption text-[var(--ink-3)]">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Temporary problems are retried on their own; Retry starts again now.
        </p>
      )}
    </div>
  );
}
