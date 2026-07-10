/**
 * knowledge-sync.ts
 *
 * Bridges the harvest pipeline (platform_context_*) into the Knowledge system
 * (knowledge_sources / knowledge_chunks). After T2 semantic enrichment for an
 * object completes, this module serialises:
 *   1. Schema documentation — DDL-style data dictionary
 *   2. Semantic summary     — the T2 object card as natural language
 *   3. Data samples         — up to 5 rows formatted as a markdown table
 * …and stores them as knowledge chunks (with Bedrock embeddings) linked to a
 * per-platform-source knowledge_sources row.
 */

import prisma from '@/lib/db';
import { chunkText } from '@/lib/knowledge/chunker';
import { embedText, embeddingToSql } from '@/lib/knowledge/embed';
import { DatabricksAdapter } from './databricks-adapter';

// ── Types (local mirrors of Prisma shapes) ────────────────────────────────────

interface ObjectRow {
  id: string;
  source_id: string;
  org_id: string;
  full_path: string;
  catalog_name: string | null;
  schema_name: string | null;
  object_name: string | null;
  object_kind: string;
  native_comment: string | null;
  row_count_est: bigint | null;
  size_bytes_est: bigint | null;
  last_t2_at: Date | null;
  last_knowledge_sync_at: Date | null;
}

interface ColumnRow {
  name: string;
  ordinal: number | null;
  data_type: string | null;
  is_nullable: boolean | null;
  native_comment: string | null;
  profile: unknown;
  semantic: unknown;
  lifecycle: string;
}

interface SemanticCard {
  summary?: string;
  entity?: string;
  grain?: string;
  key_columns?: string[];
  fk_candidates?: Array<{ column: string; likely_target: string; confidence: number }>;
  time_columns?: { event: string | null; ingest: string | null };
  measures?: string[];
  usage_patterns?: Array<{ intent: string; sql_sketch: string }>;
  caveats?: string[];
  pii_columns?: string[];
  confidence?: number;
}

interface ColumnSemantic {
  role?: string;
  entity?: string;
  description?: string;
  pii_flag?: boolean;
}

// ── Document serialisers ──────────────────────────────────────────────────────

function buildSchemaDoc(obj: ObjectRow, columns: ColumnRow[]): string {
  const activeColumns = columns.filter(c => c.lifecycle === 'active');
  const lines: string[] = [];

  lines.push(`# ${obj.full_path}`);
  lines.push(`Kind: ${obj.object_kind}`);
  if (obj.native_comment) lines.push(`Description: ${obj.native_comment}`);
  if (obj.row_count_est != null) lines.push(`Approx rows: ${obj.row_count_est.toLocaleString()}`);
  if (obj.size_bytes_est != null) {
    const mb = Number(obj.size_bytes_est) / (1024 * 1024);
    lines.push(`Approx size: ${mb.toFixed(1)} MB`);
  }
  lines.push('');
  lines.push('## Columns');
  lines.push('');

  for (const col of activeColumns.sort((a, b) => (a.ordinal ?? 99) - (b.ordinal ?? 99))) {
    const sem = col.semantic as ColumnSemantic | null;
    const nullable = col.is_nullable === false ? ' NOT NULL' : '';
    const desc = sem?.description ?? col.native_comment ?? '';
    const pii = sem?.pii_flag ? ' [PII]' : '';
    const role = sem?.role ? ` (${sem.role})` : '';
    lines.push(`- **${col.name}** ${col.data_type ?? ''}${nullable}${pii}${role}${desc ? ` — ${desc}` : ''}`);
  }

  return lines.join('\n');
}

