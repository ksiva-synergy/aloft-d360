-- Knowledge bases, Phase 0 (plan: claude.ai doc "ALOFT knowledge bases — plan"; memory knowledge-base-plan).
-- Additive only: new tables, new nullable / defaulted columns, new indexes. Nothing is dropped and no
-- existing row is rewritten except as noted:
--   * knowledge_chunks.embedding becomes vector(1024). On 2026-10-27 all 4 existing embeddings in dev
--     were 1024-dimensional (Titan v2), so the cast is lossless; it fails loudly if any row differs.
--   * knowledge_chunks gains a generated full-text column, which Postgres fills for existing rows.
--   * The 8 existing knowledge_sources become organisation-level (scope = 'org'), with no owner.
--
-- Apply manually (same convention as earlier migrations):
--   npx prisma db execute --file prisma/migrations/20261028_knowledge_phase0/migration.sql --schema ./prisma/schema.prisma
--   npx prisma migrate resolve --applied 20261028_knowledge_phase0
-- Rollback (loses knowledge documents, jobs and query logs; existing chunks and sources are kept):
--   DROP TABLE IF EXISTS knowledge_queries, knowledge_jobs CASCADE;
--   DROP INDEX IF EXISTS idx_kc_embedding_hnsw, idx_kc_content_tsv, idx_kc_document;
--   ALTER TABLE knowledge_chunks DROP COLUMN IF EXISTS content_tsv, DROP COLUMN IF EXISTS document_id,
--     DROP COLUMN IF EXISTS section_path, DROP COLUMN IF EXISTS page, DROP COLUMN IF EXISTS chunk_type,
--     DROP COLUMN IF EXISTS content_hash;
--   DROP TABLE IF EXISTS knowledge_documents CASCADE;
--   ALTER TABLE knowledge_sources DROP COLUMN IF EXISTS owner_id, DROP COLUMN IF EXISTS scope,
--     DROP COLUMN IF EXISTS team_id, DROP COLUMN IF EXISTS archived_at, DROP COLUMN IF EXISTS connection_id,
--     DROP COLUMN IF EXISTS folder_path, DROP COLUMN IF EXISTS approved_by, DROP COLUMN IF EXISTS approved_at;

-- ── Knowledge bases: owner, level, team, lifecycle ──────────────────────────────────────────────
ALTER TABLE "knowledge_sources"
  ADD COLUMN IF NOT EXISTS "owner_id"      TEXT,
  ADD COLUMN IF NOT EXISTS "scope"         TEXT NOT NULL DEFAULT 'org',
  ADD COLUMN IF NOT EXISTS "team_id"       UUID,           -- teams arrive in Phase 2; no foreign key yet
  ADD COLUMN IF NOT EXISTS "archived_at"   TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "connection_id" UUID,           -- Phase 3: a storage-connection folder as the source
  ADD COLUMN IF NOT EXISTS "folder_path"   TEXT,
  ADD COLUMN IF NOT EXISTS "approved_by"   TEXT,           -- promotion to organisation level (admins)
  ADD COLUMN IF NOT EXISTS "approved_at"   TIMESTAMPTZ(6);
