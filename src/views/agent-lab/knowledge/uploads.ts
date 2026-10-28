// Uploading to a knowledge base from the browser. Each file is its own request so it gets its own
// progress and result; two go at a time. The server checks everything again (type from the bytes,
// size, access); the checks here only save people a wait for a file that would be refused anyway.

export const ACCEPT = '.pdf,.docx,.xlsx,.csv,.pptx,.png,.jpg,.jpeg,.txt,.md,.markdown';
const SUPPORTED = new Set(['pdf', 'docx', 'xlsx', 'csv', 'pptx', 'png', 'jpg', 'jpeg', 'txt', 'text', 'md', 'markdown']);
const OLD_OFFICE: Record<string, string> = { doc: '.docx', xls: '.xlsx', ppt: '.pptx' };

export type PickedFile = { file: File; folder: string };

export type UploadState = 'waiting' | 'uploading' | 'saving' | 'queued' | 'unchanged' | 'failed' | 'skipped';
export type UploadItem = {
  key: string;
  file: File;
  folder: string;
  state: UploadState;
  /** 0–1 while uploading. */
  progress: number;
  message?: string;
  /** Whether "Try again" makes sense (a network or server problem, not a refused file). */
  retryable?: boolean;
};

const ext = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');

/** Files the operating system or Office leave behind; never meant to be added. */
export function isJunk(name: string): boolean {
  return name.startsWith('.') || name.startsWith('~$') || /^(thumbs\.db|desktop\.ini)$/i.test(name);
}

/** Why a file would be refused, or null when it can be sent. */
export function precheck(file: { name: string; size: number }, maxMb: number): string | null {
  const e = ext(file.name);
  if (OLD_OFFICE[e]) return `Old ${e.toUpperCase()} format: save it as ${OLD_OFFICE[e]} and add it again`;
  if (!SUPPORTED.has(e)) return 'This type of file cannot be added';
  if (file.size === 0) return 'The file is empty';
  if (file.size > maxMb * 1048576) return `${(file.size / 1048576).toFixed(1)} MB; the limit is ${maxMb} MB`;
  return null;
}

/** The folder a picked file sits in, from "Add folder" (`webkitRelativePath`) or a dropped folder. */
export function folderOf(relativePath: string): string {
  const parts = relativePath.split('/').filter(Boolean);
  return parts.slice(0, -1).join('/');
}

/** Turns picked or dropped files into upload rows: junk dropped, refused files marked with the reason. */
export function toItems(picked: PickedFile[], maxMb: number, seq: { n: number }): UploadItem[] {
  return picked
    .filter((p) => !isJunk(p.file.name))
    .map((p) => {
      const refused = precheck(p.file, maxMb);
      return {
        key: `u${++seq.n}`,
        file: p.file,
        folder: p.folder,
        state: refused ? 'skipped' : 'waiting',
        progress: 0,
        message: refused ?? undefined,
      } satisfies UploadItem;
    });
}

// ── Reading a drop (files and whole folders) ────────────────────────────────────────────────────

type Entry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (ok: (f: File) => void, fail: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (e: Entry[]) => void, fail: (e: unknown) => void) => void };
};

async function readEntry(entry: Entry, folder: string, out: PickedFile[], limit: number): Promise<void> {
  if (out.length >= limit) return;
  if (entry.isFile && entry.file) {
    out.push({ file: await new Promise<File>((ok, fail) => entry.file!(ok, fail)), folder });
    return;
  }
  if (entry.isDirectory && entry.createReader && !isJunk(entry.name)) {
    const reader = entry.createReader();
    const inner = folder ? `${folder}/${entry.name}` : entry.name;
    // readEntries hands back a batch at a time (about 100 in Chrome) until it returns none.
    for (;;) {
      const batch = await new Promise<Entry[]>((ok, fail) => reader.readEntries(ok, fail));
      if (!batch.length) break;
      for (const e of batch) await readEntry(e, inner, out, limit);
    }
  }
}

/** Files from a drop, walking into dropped folders and keeping each file's folder. */
export async function filesFromDrop(dt: DataTransfer, limit = 2000): Promise<PickedFile[]> {
  const entries = [...dt.items]
    .filter((i) => i.kind === 'file')
    .map((i) => (i as DataTransferItem & { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.() ?? null);
  if (!entries.length || entries.some((e) => !e)) return [...dt.files].map((file) => ({ file, folder: '' }));
  const out: PickedFile[] = [];
  for (const e of entries) await readEntry(e!, '', out, limit);
  return out;
}

// ── Sending ─────────────────────────────────────────────────────────────────────────────────────

export type UploadResponse = { status: number; body: { outcome?: 'queued' | 'unchanged'; error?: string; document?: { id: string; version: number } } };

/** One file to the knowledge base, with upload progress (fetch cannot report it; XHR can). */
export function sendFile(knowledgeBaseId: string, item: Pick<UploadItem, 'file' | 'folder'>, onProgress: (sent: number) => void): Promise<UploadResponse> {
  return new Promise((resolve) => {
    const form = new FormData();
    form.append('file', item.file, item.file.name);
    if (item.folder) form.append('folder', item.folder);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/knowledge/${encodeURIComponent(knowledgeBaseId)}/documents`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body: UploadResponse['body'] = {};
      try {
        body = JSON.parse(xhr.responseText || '{}');
      } catch {
        /* not JSON (proxy error page) */
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => resolve({ status: 0, body: { error: 'Could not reach the server' } });
    xhr.ontimeout = () => resolve({ status: 0, body: { error: 'The upload timed out' } });
    xhr.send(form);
  });
}

/** What a finished request means for the row. */
export function settle(res: UploadResponse): Pick<UploadItem, 'state' | 'message' | 'retryable' | 'progress'> {
  if (res.status === 201 || (res.status === 200 && res.body.outcome === 'queued')) {
    const v = res.body.document?.version ?? 1;
    return { state: 'queued', progress: 1, message: v > 1 ? `Added as version ${v}` : undefined };
  }
  if (res.status === 200 && res.body.outcome === 'unchanged') return { state: 'unchanged', progress: 1, message: 'Already here, unchanged' };
  const retryable = res.status === 0 || res.status === 409 || res.status === 429 || res.status >= 500;
  return { state: 'failed', progress: 0, retryable, message: res.body.error ?? `Upload failed (${res.status || 'network'})` };
}

/**
 * A queue that runs `work` on at most `concurrency` items at a time, in the order pushed. Files
 * picked while others are still uploading join the same queue.
 */
export function uploadLanes<T>(concurrency: number, work: (item: T) => Promise<void>) {
  const queue: T[] = [];
  let active = 0;
  const start = () => {
    while (active < concurrency && queue.length) {
      active++;
      void (async () => {
        try {
          for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item).catch(() => undefined);
        } finally {
          active--;
        }
      })();
    }
  };
  return {
    push(...items: T[]) {
      queue.push(...items);
      start();
    },
    get busy() {
      return active > 0 || queue.length > 0;
    },
  };
}