function buildSemanticDoc(obj: ObjectRow, card: SemanticCard): string {
  const lines: string[] = [];

  lines.push(`# Semantic Profile: ${obj.full_path}`);
  if (card.entity) lines.push(`Entity: ${card.entity}`);
  if (card.grain) lines.push(`Grain: ${card.grain}`);
  if (card.summary) lines.push(`\nSummary: ${card.summary}`);

  if (card.key_columns?.length) {
    lines.push(`\nKey columns: ${card.key_columns.join(', ')}`);
  }
  if (card.measures?.length) {
    lines.push(`Measures: ${card.measures.join(', ')}`);
  }
  if (card.time_columns?.event || card.time_columns?.ingest) {
    lines.push(`Time columns — event: ${card.time_columns.event ?? 'none'}, ingest: ${card.time_columns.ingest ?? 'none'}`);
  }
  if (card.pii_columns?.length) {
    lines.push(`PII columns: ${card.pii_columns.join(', ')}`);
  }
  if (card.fk_candidates?.length) {
    lines.push('\nForeign key candidates:');
    for (const fk of card.fk_candidates) {
      lines.push(`  - ${fk.column} → ${fk.likely_target} (confidence: ${(fk.confidence * 100).toFixed(0)}%)`);
    }
  }
  if (card.usage_patterns?.length) {
    lines.push('\nUsage patterns:');
    for (const up of card.usage_patterns) {
      lines.push(`  ${up.intent}`);
      if (up.sql_sketch) lines.push(`    SQL: ${up.sql_sketch}`);
    }
  }
  if (card.caveats?.length) {
    lines.push(`\nCaveats: ${card.caveats.join(' | ')}`);
  }

  return lines.join('\n');
}

function buildSampleDoc(obj: ObjectRow, rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const lines: string[] = [];
  lines.push(`# Data Samples: ${obj.full_path}`);

  const cols = Object.keys(rows[0]);
  lines.push('');
  lines.push(`| ${cols.join(' | ')} |`);
  lines.push(`| ${cols.map(() => '---').join(' | ')} |`);
  for (const row of rows) {
    lines.push(`| ${cols.map(c => String(row[c] ?? '')).join(' | ')} |`);
  }

  return lines.join('\n');
}

// ── Chunk & embed helper ──────────────────────────────────────────────────────

async function ingestDocument(
  sourceId: string,
  orgId: string,
  docRef: string,
  content: string,
): Promise<number> {
  if (!content.trim()) return 0;
  const chunks = chunkText(content, docRef);
  let inserted = 0;

  for (const chunk of chunks) {
    const embedding = await embedText(chunk.content);

    if (embedding) {
      const embSql = embeddingToSql(embedding);
      await prisma.$executeRawUnsafe(
        `INSERT INTO knowledge_chunks (id, source_id, org_id, content, embedding, chunk_index, doc_ref, metadata, created_at)
         VALUES (gen_random_uuid(), $1::uuid, $2, $3, $4::vector, $5, $6, $7::jsonb, now())
         ON CONFLICT DO NOTHING`,
        sourceId, orgId, chunk.content, embSql,
        chunk.chunk_index, chunk.doc_ref, JSON.stringify(chunk.metadata),
      );
    } else {
      await prisma.$executeRaw`
        INSERT INTO knowledge_chunks (id, source_id, org_id, content, chunk_index, doc_ref, metadata, created_at)
        VALUES (gen_random_uuid(), ${sourceId}::uuid, ${orgId}, ${chunk.content}, ${chunk.chunk_index}, ${chunk.doc_ref}, ${JSON.stringify(chunk.metadata)}::jsonb, now())
        ON CONFLICT DO NOTHING
      `;
    }
    inserted++;
  }

  return inserted;
}

// ── Find or create a knowledge_sources row for a platform source ──────────────

