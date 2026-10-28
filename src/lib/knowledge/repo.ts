import 'server-only';

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { embeddingToSql } from './embed';
import type { KnowledgeChunk } from './split';

// Everything indexing and search need from the database, behind one small interface so the pipeline
// and the job runner can be tested with an in-memory fake. Vectors and full-text go through raw SQL
// (Prisma cannot write pgvector or tsvector columns).

export type KnowledgeDocumentRow = {
  id: string;
  source_id: string;
  org_id: string;
  kind: string;
  origin: string;
  name: string;
  path: string | null;
  storage_ref: string | null;
  question: string | null;
  answer: string | null;
  version: number;
  status: string;
  superseded_by: string | null;
};

export type ChunkToStore = KnowledgeChunk & { embedding: number[] };

export type IndexOutcome = {
  status: 'indexed' | 'failed';
  chunkCount: number;
  pageCount: number | null;
  ocrPages: number;
  failedPages: number[];
  error: string | null;
};

export type SearchHit = {
  chunkId: string;
  documentId: string | null;
  sourceId: string;
  content: string;
  sectionPath: string | null;
  page: number | null;
  chunkType: string;
  documentName: string | null;
  version: number | null;
  vectorRank: number | null;
  keywordRank: number | null;
  score: number;
};

export interface KnowledgeRepo {
  getDocument(id: string): Promise<KnowledgeDocumentRow | null>;
  setDocumentStatus(id: string, status: 'indexing'): Promise<void>;
  /** Embeddings already stored in this knowledge base for these content hashes (reused, not recomputed). */
  embeddingsByHash(sourceId: string, hashes: string[]): Promise<Map<string, number[]>>;
  /** Replaces the document's chunks and records the outcome, in one transaction; marks older versions superseded. */
  saveIndexed(doc: KnowledgeDocumentRow, chunks: ChunkToStore[], outcome: IndexOutcome): Promise<void>;
  saveFailed(doc: KnowledgeDocumentRow, error: string): Promise<void>;
  hybridSearch(input: { sourceIds: string[]; question: string; embedding: number[]; limit: number; candidates: number }): Promise<SearchHit[]>;
  logQuery(input: { orgId: string; userId: string | null; surface: string; sourceIds: string[]; question: string; hits: SearchHit[] }): Promise<void>;
}

const vec = (e: number[]) => Prisma.sql`${embeddingToSql(e)}::vector(1024)`;

