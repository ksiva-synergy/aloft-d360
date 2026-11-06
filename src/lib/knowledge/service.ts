import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db';
import { writeAudit } from '@/lib/audit';
import { ApiError } from '@/lib/http';
import { canCreate, canManage, canSearch, canSee, isAdmin, type KnowledgeActor, type KnowledgeBaseAccessRow } from './access';
import { detectKind } from './readers';
import { kickKnowledgeJobs } from './runner';
import { enqueueIndexJob } from './job-queue';
import { deleteDocumentFolder, deleteKnowledgeBaseFolder, knowledgeBucket, putKnowledgeFile, readStoredBytes, StorageNotConfiguredError } from './store';
import { prismaKnowledgeRepo } from './repo';
import { embedQuestion } from './embed';
import { searchKnowledge, type Citation, type SearchInput } from './search';

// Knowledge bases people manage in the app: create, upload, write Q&A, see indexing, search.
// Access is decided per knowledge base (access.ts). Uploads are checked (type from the bytes, size)
// before anything is stored; the original goes to the knowledge bucket in a fixed folder layout and
// an index job is queued and started in the background. Re-uploading the same file is a no-op; a
// changed file becomes a new version that replaces the old one once indexed.

const intEnv = (name: string, fallback: number, min: number, max: number) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};
export const maxUploadBytes = () => intEnv('KNOWLEDGE_MAX_UPLOAD_MB', 50, 1, 200) * 1048576;
const maxDocuments = () => intEnv('KNOWLEDGE_MAX_DOCUMENTS', 2000, 1, 100_000);
const maxPersonalPerUser = () => intEnv('KNOWLEDGE_MAX_PERSONAL', 20, 1, 1000);

type KbRow = KnowledgeBaseAccessRow & {
  id: string;
  name: string;
  description: string | null;
  doc_count: number | null;
  chunk_count: number | null;
  last_indexed_at: Date | null;
  created_at: Date | null;
};

export type KnowledgeBaseSummary = {
  id: string;
  name: string;
  description: string | null;
  scope: 'personal' | 'org' | 'team';
  ownerId: string | null;
  ownerName: string | null;
  mine: boolean;
  canManage: boolean;
  archived: boolean;
  documents: number;
  pieces: number;
  lastIndexedAt: Date | null;
  createdAt: Date | null;
};

export type KnowledgeDocumentSummary = {
  id: string;
  kind: 'file' | 'qa';
  name: string;
  /** Folder inside the knowledge base when a folder was uploaded (`Chapter 3/Annexes`), else null. */
  folder: string | null;
  version: number;
  status: string;
  error: string | null;
  pages: number | null;
  pieces: number;
  ocrPages: number;
  failedPages: number[];
  sizeBytes: number | null;
  question: string | null;
  answer: string | null;
  uploadedBy: string;
  uploadedByName: string | null;
  createdAt: Date;
  indexedAt: Date | null;
  /** A newer version is being indexed; this one stays searchable until it is done. */
  replacing: boolean;
};

const KB_SELECT = { id: true, org_id: true, name: true, description: true, scope: true, owner_id: true, archived_at: true, type: true, doc_count: true, chunk_count: true, last_indexed_at: true, created_at: true } as const;

async function userNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x && !x.startsWith('script:')))];
  if (!unique.length) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, email: true } });
  return new Map(users.map((u) => [u.id, u.name || u.email]));
}

function summarize(a: KnowledgeActor, kb: KbRow, names: Map<string, string>): KnowledgeBaseSummary {
  return {
    id: kb.id,
    name: kb.name,
    description: kb.description,
    scope: kb.scope as KnowledgeBaseSummary['scope'],
    ownerId: kb.owner_id,
    ownerName: kb.owner_id ? (names.get(kb.owner_id) ?? null) : null,
    mine: kb.owner_id === a.userId,
    canManage: canManage(a, kb),
    archived: !!kb.archived_at,
    documents: kb.doc_count ?? 0,
    pieces: kb.chunk_count ?? 0,
    lastIndexedAt: kb.last_indexed_at,
    createdAt: kb.created_at,
  };
}

