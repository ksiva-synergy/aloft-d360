// INVARIANT: no warehouse access in this file.
// All reads come exclusively from platform_context_* tables via Prisma.
// executeDatabricksSQL must never be called here, directly or transitively.

import 'server-only';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import prisma from '@/lib/db';
import { enqueue, finalize } from './queue';

// ── Constants ──────────────────────────────────────────────────────────────────

export const TITAN_MODEL = 'amazon.titan-embed-text-v2:0';
const EMBED_DIMS = 1024;

// ── Bedrock client (hardcoded us-east-1 — Titan v2 is only in us-east-1) ──────

function getBedrockClient(): BedrockRuntimeClient {
  return new BedrockRuntimeClient({
    region: 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
}

// ── Row types for embed_text composition ──────────────────────────────────────

export interface ObjectEmbedRow {
  full_path: string;
  object_kind: string;
  card: { summary: string; grain: string; key_columns: string[] };
}

export interface ColumnEmbedRow {
  full_path: string; // parent object full_path
  name: string;
  data_type: string | null;
  semantic: { description: string; role: string; pii_flag?: boolean };
  top_k: { value: unknown; count: number }[] | null;
}

// ── embed_text composition (deterministic, stored verbatim per DESIGN.md §6.2) ─

export function composeEmbedText(subject: 'object', row: ObjectEmbedRow): string;
export function composeEmbedText(subject: 'column', row: ColumnEmbedRow): string;
export function composeEmbedText(
  subject: 'object' | 'column',
  row: ObjectEmbedRow | ColumnEmbedRow,
): string {
  if (subject === 'object') {
    const r = row as ObjectEmbedRow;
    const keyCols = r.card.key_columns.length > 0 ? r.card.key_columns.join(', ') : '(unknown)';
    // Strip trailing punctuation/whitespace so summary-ending periods don't produce ".."
    const summary = r.card.summary.replace(/[\s.]+$/, '');
    return (
      `${r.full_path} (${r.object_kind}): ${summary}. ` +
      `Grain: ${r.card.grain}. Key columns: ${keyCols}.`
    );
  } else {
    const r = row as ColumnEmbedRow;
    const dt = r.data_type ?? 'unknown';
    const sampleVals =
      r.top_k && r.top_k.length > 0
        ? r.top_k
            .slice(0, 5)
            .map((e) => String(e.value))
            .join(', ')
        : '(none)';
    return (
      `${r.full_path}.${r.name} (${dt}): ${r.semantic.description}. ` +
      `Role: ${r.semantic.role}. Sample values: ${sampleVals}.`
    );
  }
}

// ── Titan v2 embedding (same call pattern as knowledge/embed.ts) ───────────────

async function callTitan(text: string): Promise<number[] | null> {
  try {
    const truncated = text.slice(0, 32_000);
    const client = getBedrockClient();
    const cmd = new InvokeModelCommand({
      modelId: TITAN_MODEL,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({ inputText: truncated, dimensions: EMBED_DIMS, normalize: true }),
    });
    const resp = await client.send(cmd);
    const parsed = JSON.parse(new TextDecoder().decode(resp.body)) as { embedding: number[] };
    return parsed.embedding;
  } catch (err) {
    console.warn('[embed] Titan call failed', err);
    return null;
  }
}

function vectorToSql(v: number[]): string {
  return `[${v.join(',')}]`;
}

// ── Upsert one embedding row ───────────────────────────────────────────────────

async function upsertEmbedding(
  orgId: string,
  subjectKind: string,
  subjectId: string,
  embedText: string,
  embedding: number[],
): Promise<void> {
  const vec = vectorToSql(embedding);
  // ::text::vector cast is required: Prisma passes interpolated values as typed
  // parameters; Postgres cannot apply ::vector to a bound parameter at parse time.
  await prisma.$executeRaw`
    INSERT INTO platform_context_embeddings
      (id, org_id, subject_kind, subject_id, embed_text, embedding, model_id, created_at)
    VALUES
      (gen_random_uuid(), ${orgId}, ${subjectKind}, ${subjectId}::uuid,
       ${embedText}, ${vec}::text::vector, ${TITAN_MODEL}, NOW())
    ON CONFLICT (subject_kind, subject_id)
    DO UPDATE SET
      org_id     = EXCLUDED.org_id,
      embed_text = EXCLUDED.embed_text,
      embedding  = EXCLUDED.embedding,
      model_id   = EXCLUDED.model_id,
      created_at = NOW()
  `;
}

// ── embedSubjects ─────────────────────────────────────────────────────────────

export interface EmbedSubjectsResult {
  embedded: number;
  skipped: number;
  failed: number;
}

/**
 * Embeds a batch of subject IDs (all the same kind) and upserts into
 * platform_context_embeddings. Skips subjects whose computed embed_text
 * matches the already-stored value. Ingest-org and search-org invariant:
 * all rows are written with orgId, and existing rows are loaded with orgId.
 */
export async function embedSubjects(
  orgId: string,
  subjectKind: 'object' | 'column',
  subjectIds: string[],
): Promise<EmbedSubjectsResult> {
  if (subjectIds.length === 0) return { embedded: 0, skipped: 0, failed: 0 };

  // Load existing embedding rows for change-detection (org-scoped)
  const existing = await prisma.platformContextEmbedding.findMany({
    where: { org_id: orgId, subject_kind: subjectKind, subject_id: { in: subjectIds } },
    select: { subject_id: true, embed_text: true },
  });
  const existingMap = new Map(existing.map((e) => [e.subject_id, e.embed_text ?? '']));

  let embedded = 0;
  let skipped = 0;
  let failed = 0;

  if (subjectKind === 'object') {
    const objects = await prisma.platformContextObject.findMany({
      where: { id: { in: subjectIds }, org_id: orgId },
      select: { id: true, full_path: true, object_kind: true },
    });

    // Batch-load latest semantic card per object (one query, no N+1)
    const semantics = await prisma.platformContextSemantic.findMany({
      where: { subject_kind: 'object', subject_id: { in: subjectIds } },
      orderBy: { version: 'desc' },
      select: { subject_id: true, card: true },
    });
    const semanticMap = new Map<string, Record<string, unknown>>();
    for (const s of semantics) {
      if (!semanticMap.has(s.subject_id)) {
        semanticMap.set(s.subject_id, s.card as Record<string, unknown>);
      }
    }

    for (const obj of objects) {
      const card = semanticMap.get(obj.id);
      if (!card) {
        skipped++;
        continue;
      }

      const row: ObjectEmbedRow = {
        full_path: obj.full_path,
        object_kind: obj.object_kind,
        card: {
          summary: typeof card.summary === 'string' ? card.summary : '',
          grain: typeof card.grain === 'string' ? card.grain : '',
          key_columns: Array.isArray(card.key_columns) ? (card.key_columns as string[]) : [],
        },
      };

      const embedText = composeEmbedText('object', row);
      if (existingMap.get(obj.id) === embedText) {
        skipped++;
        continue;
      }

      const vec = await callTitan(embedText);
      if (!vec) {
        failed++;
        continue;
      }

      await upsertEmbedding(orgId, 'object', obj.id, embedText, vec);
      embedded++;
    }
  } else {
    // Columns — include object full_path via relation
    const columns = await prisma.platformContextColumn.findMany({
      where: { id: { in: subjectIds }, org_id: orgId },
      select: {
        id: true,
        name: true,
        data_type: true,
        profile: true,
        semantic: true,
        object: { select: { full_path: true } },
      },
    });

    for (const col of columns) {
      const sem = (col.semantic ?? {}) as Record<string, unknown>;
      if (!sem.description || !sem.role) {
        skipped++;
        continue;
      }

      type TopKEntry = { value: unknown; count: number };
      const p = (col.profile ?? {}) as Record<string, unknown>;
      const isPii = sem.pii_flag === true;
      const topK =
        !isPii && Array.isArray(p.top_k) ? (p.top_k as TopKEntry[]).slice(0, 5) : null;

      const row: ColumnEmbedRow = {
        full_path: col.object.full_path,
        name: col.name,
        data_type: col.data_type,
        semantic: {
          description: String(sem.description),
          role: String(sem.role),
          pii_flag: isPii,
        },
        top_k: topK,
      };

      const embedText = composeEmbedText('column', row);
      if (existingMap.get(col.id) === embedText) {
        skipped++;
        continue;
      }

      const vec = await callTitan(embedText);
      if (!vec) {
        failed++;
        continue;
      }

      await upsertEmbedding(orgId, 'column', col.id, embedText, vec);
      embedded++;
    }
  }

  return { embedded, skipped, failed };
}

// ── embedQuery (exported for semantic search) ─────────────────────────────────

/**
 * Embed a raw query string via Titan v2 for use in searchObjects.
 * Returns null on Bedrock failure — callers must fall back to text search.
 */
export async function embedQuery(text: string): Promise<number[] | null> {
  return callTitan(text);
}

// ── runEmbedJob ────────────────────────────────────────────────────────────────

export interface EmbedJobResult {
  jobId: string;
  objectsEmbedded: number;
  columnsEmbedded: number;
  skipped: number;
  failed: number;
  status: 'succeeded' | 'failed' | 'partial';
  error?: string;
}

/**
 * Embeds all objects and columns for the source that have semantic data
 * but no embedding yet (or where embed_text would change). Job kind 'embed'.
 */
export async function runEmbedJob(sourceId: string, orgId: string): Promise<EmbedJobResult> {
  const job = await enqueue('embed', sourceId, null, 'on_demand', orgId);
  await prisma.platformContextJob.update({
    where: { id: job.id },
    data: { status: 'running', started_at: new Date() },
  });

  const errors: string[] = [];

  // Objects: must have a semantic card (last_t2_at NOT NULL)
  const objectRows = await prisma.platformContextObject.findMany({
    where: {
      source_id: sourceId,
      org_id: orgId,
      lifecycle: 'active',
      last_t2_at: { not: null },
    },
    select: { id: true },
  });
  const objectIds = objectRows.map((o) => o.id);

  // Columns: must have semantic data (semantic IS NOT NULL — load and filter in JS)
  const allColRows = await prisma.platformContextColumn.findMany({
    where: {
      org_id: orgId,
      lifecycle: 'active',
      object: { source_id: sourceId },
    },
    select: { id: true, semantic: true },
  });
  const columnIds = allColRows.filter((c) => c.semantic !== null).map((c) => c.id);

  let objResult: EmbedSubjectsResult = { embedded: 0, skipped: 0, failed: 0 };
  let colResult: EmbedSubjectsResult = { embedded: 0, skipped: 0, failed: 0 };

  try {
    objResult = await embedSubjects(orgId, 'object', objectIds);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`objects: ${msg}`);
  }

  try {
    colResult = await embedSubjects(orgId, 'column', columnIds);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`columns: ${msg}`);
  }

  const totalEmbedded = objResult.embedded + colResult.embedded;
  const status =
    errors.length === 0 ? 'succeeded' : totalEmbedded > 0 ? 'partial' : 'failed';

  await finalize(
    job.id,
    status,
    {
      objects_embedded: objResult.embedded,
      columns_embedded: colResult.embedded,
      skipped: objResult.skipped + colResult.skipped,
      failed: objResult.failed + colResult.failed,
      model_id: TITAN_MODEL,
    },
    errors.length > 0 ? errors.join('\n') : undefined,
  );

  return {
    jobId: job.id,
    objectsEmbedded: objResult.embedded,
    columnsEmbedded: colResult.embedded,
    skipped: objResult.skipped + colResult.skipped,
    failed: objResult.failed + colResult.failed,
    status,
    ...(errors.length > 0 ? { error: errors.join('\n') } : {}),
  };
}
