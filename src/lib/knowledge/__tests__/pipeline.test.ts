/**
 * Indexing, jobs and search with an in-memory repository: a file and a Q&A entry are indexed with
 * citations' details kept; unchanged pieces reuse their stored embedding; a file that cannot be read
 * is failed, a Titan outage is retried; jobs retry with back-off and stop at max attempts; search
 * returns citations and survives a logging failure.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { indexDocument, type IndexDeps } from '../index-document';
import { runJobs, retryDelayMs, type JobQueue, type KnowledgeJob } from '../jobs';
import { searchKnowledge } from '../search';
import { EmbeddingUnavailableError } from '../embed';
import type { ChunkToStore, KnowledgeDocumentRow, KnowledgeRepo, SearchHit } from '../repo';

function fakeRepo(docs: KnowledgeDocumentRow[]) {
  const stored = new Map<string, ChunkToStore[]>();
  const saved: { id: string; status: string; outcome?: unknown; error?: string }[] = [];
  const statuses: string[] = [];
  const repo: KnowledgeRepo = {
    getDocument: async (id) => docs.find((d) => d.id === id) ?? null,
    setDocumentStatus: async (_id, s) => void statuses.push(s),
    embeddingsByHash: async (_src, hashes) => {
      const all = [...stored.values()].flat();
      return new Map(all.filter((c) => hashes.includes(c.contentHash)).map((c) => [c.contentHash, c.embedding]));
    },
    saveIndexed: async (doc, chunks, outcome) => {
      stored.set(doc.id, chunks);
      saved.push({ id: doc.id, status: 'indexed', outcome });
    },
    saveFailed: async (doc, error) => void saved.push({ id: doc.id, status: 'failed', error }),
    hybridSearch: async () => [],
    logQuery: async () => {},
  };
  return { repo, stored, saved, statuses };
}

const doc = (over: Partial<KnowledgeDocumentRow>): KnowledgeDocumentRow => ({
  id: 'd1', source_id: 's1', org_id: 'o', kind: 'file', origin: 'upload', name: 'sms.md', path: 'sms.md', storage_ref: 's3://kb/sms.md',
  question: null, answer: null, version: 1, status: 'pending', superseded_by: null, ...over,
});
const MD = '# 4 Emergency\n\n## 4.2 Fire\n\nRaise the alarm.\n\n## 4.3 Flooding\n\nClose watertight doors.';

function deps(repo: KnowledgeRepo, files: Record<string, string>, embed?: IndexDeps['embed']): IndexDeps {
  return {
    repo,
    readBytes: async (ref) => new TextEncoder().encode(files[ref] ?? ''),
    embed: embed ?? (async (texts) => texts.map((_, i) => [i, 1])),
    ocr: null,
  };
}

describe('indexDocument', () => {
  it('indexes a file by section, then reuses embeddings for unchanged sections in a new version', async () => {
    const v1 = doc({});
    const v2 = doc({ id: 'd2', version: 2, storage_ref: 's3://kb/sms-v2.md' });
    const { repo, stored, saved, statuses } = fakeRepo([v1, v2]);
    const embed = vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2]));
    const files = { 's3://kb/sms.md': MD, 's3://kb/sms-v2.md': MD.replace('Close watertight doors.', 'Close watertight doors and report to the bridge.') };

    const r1 = await indexDocument('d1', deps(repo, files, embed));
    expect(r1).toMatchObject({ status: 'indexed', chunks: 2, embedded: 2, reused: 0 });
    expect(stored.get('d1')!.map((c) => [c.sectionPath, c.content])).toEqual([
      ['4 Emergency › 4.2 Fire', 'Raise the alarm.'],
      ['4 Emergency › 4.3 Flooding', 'Close watertight doors.'],
    ]);
    expect(statuses).toEqual(['indexing']);

    const r2 = await indexDocument('d2', deps(repo, files, embed));
    expect(r2).toMatchObject({ chunks: 2, embedded: 1, reused: 1 });
    expect(embed.mock.calls[1]![0]).toEqual(['sms.md › 4 Emergency › 4.3 Flooding\nClose watertight doors and report to the bridge.']);
    expect(saved.at(-1)).toMatchObject({ id: 'd2', status: 'indexed', outcome: { chunkCount: 2, failedPages: [], error: null } });
  });

  it('indexes a Q&A entry as one piece', async () => {
    const { repo, stored } = fakeRepo([doc({ id: 'q1', kind: 'qa', origin: 'qa', name: 'Q&A', path: null, storage_ref: null, question: 'Who signs the oil record book?', answer: 'The chief engineer, and the master countersigns each page.' })]);
    await indexDocument('q1', deps(repo, {}));
    expect(stored.get('q1')!.map((c) => [c.chunkType, c.content])).toEqual([['qa', 'Q: Who signs the oil record book?\nA: The chief engineer, and the master countersigns each page.']]);
  });

  it('fails a file it cannot read, and throws a retryable error when Titan is down', async () => {
    const { repo, saved } = fakeRepo([doc({ id: 'bad', name: 'tool.exe', storage_ref: 's3://kb/tool.exe' }), doc({ id: 'ok' })]);
    const bad = await indexDocument('bad', deps(repo, { 's3://kb/tool.exe': 'MZ' }));
    expect(bad.status).toBe('failed');
    expect(saved[0]).toMatchObject({ id: 'bad', status: 'failed', error: expect.stringMatching(/only PDF, Word, Excel/) });
    const down = indexDocument('ok', deps(repo, { 's3://kb/sms.md': MD }, async () => Promise.reject(new EmbeddingUnavailableError('Titan down'))));
    await expect(down).rejects.toMatchObject({ retryable: true });
  });

  it('skips a version that has been superseded', async () => {
    const { repo, stored } = fakeRepo([doc({ status: 'superseded' })]);
    expect((await indexDocument('d1', deps(repo, { 's3://kb/sms.md': MD }))).warnings).toEqual(['A newer version exists; skipped']);
    expect(stored.size).toBe(0);
  });
});

describe('runJobs', () => {
  function fakeQueue(jobs: KnowledgeJob[]) {
    const log: string[] = [];
    let ready = [...jobs];
    const queue: JobQueue = {
      claim: async (_w, limit) => ready.splice(0, limit),
      complete: async (id) => void log.push(`done ${id}`),
      fail: async (job, error, retryable) => {
        const again = retryable && job.attempts + 1 < job.max_attempts;
        log.push(`${again ? 'retry' : 'failed'} ${job.id}: ${error}`);
        if (again) ready.push({ ...job, attempts: job.attempts + 1 });
        return again ? 'retrying' : 'failed';
      },
    };
    return { queue, log, clear: () => (ready = []) };
  }
  const job = (id: string, over: Partial<KnowledgeJob> = {}): KnowledgeJob => ({ id, org_id: 'o', kind: 'index_document', source_id: 's', document_id: id, attempts: 0, max_attempts: 3, payload: {}, ...over });

  it('completes, retries retryable errors up to max attempts, and fails others at once', async () => {
    const { queue, log } = fakeQueue([job('a'), job('b'), job('c', { kind: 'unknown' })]);
    const totals = await runJobs(
      queue,
      {
        index_document: async (j) => {
          if (j.id === 'b') throw Object.assign(new Error('Titan down'), { retryable: true });
        },
      },
      { workerId: 'w' },
    );
    expect(log).toEqual(['done a', 'retry b: Titan down', 'failed c: No handler for job kind "unknown"', 'retry b: Titan down', 'failed b: Titan down']);
    expect(totals).toEqual({ done: 1, retrying: 2, failed: 2 });
  });

  it('backs off 1, 2, 4 … minutes, up to an hour', () => {
    expect([1, 2, 3, 4, 10].map((a) => retryDelayMs(a) / 60_000)).toEqual([1, 2, 4, 8, 60]);
  });
});

describe('searchKnowledge', () => {
  const hit = (over: Partial<SearchHit>): SearchHit => ({
    chunkId: 'c1', documentId: 'd1', sourceId: 's1', content: 'Raise the alarm.', sectionPath: '4 Emergency › 4.2 Fire', page: 12, chunkType: 'text',
    documentName: 'SMS', version: 7, vectorRank: 1, keywordRank: 3, score: 0.0322580645, ...over,
  });

  it('returns citations, says how each was found, and survives a logging failure', async () => {
    const hybridSearch = vi.fn(async () => [hit({}), hit({ chunkId: 'c2', vectorRank: null, keywordRank: 1, score: 0.0163934 })]);
    const repo = { hybridSearch, logQuery: vi.fn(async () => Promise.reject(new Error('db busy'))) } as unknown as KnowledgeRepo;
    const out = await searchKnowledge({ orgId: 'o', userId: 'u', surface: 'test_search', sourceIds: ['s1', 's1'], question: '  What do we do in a fire?  ', limit: 50 }, { repo, embedQuestion: async () => [0.5] });
    expect(hybridSearch).toHaveBeenCalledWith({ sourceIds: ['s1'], question: 'What do we do in a fire?', embedding: [0.5], limit: 25, candidates: 125 });
    expect(out[0]).toEqual({ text: 'Raise the alarm.', knowledgeBaseId: 's1', documentId: 'd1', document: 'SMS', version: 7, section: '4 Emergency › 4.2 Fire', page: 12, kind: 'text', score: 0.03226, matchedBy: 'both' });
    expect(out[1]!.matchedBy).toBe('words');
  });

  it('does nothing without a question or a knowledge base', async () => {
    const embedQuestion = vi.fn();
    expect(await searchKnowledge({ orgId: 'o', userId: null, surface: 'script', sourceIds: [], question: 'x' }, { repo: {} as KnowledgeRepo, embedQuestion })).toEqual([]);
    expect(await searchKnowledge({ orgId: 'o', userId: null, surface: 'script', sourceIds: ['s'], question: '  ' }, { repo: {} as KnowledgeRepo, embedQuestion })).toEqual([]);
    expect(embedQuestion).not.toHaveBeenCalled();
  });
});