/**
 * One knowledge base this person may see (or manage), else 404 / 403. Same answer for "missing",
 * "other organisation" and "not yours": no existence leak.
 */
export async function loadKnowledgeBase(a: KnowledgeActor, id: string, need: 'see' | 'manage'): Promise<KbRow> {
  const kb = (await prisma.knowledge_sources.findUnique({ where: { id }, select: KB_SELECT }).catch(() => null)) as KbRow | null;
  if (!kb || !canSee(a, kb)) throw new ApiError(404, 'Knowledge base not found');
  if (need === 'manage' && !canManage(a, kb)) throw new ApiError(403, kb.scope === 'org' ? 'Only admins can change an organisation knowledge base' : 'Only the owner can change this knowledge base');
  return kb;
}

// ── Knowledge bases ──────────────────────────────────────────────────────────────────────────

export async function listKnowledgeBases(a: KnowledgeActor): Promise<KnowledgeBaseSummary[]> {
  const rows = (await prisma.knowledge_sources.findMany({
    where: { org_id: a.orgId, type: 'FILE' },
    select: KB_SELECT,
    orderBy: { name: 'asc' },
    take: 1000,
  })) as KbRow[];
  const visible = rows.filter((kb) => canSee(a, kb));
  const names = await userNames(visible.map((kb) => kb.owner_id));
  return visible.map((kb) => summarize(a, kb, names));
}

export async function getKnowledgeBase(a: KnowledgeActor, id: string): Promise<KnowledgeBaseSummary> {
  const kb = await loadKnowledgeBase(a, id, 'see');
  return summarize(a, kb, await userNames([kb.owner_id]));
}

const cleanName = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

export async function createKnowledgeBase(a: KnowledgeActor, input: { name: unknown; description?: unknown; scope?: unknown }): Promise<KnowledgeBaseSummary> {
  const name = cleanName(input.name);
  if (!name || name.length > 120) throw new ApiError(422, 'Give the knowledge base a name (up to 120 characters)');
  const scope = input.scope === 'org' ? 'org' : 'personal';
  if (!canCreate(a, scope)) throw new ApiError(403, 'Only admins can create an organisation knowledge base; create a personal one and ask an admin to share it');
  if (scope === 'personal') {
    const mine = await prisma.knowledge_sources.count({ where: { org_id: a.orgId, type: 'FILE', scope: 'personal', owner_id: a.userId, archived_at: null } });
    if (mine >= maxPersonalPerUser()) throw new ApiError(409, `You already have ${mine} personal knowledge bases; archive one you no longer use`);
  }
  const clash = await prisma.knowledge_sources.findFirst({ where: { org_id: a.orgId, type: 'FILE', name, scope, ...(scope === 'personal' ? { owner_id: a.userId } : {}), archived_at: null } });
  if (clash) throw new ApiError(409, `A knowledge base named "${name}" already exists`);
  const description = typeof input.description === 'string' ? input.description.trim().slice(0, 1000) || null : null;
  const kb = (await prisma.knowledge_sources.create({
    data: { org_id: a.orgId, name, description, type: 'FILE', scope, owner_id: a.userId, status: 'PENDING', ...(scope === 'org' ? { approved_by: a.userId, approved_at: new Date() } : {}) },
    select: KB_SELECT,
  })) as KbRow;
  await writeAudit({ actorId: a.userId, action: 'knowledge.created', entityType: 'knowledge_base', entityId: kb.id, after: { name, scope } });
  return summarize(a, kb, await userNames([a.userId]));
}