DO $$ BEGIN
  ALTER TABLE "knowledge_sources" ADD CONSTRAINT "ck_ks_scope" CHECK ("scope" IN ('personal', 'team', 'org'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "idx_ks_org_scope_owner" ON "knowledge_sources" ("org_id", "scope", "owner_id");

-- ── Documents: one row per file version or Q&A entry ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "knowledge_documents" (
  "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
  "source_id"     UUID NOT NULL REFERENCES "knowledge_sources"("id") ON DELETE CASCADE,
  "org_id"        TEXT NOT NULL,
  "kind"          TEXT NOT NULL,             -- file | qa
  "origin"        TEXT NOT NULL,             -- upload | connection | qa
  "name"          TEXT NOT NULL,
  "path"          TEXT,                      -- path in a connection folder, or the uploaded file name
  "mime_type"     TEXT,
  "size_bytes"    BIGINT,
  "storage_ref"   TEXT,                      -- where the original bytes are kept (uploads)
  "question"      TEXT,                      -- Q&A entries
  "answer"        TEXT,
  "content_hash"  TEXT,                      -- sha256 of the bytes (files) or of question + answer
  "version"       INTEGER NOT NULL DEFAULT 1,
  "status"        TEXT NOT NULL DEFAULT 'pending', -- pending | indexing | indexed | failed | superseded
  "error"         TEXT,
  "page_count"    INTEGER,
  "chunk_count"   INTEGER NOT NULL DEFAULT 0,
  "ocr_pages"     INTEGER NOT NULL DEFAULT 0,
  "failed_pages"  INTEGER[] NOT NULL DEFAULT '{}',
  "effective_date" DATE,
  "superseded_by" UUID,
  "created_by"    TEXT NOT NULL,
  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "indexed_at"    TIMESTAMPTZ(6),
  CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_kd_kind" CHECK ("kind" IN ('file', 'qa')),
  CONSTRAINT "ck_kd_origin" CHECK ("origin" IN ('upload', 'connection', 'qa')),
  CONSTRAINT "ck_kd_status" CHECK ("status" IN ('pending', 'indexing', 'indexed', 'failed', 'superseded'))
);
CREATE INDEX IF NOT EXISTS "idx_kd_source_status" ON "knowledge_documents" ("source_id", "status");
-- One current (not superseded) version per path in a knowledge base.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_kd_source_path_current" ON "knowledge_documents" ("source_id", "path")
  WHERE "status" <> 'superseded' AND "path" IS NOT NULL;

-- ── Chunks: link to their document, structure, keyword and vector indexes ─────────────────────
ALTER TABLE "knowledge_chunks"
  ADD COLUMN IF NOT EXISTS "document_id"  UUID REFERENCES "knowledge_documents"("id") ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS "section_path" TEXT,               -- e.g. "SMS › 4 Emergency › 4.2 Fire"
  ADD COLUMN IF NOT EXISTS "page"         INTEGER,
  ADD COLUMN IF NOT EXISTS "chunk_type"   TEXT NOT NULL DEFAULT 'text', -- text | row | slide | qa | image
  ADD COLUMN IF NOT EXISTS "content_hash" TEXT;
ALTER TABLE "knowledge_chunks"
  ADD COLUMN IF NOT EXISTS "content_tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('english'::regconfig, coalesce("section_path", '') || ' ' || "content")) STORED;
ALTER TABLE "knowledge_chunks" ALTER COLUMN "embedding" TYPE vector(1024) USING "embedding"::vector(1024);
CREATE INDEX IF NOT EXISTS "idx_kc_document" ON "knowledge_chunks" ("document_id");
CREATE INDEX IF NOT EXISTS "idx_kc_content_tsv" ON "knowledge_chunks" USING gin ("content_tsv");
CREATE INDEX IF NOT EXISTS "idx_kc_embedding_hnsw" ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);

-- ── Background jobs (read, split, embed; later refresh a folder). Shared later with the run engine ─
CREATE TABLE IF NOT EXISTS "knowledge_jobs" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id"       TEXT NOT NULL,
  "kind"         TEXT NOT NULL,              -- index_document | refresh_folder
  "source_id"    UUID REFERENCES "knowledge_sources"("id") ON DELETE CASCADE,
  "document_id"  UUID REFERENCES "knowledge_documents"("id") ON DELETE CASCADE,
  "status"       TEXT NOT NULL DEFAULT 'queued', -- queued | running | done | failed
  "attempts"     INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "run_after"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "locked_at"    TIMESTAMPTZ(6),
  "locked_by"    TEXT,
  "last_error"   TEXT,
  "payload"      JSONB NOT NULL DEFAULT '{}',
  "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "finished_at"  TIMESTAMPTZ(6),
  CONSTRAINT "knowledge_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_kj_status" CHECK ("status" IN ('queued', 'running', 'done', 'failed'))
);
CREATE INDEX IF NOT EXISTS "idx_kj_ready" ON "knowledge_jobs" ("status", "run_after");

-- ── Search log, for quality and gap reports ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "knowledge_queries" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id"       TEXT NOT NULL,
  "user_id"      TEXT,
  "surface"      TEXT NOT NULL,              -- agent | automation | test_search | script
  "source_ids"   UUID[] NOT NULL DEFAULT '{}',
  "question"     TEXT NOT NULL,
  "results"      JSONB NOT NULL DEFAULT '[]', -- [{ chunkId, documentId, score }]
  "result_count" INTEGER NOT NULL DEFAULT 0,
  "top_score"    DOUBLE PRECISION,
  "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "knowledge_queries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "idx_kq_org_created" ON "knowledge_queries" ("org_id", "created_at" DESC);