async function getOrCreateKnowledgeSource(
  platformSourceId: string,
  orgId: string,
): Promise<string> {
  const slug = `context:${platformSourceId}`;

  const existing = await prisma.knowledge_sources.findFirst({
    where: { org_id: orgId, slug },
    select: { id: true },
  });

  if (existing) return existing.id;

  const src = await prisma.platformContextSource.findUniqueOrThrow({
    where: { id: platformSourceId },
    select: { display_name: true },
  });

  const created = await prisma.knowledge_sources.create({
    data: {
      org_id: orgId,
      name: `${src.display_name ?? 'Databricks'} (Catalog)`,
      type: 'DATABASE',
      status: 'INDEXING',
      auth_type: 'service_account',
      refresh_schedule: 'daily',
      tags: ['harvested', 'databricks'],
      slug,
      description: `Auto-generated knowledge from the Data Estate harvest for source: ${src.display_name ?? platformSourceId}`,
      search_mode: 'semantic',
      embedding_model: 'aloft_native',
      chunk_size: 512,
      chunk_overlap: 64,
      top_k: 5,
      hybrid_weight: 50,
      metadata_filters: [],
      score_discoverable: 20,
      score_accessible: 20,
      score_trusted: 15,
      score_actionable: 0,
    },
    select: { id: true },
  });

  return created.id;
}

// ── Main export: syncObjectToKnowledge ────────────────────────────────────────

export interface KnowledgeSyncResult {
  objectId: string;
  fullPath: string;
  chunksIngested: number;
  skipped: boolean;
  error?: string;
}

export async function syncObjectToKnowledge(
  objectId: string,
  opts: { includeSamples?: boolean; force?: boolean } = {},
): Promise<KnowledgeSyncResult> {
  const obj = await prisma.platformContextObject.findUniqueOrThrow({
    where: { id: objectId },
  }) as unknown as ObjectRow;

  // Skip if no T2 enrichment yet
  if (!obj.last_t2_at) {
    return { objectId, fullPath: obj.full_path, chunksIngested: 0, skipped: true };
  }

  // Skip if already synced and not forced or changed
  if (!opts.force && obj.last_knowledge_sync_at && obj.last_t2_at <= obj.last_knowledge_sync_at) {
    return { objectId, fullPath: obj.full_path, chunksIngested: 0, skipped: true };
  }

  try {
    // Load columns
    const columns = await prisma.platformContextColumn.findMany({
      where: { object_id: objectId },
      select: {
        name: true, ordinal: true, data_type: true, is_nullable: true,
        native_comment: true, profile: true, semantic: true, lifecycle: true,
      },
      orderBy: { ordinal: 'asc' },
    }) as unknown as ColumnRow[];

    // Load latest semantic card
    const semanticRow = await prisma.platformContextSemantic.findFirst({
      where: { subject_id: objectId, subject_kind: 'object' },
      orderBy: { created_at: 'desc' },
      select: { card: true },
    });
    const card: SemanticCard = (semanticRow?.card ?? {}) as SemanticCard;

    // Get or create knowledge source
    const knowledgeSourceId = await getOrCreateKnowledgeSource(obj.source_id, obj.org_id);

    // Delete stale chunks for this object
    await prisma.$executeRaw`
      DELETE FROM knowledge_chunks
      WHERE source_id = ${knowledgeSourceId}::uuid
        AND doc_ref LIKE ${`context:${obj.full_path}:%`}
    `;

    let totalChunks = 0;

    // 1. Schema doc
    const schemaDoc = buildSchemaDoc(obj, columns);
    totalChunks += await ingestDocument(
      knowledgeSourceId, obj.org_id,
      `context:${obj.full_path}:schema`,
      schemaDoc,
    );

    // 2. Semantic summary (only if we have a card)
    if (card.summary || card.entity) {
      const semanticDoc = buildSemanticDoc(obj, card);
      totalChunks += await ingestDocument(
        knowledgeSourceId, obj.org_id,
        `context:${obj.full_path}:semantic`,
        semanticDoc,
      );
    }

    // 3. Data samples (optional, requires live Databricks connection)
    if (opts.includeSamples) {
      try {
        const srcRow = await prisma.platformContextSource.findUniqueOrThrow({
          where: { id: obj.source_id },
          select: { connection_ref: true, connection_kind: true },
        });
        if (srcRow.connection_kind === 'databricks') {
          const connRow = await prisma.platformDatabricksConnection.findUniqueOrThrow({
            where: { id: srcRow.connection_ref },
            select: { id: true, workspace_host: true, default_warehouse_id: true },
          });
          const adapter = new DatabricksAdapter(connRow);
          const rows = await adapter.fetchSampleRows(obj.full_path, 5);
          if (rows.length > 0) {
            const sampleDoc = buildSampleDoc(obj, rows);
            totalChunks += await ingestDocument(
              knowledgeSourceId, obj.org_id,
              `context:${obj.full_path}:samples`,
              sampleDoc,
            );
          }
        }
      } catch {
        // Samples are best-effort — don't fail the whole sync
      }
    }

    // Update last_knowledge_sync_at and chunk counts
    await prisma.platformContextObject.update({
      where: { id: objectId },
      data: { last_knowledge_sync_at: new Date() },
    });

    // Update the knowledge source counts
    const chunkCount = await prisma.knowledge_chunks.count({
      where: { source_id: knowledgeSourceId },
    });
    await prisma.knowledge_sources.update({
      where: { id: knowledgeSourceId },
      data: {
        status: 'INDEXED',
        chunk_count: chunkCount,
        doc_count: await prisma.platformContextObject.count({
          where: { source_id: obj.source_id, last_knowledge_sync_at: { not: null }, lifecycle: 'active' },
        }),
        last_indexed_at: new Date(),
      },
    });

    return { objectId, fullPath: obj.full_path, chunksIngested: totalChunks, skipped: false };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { objectId, fullPath: obj.full_path, chunksIngested: 0, skipped: false, error: msg };
  }
}