/** Rename, describe, archive or restore; admins can also move a knowledge base between personal and organisation. */
export async function updateKnowledgeBase(a: KnowledgeActor, id: string, input: { name?: unknown; description?: unknown; archived?: unknown; scope?: unknown }): Promise<KnowledgeBaseSummary> {
  const kb = await loadKnowledgeBase(a, id, 'manage');
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = cleanName(input.name);
    if (!name || name.length > 120) throw new ApiError(422, 'Give the knowledge base a name (up to 120 characters)');
    data.name = name;
  }
  if (input.description !== undefined) data.description = typeof input.description === 'string' ? input.description.trim().slice(0, 1000) || null : null;
  if (input.archived !== undefined) data.archived_at = input.archived ? new Date() : null;
  if (input.scope !== undefined && input.scope !== kb.scope) {
    // Promotion to organisation level is an admin decision (2026-10-27).
    if (!isAdmin(a)) throw new ApiError(403, 'Only admins can share a knowledge base with the whole organisation');
    if (input.scope !== 'org' && input.scope !== 'personal') throw new ApiError(422, 'scope must be personal or org');
    data.scope = input.scope;
    if (input.scope === 'org') Object.assign(data, { approved_by: a.userId, approved_at: new Date() });
  }
  const updated = (await prisma.knowledge_sources.update({ where: { id }, data, select: KB_SELECT })) as KbRow;
  await writeAudit({ actorId: a.userId, action: 'knowledge.updated', entityType: 'knowledge_base', entityId: id, before: { name: kb.name, scope: kb.scope, archived: !!kb.archived_at }, after: data });
  return summarize(a, updated, await userNames([updated.owner_id]));
}

/**
 * Deletes a knowledge base with every document, piece and stored file. Only an archived one, so a
 * delete is always a second, deliberate step. Files go first: if the bucket refuses, nothing is lost.
 */
export async function deleteKnowledgeBase(a: KnowledgeActor, id: string): Promise<{ documents: number; files: number }> {
  const kb = await loadKnowledgeBase(a, id, 'manage');
  if (!kb.archived_at) throw new ApiError(409, 'Archive the knowledge base first; agents and automations stop using it then');
  const documents = await prisma.knowledge_documents.count({ where: { source_id: id } });
  const files = await deleteKnowledgeBaseFolder(a.orgId, id);
  await prisma.knowledge_sources.delete({ where: { id } }); // documents, pieces, jobs and agent links cascade
  await writeAudit({ actorId: a.userId, action: 'knowledge.deleted', entityType: 'knowledge_base', entityId: id, before: { name: kb.name, scope: kb.scope, documents, files } });
  return { documents, files };
}

// ── Documents ────────────────────────────────────────────────────────────────────────────────

const DOC_SELECT = {
  id: true, kind: true, name: true, path: true, version: true, status: true, error: true, page_count: true, chunk_count: true, ocr_pages: true,
  failed_pages: true, size_bytes: true, question: true, answer: true, created_by: true, created_at: true, indexed_at: true, content_hash: true, storage_ref: true, mime_type: true,
} as const;

export async function listDocuments(a: KnowledgeActor, kbId: string): Promise<KnowledgeDocumentSummary[]> {
  await loadKnowledgeBase(a, kbId, 'see');
  kickKnowledgeJobs(); // resume anything left queued (e.g. after a restart)
  const rows = await prisma.knowledge_documents.findMany({ where: { source_id: kbId, status: { not: 'superseded' } }, select: DOC_SELECT, orderBy: [{ path: 'asc' }, { version: 'desc' }], take: 5000 });
  const names = await userNames(rows.map((r) => r.created_by));
  // Several current rows for one path = a new version is on its way; show the newest, flag the rest.
  const newestByPath = new Map<string, number>();
  for (const r of rows) if (r.path) newestByPath.set(r.path, Math.max(newestByPath.get(r.path) ?? 0, r.version));
  return rows
    .filter((r) => !r.path || r.version === newestByPath.get(r.path))
    .map((r) => ({
      id: r.id,
      kind: r.kind as 'file' | 'qa',
      name: r.name,
      folder: r.kind === 'file' && r.path?.includes('/') ? r.path.slice(0, r.path.lastIndexOf('/')) : null,
      version: r.version,
      status: r.status,
      error: r.error,
      pages: r.page_count,
      pieces: r.chunk_count,
      ocrPages: r.ocr_pages,
      failedPages: r.failed_pages,
      sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
      question: r.question,
      answer: r.answer,
      uploadedBy: r.created_by,
      uploadedByName: names.get(r.created_by) ?? null,
      createdAt: r.created_at,
      indexedAt: r.indexed_at,
      replacing: rows.some((o) => o.path === r.path && o.version < r.version && o.status === 'indexed'),
    }))
    .sort((x, y) => (x.folder ?? '').localeCompare(y.folder ?? '') || x.name.localeCompare(y.name));
}

