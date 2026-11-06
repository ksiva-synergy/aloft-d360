/**
 * Knowledge API with an in-memory database, a fake bucket and a fake job runner: who can see and
 * change what (personal vs organisation), every upload case (wrong type and too big refused before
 * storing, same file again, a new version, no bucket configured), Q&A versions, delete, retry,
 * download, and that search only ever covers knowledge bases the person may see.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/http';
import { makePdf } from '@/lib/extraction/__tests__/pdf-fixture';

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  sources: new Map<string, Record<string, unknown>>(),
  docs: new Map<string, Record<string, unknown>>(),
  resolveAuth: vi.fn(),
  put: vi.fn(),
  delFolder: vi.fn(),
  delKbFolder: vi.fn(),
  read: vi.fn(),
  enqueue: vi.fn(),
  kick: vi.fn(),
  search: vi.fn(),
  audit: vi.fn(),
  bucket: { value: true as boolean },
}));

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === 'NOT') return !matches(row, cond as Row);
    const v = row[k];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as { not?: unknown; in?: unknown[] };
      if ('in' in c) return c.in!.includes(v);
      if ('not' in c) return v !== c.not;
    }
    return v === cond;
  });
}
function table(m: Map<string, Row>, defaults: () => Row) {
  return {
  findUnique: async ({ where }: { where: { id: string } }) => m.get(where.id) ?? null,
  findFirst: async ({ where, orderBy }: { where?: Row; orderBy?: Row }) => {
    const rows = [...m.values()].filter((r) => matches(r, where));
    if (orderBy && 'version' in orderBy) rows.sort((a, b) => (b.version as number) - (a.version as number));
    return rows[0] ?? null;
  },
  findMany: async ({ where }: { where?: Row }) => [...m.values()].filter((r) => matches(r, where)),
  count: async ({ where }: { where?: Row }) => [...m.values()].filter((r) => matches(r, where)).length,
  aggregate: async ({ where }: { where?: Row }) => {
    const rows = [...m.values()].filter((r) => matches(r, where));
    return { _max: { version: rows.length ? Math.max(...rows.map((r) => r.version as number)) : null }, _count: rows.length, _sum: { chunk_count: rows.reduce((s, r) => s + ((r.chunk_count as number) ?? 0), 0) } };
  },
  create: async ({ data }: { data: Row }) => {
    const row = { ...defaults(), ...data };
    row.id ??= crypto.randomUUID();
    m.set(row.id as string, row);
    return row;
  },
  delete: async ({ where }: { where: { id: string } }) => {
    const row = m.get(where.id);
    m.delete(where.id);
    return row;
  },
  update: async ({ where, data }: { where: { id: string }; data: Row }) => {
    const row = { ...m.get(where.id)!, ...data };
    m.set(where.id, row);
    return row;
  },
  deleteMany: async ({ where }: { where: Row }) => {
    for (const [id, r] of m) if (matches(r, where)) m.delete(id);
    return {};
  },
  };
}

vi.mock('server-only', () => ({}));
vi.mock('@/middleware/auth', () => ({
  resolveAuth: h.resolveAuth,
  requirePermission: (ctx: { permissions: Set<string> }, key: string) => {
    if (!ctx.permissions.has(key)) throw new ApiError(403, 'Forbidden');
  },
}));
vi.mock('@/lib/db', () => {
  const prisma: Record<string, unknown> = {
    knowledge_sources: table(h.sources, () => ({ type: 'FILE', scope: 'personal', archived_at: null, doc_count: 0, chunk_count: 0, last_indexed_at: null, created_at: new Date(), description: null })),
    knowledge_documents: table(h.docs, () => ({ status: 'pending', error: null, page_count: null, chunk_count: 0, ocr_pages: 0, failed_pages: [], size_bytes: null, question: null, answer: null, created_at: new Date(), indexed_at: null, storage_ref: null, mime_type: null })),
    user: { findMany: async () => [{ id: 'u-ana', name: 'Ana', email: 'ana@x' }] },
  };
  prisma.$transaction = async (fn: (tx: unknown) => unknown) => fn(prisma);
  return { prisma };
});
vi.mock('@/lib/audit', () => ({ writeAudit: h.audit }));
vi.mock('@/lib/knowledge/runner', () => ({ kickKnowledgeJobs: h.kick }));
vi.mock('@/lib/knowledge/job-queue', () => ({ enqueueIndexJob: h.enqueue }));
vi.mock('@/lib/knowledge/search', () => ({ searchKnowledge: h.search }));
vi.mock('@/lib/knowledge/embed', () => ({ embedQuestion: vi.fn() }));
vi.mock('@/lib/knowledge/repo', () => ({ prismaKnowledgeRepo: {} }));
vi.mock('@/lib/knowledge/store', async (orig) => ({
  ...(await orig<object>()),
  knowledgeBucket: () => (h.bucket.value ? { bucket: 'aloft-knowledge-dev', region: 'ap-south-1', prefix: 'knowledge' } : null),
  putKnowledgeFile: h.put,
  deleteDocumentFolder: h.delFolder,
  deleteKnowledgeBaseFolder: h.delKbFolder,
  readStoredBytes: h.read,
}));

import { GET as listKbs, POST as createKb } from '../route';
import { DELETE as deleteKb, PATCH as patchKb } from '../[id]/route';
import { GET as listDocs, POST as upload } from '../[id]/documents/route';
import { DELETE as delDoc, GET as download, PATCH as patchDoc } from '../[id]/documents/[docId]/route';
import { POST as addQa } from '../[id]/qa/route';
import { POST as search } from '../search/route';
import { documentKey, safeFileName } from '@/lib/knowledge/store';

const user = (userId: string, role: string) => ({ userId, role, permissions: new Set(['inspector:use']) });
const ana = user('u-ana', 'member');
const ben = user('u-ben', 'member');
const admin = user('u-admin', 'admin');
const json = (method: string, path: string, body?: unknown) =>
  new Request(`http://test/api/knowledge${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const p = (id: string, docId?: string) => ({ params: Promise.resolve(docId ? { id, docId } : { id }) }) as never;
const fileReq = (id: string, name: string, bytes: Uint8Array, type = 'application/pdf') => {
  const form = new FormData();
  form.append('file', new File([Buffer.from(bytes)], name, { type }));
  return upload(new Request(`http://test/api/knowledge/${id}/documents`, { method: 'POST', body: form }), p(id));
};
const as = (u: object) => h.resolveAuth.mockResolvedValue(u);
const newKb = async (body: Row) => (await (await createKb(json('POST', '', body), undefined)).json()).knowledgeBase;

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('DEFAULT_ORG_ID', 'org-1');
  h.sources.clear();
  h.docs.clear();
  h.bucket.value = true;
  for (const f of [h.put, h.delFolder, h.delKbFolder, h.read, h.enqueue, h.kick, h.search, h.audit]) f.mockReset();
  h.put.mockImplementation(async (a: { knowledgeBaseId: string; documentId: string; version: number; name: string }) => `s3://aloft-knowledge-dev/knowledge/org-1/${a.knowledgeBaseId}/${a.documentId}/v${a.version}/${safeFileName(a.name)}`);
  h.delFolder.mockResolvedValue(2);
  h.search.mockResolvedValue([]);
  as(ana);
});

describe('who can see and change what', () => {
  it('keeps personal knowledge bases private, lets only admins create organisation ones, and lets everyone read those', async () => {
    const mine = await newKb({ name: 'My vessel notes' });
    expect(mine).toMatchObject({ scope: 'personal', mine: true, canManage: true, ownerName: 'Ana' });
    expect((await createKb(json('POST', '', { name: 'Company SMS', scope: 'org' }), undefined)).status).toBe(403);

    as(admin);
    const org = await newKb({ name: 'Company SMS', scope: 'org' });
    as(ben);
    const seen = (await (await listKbs(json('GET', ''), undefined)).json()).knowledgeBases;
    expect(seen.map((k: { name: string; canManage: boolean }) => [k.name, k.canManage])).toEqual([['Company SMS', false]]);
    expect((await listDocs(json('GET', `/${mine.id}/documents`), p(mine.id))).status).toBe(404);
    expect((await fileReq(org.id, 'sms.pdf', makePdf(['x']))).status).toBe(403);
    expect((await patchKb(json('PATCH', `/${mine.id}`, { scope: 'org' }), p(mine.id))).status).toBe(404);

    // Only admins promote a personal knowledge base to the organisation.
    as(ana);
    expect((await patchKb(json('PATCH', `/${mine.id}`, { scope: 'org' }), p(mine.id))).status).toBe(403);
  });
});

describe('uploads', () => {
  it('stores a PDF in the knowledge folder layout, queues indexing and starts the runner', async () => {
    const kb = await newKb({ name: 'Notes' });
    const pdf = makePdf(['Ballast water record']);
    const res = await fileReq(kb.id, 'Ballast Water Record (2026).pdf', pdf);
    expect(res.status).toBe(201);
    const { outcome, document } = await res.json();
    expect(outcome).toBe('queued');
    expect(h.put).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1', knowledgeBaseId: kb.id, documentId: document.id, version: 1, name: 'Ballast Water Record (2026).pdf', uploadedBy: 'u-ana', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }));
    expect(h.docs.get(document.id)).toMatchObject({ storage_ref: `s3://aloft-knowledge-dev/knowledge/org-1/${kb.id}/${document.id}/v1/Ballast-Water-Record-2026.pdf`, size_bytes: pdf.byteLength, created_by: 'u-ana' });
    expect(h.enqueue).toHaveBeenCalledWith({ orgId: 'org-1', sourceId: kb.id, documentId: document.id });
    expect(h.kick).toHaveBeenCalled();
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'knowledge.document_uploaded' }));
  });

  it('refuses a wrong file type, an empty or oversized file, before storing anything', async () => {
    const kb = await newKb({ name: 'Notes' });
    const exe = await fileReq(kb.id, 'report.pdf', new TextEncoder().encode('MZ not a pdf'), 'application/pdf');
    expect(exe.status).toBe(415);
    expect((await exe.json()).error).toMatch(/only PDF, Word, Excel/);
    expect((await fileReq(kb.id, 'empty.pdf', new Uint8Array())).status).toBe(422);
    vi.stubEnv('KNOWLEDGE_MAX_UPLOAD_MB', '1');
    expect((await fileReq(kb.id, 'big.pdf', new Uint8Array(1_100_000).fill(0x25))).status).toBe(413);
    expect(h.put).not.toHaveBeenCalled();
  });

  it('skips the same file again, and keeps a changed file as a new version', async () => {
    const kb = await newKb({ name: 'Notes' });
    const first = await (await fileReq(kb.id, 'sms.pdf', makePdf(['v1']))).json();
    const again = await fileReq(kb.id, 'sms.pdf', makePdf(['v1']));
    expect(again.status).toBe(200);
    expect((await again.json()).outcome).toBe('unchanged');
    const v2 = await (await fileReq(kb.id, 'sms.pdf', makePdf(['v2 changed']))).json();
    expect(v2.document.version).toBe(2);
    expect(h.put).toHaveBeenCalledTimes(2);

    // While v2 indexes, the list shows v2 and says it is replacing the indexed v1.
    h.docs.set(first.document.id, { ...h.docs.get(first.document.id)!, status: 'indexed' });
    const docs = (await (await listDocs(json('GET', `/${kb.id}/documents`), p(kb.id))).json()).documents;
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ version: 2, status: 'pending', replacing: true });
  });

  it('says plainly when the bucket is not configured', async () => {
    h.bucket.value = false;
    const kb = await newKb({ name: 'Notes' });
    const res = await fileReq(kb.id, 'a.pdf', makePdf(['x']));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/KNOWLEDGE_BUCKET/);
  });
});

describe('Q&A, delete, retry, download', () => {
  it('adds Q&A and edits it as a new version of the same entry', async () => {
    const kb = await newKb({ name: 'Notes' });
    const added = await (await addQa(json('POST', `/${kb.id}/qa`, { question: 'Who signs the ORB?', answer: 'The chief engineer.' }), p(kb.id))).json();
    const edited = await (await patchDoc(json('PATCH', '', { question: 'Who signs the ORB?', answer: 'The chief engineer; the master countersigns.' }), p(kb.id, added.document.id))).json();
    expect(edited.document.version).toBe(2);
    expect(h.docs.get(edited.document.id)!.path).toBe(h.docs.get(added.document.id)!.path);
    expect((await addQa(json('POST', `/${kb.id}/qa`, { question: '', answer: 'x' }), p(kb.id))).status).toBe(422);
  });

  it('deletes every version and its files, retries only failures, and downloads with the access check', async () => {
    const kb = await newKb({ name: 'Notes' });
    const v1 = await (await fileReq(kb.id, 'sms.pdf', makePdf(['v1']))).json();
    await fileReq(kb.id, 'sms.pdf', makePdf(['v2']));
    expect((await patchDoc(json('PATCH', '', { retry: true }), p(kb.id, v1.document.id))).status).toBe(409);
    h.docs.set(v1.document.id, { ...h.docs.get(v1.document.id)!, status: 'failed', error: 'OCR failed' });
    expect((await patchDoc(json('PATCH', '', { retry: true }), p(kb.id, v1.document.id))).status).toBe(200);

    h.read.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const file = await download(json('GET', ''), p(kb.id, v1.document.id));
    expect(file.headers.get('content-disposition')).toBe("attachment; filename*=UTF-8''sms.pdf");
    as(ben);
    expect((await download(json('GET', ''), p(kb.id, v1.document.id))).status).toBe(404);
    as(ana);

    const del = await (await delDoc(json('DELETE', ''), p(kb.id, v1.document.id))).json();
    expect(del.deleted).toEqual({ versions: 2, files: 4 });
    expect(h.docs.size).toBe(0);
  });
});

describe('search scope', () => {
  it('searches only knowledge bases the person may see, never archived ones', async () => {
    const mine = await newKb({ name: 'Mine' });
    as(admin);
    const org = await newKb({ name: 'SMS', scope: 'org' });
    const old = await newKb({ name: 'Old', scope: 'org' });
    await patchKb(json('PATCH', `/${old.id}`, { archived: true }), p(old.id));
    as(ben);
    await search(json('POST', '/search', { question: 'fire pump test' }), undefined);
    expect(h.search.mock.calls[0]![0]).toMatchObject({ sourceIds: [org.id], userId: 'u-ben', surface: 'test_search' });
    const notYours = await search(json('POST', '/search', { question: 'fire pump', knowledgeBaseIds: [mine.id] }), undefined);
    expect(notYours.status).toBe(404);
  });
});

describe('bucket layout', () => {
  it('names objects by org, knowledge base, document and version, with a readable file name', () => {
    const b = { bucket: 'b', region: 'ap-south-1', prefix: 'knowledge' };
    expect(documentKey(b, { orgId: 'org-1', knowledgeBaseId: 'kb-9', documentId: 'doc-3', version: 2, name: 'C:\\Users\\x\\SMS Manual – rev 7 (final).pdf' })).toBe('knowledge/org-1/kb-9/doc-3/v2/SMS-Manual-rev-7-final.pdf');
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('ünïcødé näme.docx')).toBe('unicode-name.docx');
    expect(safeFileName('Ålesund Bøgh Æro.xlsx')).toBe('Alesund-Bogh-AEro.xlsx');
  });
});

describe('archiving', () => {
  it('keeps an archived personal knowledge base visible to its owner so they can restore it, but never searches it', async () => {
    const mine = await newKb({ name: 'Old notes' });
    await patchKb(json('PATCH', `/${mine.id}`, { archived: true }), p(mine.id));
    const listed = (await (await listKbs(json('GET', ''), undefined)).json());
    expect(listed).toMatchObject({ isAdmin: false, uploads: { ready: true, maxMb: 50 }, knowledgeBases: [{ id: mine.id, archived: true, canManage: true }] });
    expect((await fileReq(mine.id, 'a.pdf', makePdf(['x']))).status).toBe(409);
    await search(json('POST', '/search', { question: 'anything here' }), undefined);
    expect(h.search).not.toHaveBeenCalled();

    const restored = await (await patchKb(json('PATCH', `/${mine.id}`, { archived: false }), p(mine.id))).json();
    expect(restored.knowledgeBase.archived).toBe(false);
  });
});

describe('folder uploads', () => {
  it('keeps same-named files in different folders as separate documents and strips unsafe folder parts', async () => {
    const kb = await newKb({ name: 'SMS manual' });
    const send = (folder: string, text: string) => {
      const form = new FormData();
      form.append('file', new File([Buffer.from(makePdf([text]))], 'Index.pdf', { type: 'application/pdf' }));
      form.append('folder', folder);
      return upload(new Request(`http://test/api/knowledge/${kb.id}/documents`, { method: 'POST', body: form }), p(kb.id));
    };
    const a = await (await send('SMS/Chapter 1', 'one')).json();
    const b = await (await send(String.raw`..\SMS\.\Chapter 2\ `, 'two')).json();
    expect([a.document.version, b.document.version]).toEqual([1, 1]);
    expect(h.docs.get(b.document.id)!.path).toBe('SMS/Chapter 2/Index.pdf');
    const docs = (await (await listDocs(json('GET', `/${kb.id}/documents`), p(kb.id))).json()).documents;
    expect(docs.map((d: { folder: string; name: string }) => `${d.folder}|${d.name}`)).toEqual(['SMS/Chapter 1|Index.pdf', 'SMS/Chapter 2|Index.pdf']);
  });
});

describe('deleting a knowledge base', () => {
  it('only deletes an archived one, removing its files before the database rows', async () => {
    const kb = await newKb({ name: 'Scratch' });
    await fileReq(kb.id, 'a.pdf', makePdf(['x']));
    expect((await deleteKb(json('DELETE', `/${kb.id}`), p(kb.id))).status).toBe(409);
    await patchKb(json('PATCH', `/${kb.id}`, { archived: true }), p(kb.id));
    h.delKbFolder.mockResolvedValue(1);
    const res = await (await deleteKb(json('DELETE', `/${kb.id}`), p(kb.id))).json();
    expect(res.deleted).toEqual({ documents: 1, files: 1 });
    expect(h.delKbFolder).toHaveBeenCalledWith('org-1', kb.id);
    expect(h.sources.has(kb.id)).toBe(false);
  });

  it('keeps everything when the bucket refuses the delete', async () => {
    const kb = await newKb({ name: 'Scratch' });
    await patchKb(json('PATCH', `/${kb.id}`, { archived: true }), p(kb.id));
    h.delKbFolder.mockRejectedValue(new Error('AccessDenied'));
    expect((await deleteKb(json('DELETE', `/${kb.id}`), p(kb.id))).status).toBe(500);
    expect(h.sources.has(kb.id)).toBe(true);
  });
});