// ── Batch sync: all objects for a source that need syncing ────────────────────

export interface BatchSyncResult {
  synced: number;
  skipped: number;
  errors: number;
  totalChunks: number;
}

export async function syncSourceToKnowledge(
  sourceId: string,
  orgId: string,
  opts: { includeSamples?: boolean; force?: boolean } = {},
): Promise<BatchSyncResult> {
  // Find objects ready for sync: have T2, and either never synced or T2 is newer
  let objects: Array<{ id: string }>;
  if (opts.force) {
    objects = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM platform_context_objects
      WHERE source_id = ${sourceId}::uuid
        AND org_id = ${orgId}
        AND lifecycle = 'active'
        AND last_t2_at IS NOT NULL
      ORDER BY last_t2_at DESC
    `;
  } else {
    objects = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM platform_context_objects
      WHERE source_id = ${sourceId}::uuid
        AND org_id = ${orgId}
        AND lifecycle = 'active'
        AND last_t2_at IS NOT NULL
        AND (last_knowledge_sync_at IS NULL OR last_t2_at > last_knowledge_sync_at)
      ORDER BY last_t2_at DESC
    `;
  }

  let synced = 0;
  let skipped = 0;
  let errors = 0;
  let totalChunks = 0;

  for (const obj of objects) {
    const result = await syncObjectToKnowledge(obj.id, opts);
    if (result.skipped) skipped++;
    else if (result.error) errors++;
    else {
      synced++;
      totalChunks += result.chunksIngested;
    }
  }

  // Handle dropped objects — delete their chunks
  const dropped = await prisma.platformContextObject.findMany({
    where: { source_id: sourceId, org_id: orgId, lifecycle: 'dropped' },
    select: { full_path: true },
  });

  if (dropped.length > 0) {
    const knowledgeSourceId = await getOrCreateKnowledgeSource(sourceId, orgId);
    for (const obj of dropped) {
      await prisma.$executeRaw`
        DELETE FROM knowledge_chunks
        WHERE source_id = ${knowledgeSourceId}::uuid
          AND doc_ref LIKE ${`context:${obj.full_path}:%`}
      `;
    }
  }

  return { synced, skipped, errors, totalChunks };
}