/**
 * The folder a file came from when a whole folder is uploaded, made safe: no empty, `.` or `..`
 * parts, at most 10 levels of 100 characters. Two files with the same name in different folders are
 * then different documents, not versions of one.
 */
export function cleanFolder(folder: unknown): string {
  if (typeof folder !== 'string') return '';
  const parts = folder.split(/[\\/]/).map((p) => p.trim()).filter((p) => p && p !== '.' && p !== '..');
  if (parts.length > 10 || parts.some((p) => p.length > 100)) throw new ApiError(422, 'The folder path is too deep or too long');
  return parts.join('/');
}

async function checkRoom(kbId: string) {
  const current = await prisma.knowledge_documents.count({ where: { source_id: kbId, status: { not: 'superseded' } } });
  if (current >= maxDocuments()) throw new ApiError(409, `This knowledge base already holds ${current} documents, the limit; create another knowledge base`);
}

export type UploadResult = { outcome: 'queued' | 'unchanged'; document: { id: string; name: string; version: number; status: string } };

export async function uploadDocument(a: KnowledgeActor, kbId: string, file: { name: string; bytes: Uint8Array; contentType?: string; folder?: unknown }): Promise<UploadResult> {
  const kb = await loadKnowledgeBase(a, kbId, 'manage');
  if (kb.archived_at) throw new ApiError(409, 'This knowledge base is archived; restore it to add documents');
  const name = file.name.split(/[\\/]/).pop()!.trim().slice(0, 255);
  if (!name) throw new ApiError(422, 'The file has no name');
  const folder = cleanFolder(file.folder);
  const path = folder ? `${folder}/${name}` : name;
  if (!file.bytes.byteLength) throw new ApiError(422, `${name} is empty`);
  if (file.bytes.byteLength > maxUploadBytes()) {
    throw new ApiError(413, `${name} is ${(file.bytes.byteLength / 1048576).toFixed(1)} MB; the limit is ${maxUploadBytes() / 1048576} MB`);
  }
  // Checked from the content before anything is stored, so a renamed .exe never reaches the bucket.
  if (!(await detectKind(file.bytes, name))) {
    throw new ApiError(415, `${name}: only PDF, Word, Excel, CSV, PowerPoint, PNG, JPEG, text and Markdown files can be added`);
  }
  if (!knowledgeBucket()) throw new ApiError(503, new StorageNotConfiguredError().message, { code: 'storage_not_configured' });

  const sha256 = createHash('sha256').update(file.bytes).digest('hex');
  const latest = await prisma.knowledge_documents.findFirst({ where: { source_id: kbId, path, status: { not: 'superseded' } }, orderBy: { version: 'desc' }, select: { id: true, version: true, status: true, content_hash: true } });
  if (latest?.content_hash === sha256 && latest.status !== 'failed') {
    return { outcome: 'unchanged', document: { id: latest.id, name, version: latest.version, status: latest.status } };
  }
  if (!latest) await checkRoom(kbId);

  const version = (await prisma.knowledge_documents.aggregate({ where: { source_id: kbId, path }, _max: { version: true } }))._max.version ?? 0;
  const id = randomUUID();
  const storageRef = await putKnowledgeFile({ orgId: a.orgId, knowledgeBaseId: kbId, documentId: id, version: version + 1, name, bytes: file.bytes, contentType: file.contentType, sha256, uploadedBy: a.userId });
  try {
    await prisma.knowledge_documents.create({
      data: {
        id, source_id: kbId, org_id: a.orgId, kind: 'file', origin: 'upload', name, path, mime_type: file.contentType || null,
        size_bytes: file.bytes.byteLength, storage_ref: storageRef, content_hash: sha256, version: version + 1, created_by: a.userId,
      },
    });
  } catch (e) {
    await deleteDocumentFolder(a.orgId, kbId, id).catch(() => 0);
    if ((e as { code?: string }).code === 'P2002') throw new ApiError(409, `${path} is being uploaded already; try again in a moment`);
    throw e;
  }
  await enqueueIndexJob({ orgId: a.orgId, sourceId: kbId, documentId: id });
  kickKnowledgeJobs();
  await writeAudit({ actorId: a.userId, action: 'knowledge.document_uploaded', entityType: 'knowledge_base', entityId: kbId, after: { document: id, path, version: version + 1, bytes: file.bytes.byteLength, sha256 } });
  return { outcome: 'queued', document: { id, name, version: version + 1, status: 'pending' } };
}