export const prismaKnowledgeRepo: KnowledgeRepo = {
  async getDocument(id) {
    return prisma.knowledge_documents.findUnique({
      where: { id },
      select: { id: true, source_id: true, org_id: true, kind: true, origin: true, name: true, path: true, storage_ref: true, question: true, answer: true, version: true, status: true, superseded_by: true },
    });
  },

  async setDocumentStatus(id, status) {
    await prisma.knowledge_documents.update({ where: { id }, data: { status, error: null } });
  },

  async embeddingsByHash(sourceId, hashes) {
    if (!hashes.length) return new Map();
    const rows = await prisma.$queryRaw<{ content_hash: string; embedding: string }[]>`
      SELECT DISTINCT ON (content_hash) content_hash, embedding::text AS embedding
      FROM knowledge_chunks
      WHERE source_id = ${sourceId}::uuid AND content_hash = ANY(${hashes}) AND embedding IS NOT NULL`;
    return new Map(rows.map((r) => [r.content_hash, JSON.parse(r.embedding) as number[]]));
  },

  async saveIndexed(doc, chunks, outcome) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`DELETE FROM knowledge_chunks WHERE document_id = ${doc.id}::uuid`;
      // Insert in slices so a long manual does not build one enormous statement.
      for (let i = 0; i < chunks.length; i += 200) {
        const rows = chunks.slice(i, i + 200).map(
          (c) => Prisma.sql`(${doc.source_id}::uuid, ${doc.org_id}, ${doc.id}::uuid, ${c.content}, ${vec(c.embedding)}, ${c.index},
            ${`doc:${doc.id}:${c.index}`}, ${JSON.stringify({ chunkType: c.chunkType })}::jsonb, ${c.sectionPath}, ${c.page}, ${c.chunkType}, ${c.contentHash})`,
        );
        await tx.$executeRaw`
          INSERT INTO knowledge_chunks (source_id, org_id, document_id, content, embedding, chunk_index, doc_ref, metadata, section_path, page, chunk_type, content_hash)
          VALUES ${Prisma.join(rows)}`;
      }
      await tx.knowledge_documents.update({
        where: { id: doc.id },
        data: {
          status: 'indexed',
          chunk_count: outcome.chunkCount,
          page_count: outcome.pageCount,
          ocr_pages: outcome.ocrPages,
          failed_pages: outcome.failedPages,
          error: outcome.error,
          indexed_at: new Date(),
        },
      });
      // Older versions of the same path stop being searched; they are kept, not deleted.
      if (doc.path) {
        await tx.knowledge_documents.updateMany({
          where: { source_id: doc.source_id, path: doc.path, id: { not: doc.id }, status: { in: ['indexed', 'failed', 'pending'] }, version: { lt: doc.version } },
          data: { status: 'superseded', superseded_by: doc.id },
        });
      }
      const totals = await tx.knowledge_documents.aggregate({ where: { source_id: doc.source_id, status: 'indexed' }, _count: true, _sum: { chunk_count: true } });
      await tx.knowledge_sources.update({
        where: { id: doc.source_id },
        data: { doc_count: totals._count, chunk_count: totals._sum.chunk_count ?? 0, last_indexed_at: new Date(), status: 'INDEXED' },
      });
    });
  },

  async saveFailed(doc, error) {
    await prisma.knowledge_documents.update({ where: { id: doc.id }, data: { status: 'failed', error: error.slice(0, 2000) } });
  },

  async hybridSearch({ sourceIds, question, embedding, limit, candidates }) {
    // Two ranked lists — meaning (vector) and exact words (full text) — fused by reciprocal rank
    // (k = 60). Only current document versions are searched; chunks written before documents
    // existed (no document_id) are included.
    return prisma.$queryRaw<SearchHit[]>`
      WITH scope AS (
        SELECT c.id, c.embedding, c.content_tsv
        FROM knowledge_chunks c
        LEFT JOIN knowledge_documents d ON d.id = c.document_id
        WHERE c.source_id = ANY(${sourceIds}::uuid[]) AND (c.document_id IS NULL OR d.status = 'indexed')
      ),
      by_vector AS (
        SELECT id, row_number() OVER (ORDER BY embedding <=> ${vec(embedding)}) AS r
        FROM scope WHERE embedding IS NOT NULL
        ORDER BY embedding <=> ${vec(embedding)} LIMIT ${candidates}
      ),
      by_words AS (
        SELECT id, row_number() OVER (ORDER BY ts_rank_cd(content_tsv, q) DESC) AS r
        FROM scope, websearch_to_tsquery('english', ${question}) q
        WHERE content_tsv @@ q
        ORDER BY ts_rank_cd(content_tsv, q) DESC LIMIT ${candidates}
      ),
      fused AS (
        SELECT coalesce(v.id, w.id) AS id, v.r AS vector_rank, w.r AS keyword_rank,
          coalesce(1.0 / (60 + v.r), 0) + coalesce(1.0 / (60 + w.r), 0) AS score
        FROM by_vector v FULL OUTER JOIN by_words w ON w.id = v.id
      )
      SELECT c.id AS "chunkId", c.document_id AS "documentId", c.source_id AS "sourceId", c.content,
        c.section_path AS "sectionPath", c.page, c.chunk_type AS "chunkType",
        d.name AS "documentName", d.version, f.vector_rank::int AS "vectorRank", f.keyword_rank::int AS "keywordRank", f.score::float AS score
      FROM fused f JOIN knowledge_chunks c ON c.id = f.id LEFT JOIN knowledge_documents d ON d.id = c.document_id
      ORDER BY f.score DESC LIMIT ${limit}`;
  },

  async logQuery({ orgId, userId, surface, sourceIds, question, hits }) {
    await prisma.knowledge_queries.create({
      data: {
        org_id: orgId,
        user_id: userId,
        surface,
        source_ids: sourceIds,
        question: question.slice(0, 4000),
        results: hits.map((h) => ({ chunkId: h.chunkId, documentId: h.documentId, score: h.score })),
        result_count: hits.length,
        top_score: hits[0]?.score ?? null,
      },
    });
  },
};