function cleanQa(input: { question: unknown; answer: unknown }) {
  const question = typeof input.question === 'string' ? input.question.trim() : '';
  const answer = typeof input.answer === 'string' ? input.answer.trim() : '';
  if (!question || question.length > 1000) throw new ApiError(422, 'Write the question (up to 1,000 characters)');
  if (!answer || answer.length > 10_000) throw new ApiError(422, 'Write the answer (up to 10,000 characters)');
  return { question, answer };
}

/** Q&A written in the app. Editing creates a new version, which replaces the old one once indexed. */
export async function saveQa(a: KnowledgeActor, kbId: string, input: { question: unknown; answer: unknown }, existingId?: string): Promise<UploadResult> {
  const kb = await loadKnowledgeBase(a, kbId, 'manage');
  if (kb.archived_at) throw new ApiError(409, 'This knowledge base is archived; restore it to add Q&A');
  const { question, answer } = cleanQa(input);
  let path = `qa:${randomUUID()}`;
  let version = 1;
  if (existingId) {
    const prev = await prisma.knowledge_documents.findFirst({ where: { id: existingId, source_id: kbId, kind: 'qa' } });
    if (!prev) throw new ApiError(404, 'Q&A entry not found');
    path = prev.path!;
    version = ((await prisma.knowledge_documents.aggregate({ where: { source_id: kbId, path }, _max: { version: true } }))._max.version ?? prev.version) + 1;
  } else {
    await checkRoom(kbId);
  }
  const doc = await prisma.knowledge_documents.create({
    data: {
      source_id: kbId, org_id: a.orgId, kind: 'qa', origin: 'qa', name: question.slice(0, 200), path, question, answer,
      content_hash: createHash('sha256').update(`${question}\n${answer}`).digest('hex'), version, created_by: a.userId,
    },
  });
  await enqueueIndexJob({ orgId: a.orgId, sourceId: kbId, documentId: doc.id });
  kickKnowledgeJobs();
  await writeAudit({ actorId: a.userId, action: existingId ? 'knowledge.qa_updated' : 'knowledge.qa_added', entityType: 'knowledge_base', entityId: kbId, after: { document: doc.id, version } });
  return { outcome: 'queued', document: { id: doc.id, name: doc.name, version, status: 'pending' } };
}

/** Removes a document with all its versions, their pieces and their files. */
export async function deleteDocument(a: KnowledgeActor, kbId: string, docId: string): Promise<{ versions: number; files: number }> {
  await loadKnowledgeBase(a, kbId, 'manage');
  const doc = await prisma.knowledge_documents.findFirst({ where: { id: docId, source_id: kbId }, select: { id: true, path: true, name: true } });
  if (!doc) throw new ApiError(404, 'Document not found');
  const versions = doc.path ? await prisma.knowledge_documents.findMany({ where: { source_id: kbId, path: doc.path }, select: { id: true } }) : [{ id: doc.id }];
  let files = 0;
  for (const v of versions) files += await deleteDocumentFolder(a.orgId, kbId, v.id).catch(() => 0);
  await prisma.$transaction(async (tx) => {
    await tx.knowledge_documents.deleteMany({ where: { id: { in: versions.map((v) => v.id) } } }); // pieces and jobs cascade
    const totals = await tx.knowledge_documents.aggregate({ where: { source_id: kbId, status: 'indexed' }, _count: true, _sum: { chunk_count: true } });
    await tx.knowledge_sources.update({ where: { id: kbId }, data: { doc_count: totals._count, chunk_count: totals._sum.chunk_count ?? 0 } });
  });
  await writeAudit({ actorId: a.userId, action: 'knowledge.document_deleted', entityType: 'knowledge_base', entityId: kbId, before: { document: doc.id, name: doc.name, versions: versions.length, files } });
  return { versions: versions.length, files };
}

/** Queues a failed document again (temporary failures also retry on their own). */
export async function retryDocument(a: KnowledgeActor, kbId: string, docId: string): Promise<void> {
  await loadKnowledgeBase(a, kbId, 'manage');
  const doc = await prisma.knowledge_documents.findFirst({ where: { id: docId, source_id: kbId } });
  if (!doc) throw new ApiError(404, 'Document not found');
  if (doc.status !== 'failed' && !(doc.failed_pages.length > 0)) throw new ApiError(409, 'Only a document that failed, or has pages that failed, can be retried');
  await prisma.knowledge_documents.update({ where: { id: docId }, data: { status: 'pending', error: null } });
  await enqueueIndexJob({ orgId: a.orgId, sourceId: kbId, documentId: docId });
  kickKnowledgeJobs();
}

export async function downloadDocument(a: KnowledgeActor, kbId: string, docId: string): Promise<{ name: string; contentType: string; bytes: Uint8Array }> {
  await loadKnowledgeBase(a, kbId, 'see');
  const doc = await prisma.knowledge_documents.findFirst({ where: { id: docId, source_id: kbId, kind: 'file' }, select: { name: true, mime_type: true, storage_ref: true } });
  if (!doc?.storage_ref) throw new ApiError(404, 'Document not found');
  return { name: doc.name, contentType: doc.mime_type || 'application/octet-stream', bytes: await readStoredBytes(doc.storage_ref) };
}

// ── Search ───────────────────────────────────────────────────────────────────────────────────

/** Knowledge bases this person may search, optionally narrowed to the ones asked for. */
export async function searchableIds(a: KnowledgeActor, wanted?: string[]): Promise<string[]> {
  const rows = (await prisma.knowledge_sources.findMany({ where: { org_id: a.orgId, type: 'FILE', ...(wanted?.length ? { id: { in: wanted } } : {}) }, select: KB_SELECT })) as KbRow[];
  return rows.filter((kb) => canSearch(a, kb)).map((kb) => kb.id);
}

export async function searchForUser(a: KnowledgeActor, input: { question: string; knowledgeBaseIds?: string[]; limit?: number; surface: SearchInput['surface'] }): Promise<Citation[]> {
  const ids = await searchableIds(a, input.knowledgeBaseIds);
  if (input.knowledgeBaseIds?.length && !ids.length) throw new ApiError(404, 'Knowledge base not found');
  if (!ids.length) return []; // nothing to search: skip embedding the question
  return searchKnowledge({ orgId: a.orgId, userId: a.userId, surface: input.surface, sourceIds: ids, question: input.question, limit: input.limit }, { repo: prismaKnowledgeRepo, embedQuestion });
}
