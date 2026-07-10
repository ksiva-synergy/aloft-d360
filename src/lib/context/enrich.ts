// INVARIANT: no warehouse access in this file.
// All reads come exclusively from platform_context_* tables via Prisma.
// executeDatabricksSQL must never be called here, directly or transitively.

import 'server-only';
import { z } from 'zod';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/db';
import { enqueue, finalize } from './queue';
import type { DriftResult } from './profile';
import { extractDomainKeywords } from './keywords';
import { getUsageSignalsForEnrich } from './usage';

const minimatch = require('minimatch') as (p: string, pattern: string, opts?: { dot?: boolean }) => boolean;

function matchesPatterns(fullPath: string, patterns: string[]): boolean {
  return patterns.some(pat => minimatch(fullPath, pat, { dot: true }));
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MODEL_ID = 'us.anthropic.claude-sonnet-4-6';
const PROMPT_VERSION = 'enrich_object_v2';
const PRICE_INPUT_PER_M_USD = 3;   // USD per 1M input tokens  (Sonnet)
const PRICE_OUTPUT_PER_M_USD = 15; // USD per 1M output tokens (Sonnet)

// ── Bedrock client (same factory pattern as generate-title route) ─────────────

function getBedrockClient(): BedrockRuntimeClient {
  return new BedrockRuntimeClient({
    region: process.env.BEDROCK_REGION ?? 'us-east-1',
    // No explicit credentials — uses default provider chain:
    // ECS task role in Fargate, local env vars / ~/.aws in dev
  });
}

// ── Zod schemas for LLM output validation ────────────────────────────────────

const FkCandidateSchema = z.object({
  column: z.string(),
  likely_target: z.string(),
  confidence: z.number().min(0).max(1),
});

const UsagePatternSchema = z.object({
  intent: z.string(),
  sql_sketch: z.string(),
});

const ObjectCardSchema = z.object({
  summary: z.string(),
  entity: z.string(),
  grain: z.string(),
  key_columns: z.array(z.string()),
  fk_candidates: z.array(FkCandidateSchema),
  time_columns: z.object({ event: z.string().nullable(), ingest: z.string().nullable() }),
  measures: z.array(z.string()),
  json_blob_columns: z.record(z.object({ observed_keys: z.array(z.string()) })),
  usage_patterns: z.array(UsagePatternSchema).min(1),
  caveats: z.array(z.string()),
  pii_columns: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

const ColumnSemanticLlmSchema = z.object({
  role: z.enum(['key', 'dimension', 'measure', 'timestamp', 'audit', 'text_blob', 'fk_ref', 'flag', 'other']),
  entity: z.string(),
  description: z.string(),
  pii_flag: z.boolean(),
  confidence: z.number().min(0).max(1),
});

const LlmResponseSchema = z.object({
  card: ObjectCardSchema,
  columns: z.record(ColumnSemanticLlmSchema),
});

type LlmResponse = z.infer<typeof LlmResponseSchema>;

// ── System prompt (mirrors prompts/context/enrich_object_v1.md §SYSTEM) ──────

const SYSTEM_PROMPT = `You are a data catalog enrichment engine. Analyse the structural and statistical metadata of a database object and produce a semantic card plus per-column semantics.

Return a SINGLE valid JSON object. NO markdown fences, NO preamble, NO explanation after the closing brace. First character must be { and last must be }.

Top-level structure — no additional keys:
{
  "card": { ...12 required fields... },
  "columns": { "<column_name>": { ...5 required fields... }, ... }
}

CARD fields (all required):
  summary        — string: 1-3 sentences describing the object, its domain, and what a query author must know
  entity         — string: snake_case primary real-world entity (e.g. seafarer_contract, vessel_call)
  grain          — string: "one row per ..."
  key_columns    — string[]: columns that uniquely identify a row (empty array only if genuinely unknown)
  fk_candidates  — array of {column, likely_target, confidence} (empty array if no evidence — see FK rules)
  time_columns   — {event: string|null, ingest: string|null}
  measures       — string[]: numeric columns representing measurable quantities
  json_blob_columns — {col: {observed_keys: string[]}}: one entry per JSONB/struct column with visible top_k keys
  usage_patterns — array of {intent, sql_sketch}, minimum 2 entries
  caveats        — string[]: warnings the query author must know (see caveat rules)
  pii_columns    — string[]: every column with pii_flag=true
  confidence     — number 0-1: overall certainty of the card

COLUMN SEMANTICS fields per column (all required):
  role        — one of: key dimension measure timestamp audit text_blob fk_ref flag other
  entity      — string: real-world concept this column identifies or describes
  description — string: short phrase (max 6 words) replacing a warehouse inspection
  pii_flag    — boolean
  confidence  — number 0-1

RULE 1 — STRICT JSON. No fences, no preamble, no trailing explanation. { first, } last.

RULE 2 — FK CANDIDATES. Only propose when ALL of these hold:
  • Column name ends with _id/_key/_ref/_code/_no, or is clearly a foreign reference
  • Column type is compatible with a primary key (string, integer, uuid)
  • distinct_est < row_count_est from profile (confirms it is not the PK itself)
  • A plausible target path is derivable from the sibling objects list — never fabricate a path
  Set confidence ≤ 0.6 when target is inferred rather than directly visible in siblings.
  NEVER propose the object's own primary key column (id or the sole key column) as an FK.
  *_snapshot_id columns: include only when cardinality corroboration is present; cap confidence at 0.5.

RULE 3 — PII FLAGGING. Set pii_flag:true for any column that contains or could plausibly contain:
  • Full names, given names, surnames (name, full_name, first_name, last_name on a person entity)
  • National IDs, passport numbers, seafarer CDC numbers, booking reference IDs
  • Contact info: email, phone, mobile, address, port of domicile
  • Date of birth, nationality, gender when combined with a person identifier
  • Free-text person blobs: seafarer_info, person_details, any *_info/*_details on a person-grain object
  • family_info or any family_* column — contains family member personal data
  • Financial compensation columns: wages_info, revised_salary_info, poseidon_wages_info, and any column
    whose name contains wage/salary/compensation/pay storing individual-level amounts (not aggregates)
  • Any JSONB/struct column aggregating person attributes
  When in doubt on a *_info or *_details column on a person-grain object: pii_flag:true.

RULE 4 — CAVEATS. When drift data is provided:
  • You MUST include at least one caveat referencing the drift history/events (even if noting stability, e.g. "row count stable across drift events #2–#5, 2026-06-11"). Use the format "(drift event #<N>, <date>)" or "(drift events #<A>-#<B>, <date>)".
  • Include a caveat for null_rate > 0.20 on any required business field (measure, key, named entity id)
  • Do NOT fabricate caveats. Omit rather than invent.

RULE 5 — COMPLETENESS. Every column in column_definitions MUST have a corresponding entry in columns.

RULE 6 — BREVITY AND CONCISENESS. To prevent response truncation on tables with many columns:
  • Write extremely concise column descriptions (5 words or fewer).
  • Use short entity names (1-2 words).
  • Keep the JSON response compact.`;

// ── Drift summary assembler ────────────────────────────────────────────────────

type ProfileRow = { version: number; captured_at: Date; drift: unknown };

function assembleDriftSummary(profiles: ProfileRow[]): string {
  const lines: string[] = [];
  for (const p of profiles) {
    const d = p.drift as DriftResult | null;
    if (!d) continue;

    const parts: string[] = [];
    if (d.row_delta_pct !== null) {
      const sign = d.row_delta_pct >= 0 ? '+' : '';
      parts.push(`row_delta_pct: ${sign}${(d.row_delta_pct * 100).toFixed(1)}%`);
    }
    if (d.new_columns.length > 0) parts.push(`new_columns — ${d.new_columns.join(', ')}`);
    if (d.dropped_columns.length > 0) parts.push(`dropped_columns — ${d.dropped_columns.join(', ')}`);
    if (d.null_rate_shifts.length > 0) {
      const shifts = d.null_rate_shifts
        .map((s) => `${s.column} ${s.delta >= 0 ? '+' : ''}${Math.round(s.delta * 100)}pp`)
        .join(', ');
      parts.push(`null_rate_shifts — ${shifts}`);
    }
    if (parts.length > 0) {
      lines.push(`Profile v${p.version} (${p.captured_at.toISOString()}): ${parts.join('; ')}`);
    }
  }
  return lines.length > 0 ? lines.join('\n') : 'No drift events recorded.';
}

// ── User message builder ───────────────────────────────────────────────────────

type ColumnRow = {
  name: string;
  data_type: string | null;
  is_nullable: boolean | null;
  native_comment: string | null;
  profile: unknown;
  semantic: unknown;
};

type SiblingRow = {
  full_path: string;
  object_kind: string;
  native_comment: string | null;
  row_count_est: bigint | null;
};

function buildUserMessage(
  full_path: string,
  object_kind: string,
  native_comment: string | null,
  columns: ColumnRow[],
  drift_summary: string,
  siblings: SiblingRow[],
): string {
  type TopKEntry = { value: unknown; count: number };

  const colDefs = columns.map((c) => ({
    name: c.name,
    data_type: c.data_type ?? 'unknown',
    is_nullable: c.is_nullable ?? true,
    native_comment: c.native_comment ?? null,
  }));

  const colProfiles = columns.map((c) => {
    const p = (c.profile ?? {}) as Record<string, unknown>;
    const sem = (c.semantic ?? {}) as Record<string, unknown>;
    const isPii = sem.pii_flag === true;
    return {
      name: c.name,
      null_rate: typeof p.null_rate === 'number' ? p.null_rate : null,
      distinct_est: typeof p.distinct_est === 'number' ? p.distinct_est : null,
      min: p.min !== undefined ? p.min : null,
      max: p.max !== undefined ? p.max : null,
      ...(isPii
        ? {}
        : { top_k: Array.isArray(p.top_k) ? (p.top_k as TopKEntry[]).slice(0, 5) : null }),
    };
  });

  const siblingData = siblings.slice(0, 20).map((s) => ({
    full_path: s.full_path,
    object_kind: s.object_kind,
    native_comment: s.native_comment ?? null,
    row_count_est: s.row_count_est !== null ? Number(s.row_count_est) : null,
  }));

  return [
    'Enrich the following database object and return the semantic card + column semantics as STRICT JSON (no fences, no preamble).',
    '',
    '## Object',
    '',
    `path: ${full_path}`,
    `kind: ${object_kind}`,
    `native_comment: ${native_comment ?? 'null'}`,
    '',
    '## Column definitions',
    '',
    JSON.stringify(colDefs, null, 2),
    '',
    '(Array of: { name, data_type, is_nullable, native_comment })',
    '',
    '## Column profiles',
    '',
    JSON.stringify(colProfiles, null, 2),
    '',
    '(Array of: { name, null_rate, distinct_est, min, max, top_k }',
    ' NOTE: top_k is omitted for PII-flagged columns — do not infer values from those columns.)',
    '',
    '## Drift history',
    '',
    drift_summary,
    '',
    '## Sibling objects in the same schema',
    '',
    JSON.stringify(siblingData, null, 2),
    '',
    '(Use siblings to infer FK candidates — do NOT invent targets not derivable from this list.)',
    '',
    '---',
    '',
    'Return ONLY the JSON object. First character must be {.',
  ].join('\n');
}

// ── LLM call with one retry ────────────────────────────────────────────────────

function tryParseAndValidate(text: string): LlmResponse | null {
  const trimmed = text.trim();
  // Strip accidental markdown fences if present despite instructions
  const json = trimmed.startsWith('```')
    ? trimmed.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '')
    : trimmed;
  try {
    return LlmResponseSchema.parse(JSON.parse(json));
  } catch {
    return null;
  }
}

type BedrockCallResult = { parsed: LlmResponse; inputTokens: number; outputTokens: number };

// Scale output token budget with message length: wide tables need more room.
// claude-sonnet-4-6 supports up to 64K output tokens on Bedrock.
function resolveMaxTokens(userMessage: string): number {
  const charLen = userMessage.length;
  if (charLen > 20_000) return 32768;
  if (charLen > 10_000) return 16384;
  return 8192;
}

async function callBedrock(userMessage: string): Promise<BedrockCallResult> {
  const client = getBedrockClient();
  const maxTokens = resolveMaxTokens(userMessage);

  const resp1 = await client.send(new ConverseCommand({
    modelId: MODEL_ID,
    system: [{ text: SYSTEM_PROMPT }],
    messages: [{ role: 'user', content: [{ text: userMessage }] }],
    inferenceConfig: { maxTokens, temperature: 0.2 },
  }));

  const text1 = resp1.output?.message?.content?.[0]?.text ?? '';
  let inputTokens = resp1.usage?.inputTokens ?? 0;
  let outputTokens = resp1.usage?.outputTokens ?? 0;

  const parsed1 = tryParseAndValidate(text1);
  if (parsed1) return { parsed: parsed1, inputTokens, outputTokens };

  // One retry with a correction turn (per D-03 in PHASE_CH5_DECISIONS.md)
  const resp2 = await client.send(new ConverseCommand({
    modelId: MODEL_ID,
    system: [{ text: SYSTEM_PROMPT }],
    messages: [
      { role: 'user', content: [{ text: userMessage }] },
      { role: 'assistant', content: [{ text: text1 }] },
      { role: 'user', content: [{ text: 'Your previous response was not valid JSON. Return ONLY the JSON object, starting with {.' }] },
    ],
    inferenceConfig: { maxTokens, temperature: 0.2 },
  }));

  inputTokens += resp2.usage?.inputTokens ?? 0;
  outputTokens += resp2.usage?.outputTokens ?? 0;
  const text2 = resp2.output?.message?.content?.[0]?.text ?? '';

  const parsed2 = tryParseAndValidate(text2);
  if (parsed2) return { parsed: parsed2, inputTokens, outputTokens };

  throw new Error(`[enrich] LLM produced invalid JSON after retry. path=${userMessage.slice(0, 80)} raw=${text2.slice(0, 300)}`);
}

// ── DB writes ─────────────────────────────────────────────────────────────────

async function persistCard(
  objectId: string,
  orgId: string,
  card: z.infer<typeof ObjectCardSchema>,
): Promise<void> {
  const last = await prisma.platformContextSemantic.findFirst({
    where: { subject_kind: 'object', subject_id: objectId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const nextVersion = (last?.version ?? 0) + 1;

  await prisma.platformContextSemantic.create({
    data: {
      org_id: orgId,
      subject_kind: 'object',
      subject_id: objectId,
      version: nextVersion,
      card: card as unknown as Prisma.InputJsonValue,
      model_id: MODEL_ID,
      prompt_version: PROMPT_VERSION,
      confidence: card.confidence,
      status: 'assumed',
    },
  });
}

async function persistColumnSemantics(
  objectId: string,
  columns: z.infer<typeof LlmResponseSchema>['columns'],
): Promise<number> {
  let count = 0;
  for (const [colName, llmSem] of Object.entries(columns)) {
    // Runner injects provenance fields — LLM output never sets these (D-06)
    const fullSemantic = {
      ...llmSem,
      status: 'assumed',
      model_id: MODEL_ID,
      prompt_version: PROMPT_VERSION,
    };
    const result = await prisma.platformContextColumn.updateMany({
      where: { object_id: objectId, name: colName, lifecycle: 'active' },
      data: { semantic: fullSemantic as unknown as Prisma.InputJsonValue },
    });
    count += result.count;
  }
  return count;
}

// ── Column-batched enrichment for wide tables ─────────────────────────────────

const COLUMN_BATCH_SIZE = 25;

// Zod schema for columns-only intermediate batches (no card needed)
const ColumnsOnlyResponseSchema = z.object({
  columns: z.record(ColumnSemanticLlmSchema),
});
type ColumnsOnlyResponse = z.infer<typeof ColumnsOnlyResponseSchema>;

function tryParseColumnsOnly(text: string): ColumnsOnlyResponse | null {
  const trimmed = text.trim();
  const json = trimmed.startsWith('```')
    ? trimmed.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '')
    : trimmed;
  try {
    return ColumnsOnlyResponseSchema.parse(JSON.parse(json));
  } catch {
    return null;
  }
}

function buildColumnsOnlyMessage(
  full_path: string,
  object_kind: string,
  native_comment: string | null,
  columns: ColumnRow[],
  batchIndex: number,
  totalBatches: number,
): string {
  type TopKEntry = { value: unknown; count: number };
  const colDefs = columns.map((c) => ({
    name: c.name,
    data_type: c.data_type ?? 'unknown',
    is_nullable: c.is_nullable ?? true,
    native_comment: c.native_comment ?? null,
  }));
  const colProfiles = columns.map((c) => {
    const p = (c.profile ?? {}) as Record<string, unknown>;
    const sem = (c.semantic ?? {}) as Record<string, unknown>;
    const isPii = sem.pii_flag === true;
    return {
      name: c.name,
      null_rate: typeof p.null_rate === 'number' ? p.null_rate : null,
      distinct_est: typeof p.distinct_est === 'number' ? p.distinct_est : null,
      min: p.min !== undefined ? p.min : null,
      max: p.max !== undefined ? p.max : null,
      ...(isPii ? {} : { top_k: Array.isArray(p.top_k) ? (p.top_k as TopKEntry[]).slice(0, 5) : null }),
    };
  });

  return [
    `Analyse column batch ${batchIndex + 1} of ${totalBatches} for the table below. Return ONLY a JSON object with a "columns" key — no "card" key, no preamble, no fences.`,
    '',
    '## Object',
    '',
    `path: ${full_path}`,
    `kind: ${object_kind}`,
    `native_comment: ${native_comment ?? 'null'}`,
    '',
    '## Column definitions (this batch)',
    '',
    JSON.stringify(colDefs, null, 2),
    '',
    '## Column profiles (this batch)',
    '',
    JSON.stringify(colProfiles, null, 2),
    '',
    '---',
    '',
    'Return ONLY: {"columns": {"<col_name>": {role, entity, description, pii_flag, confidence}, ...}}',
    'First character must be {.',
  ].join('\n');
}

async function callBedrockColumnsOnly(
  userMessage: string,
): Promise<{ parsed: ColumnsOnlyResponse; inputTokens: number; outputTokens: number }> {
  const client = getBedrockClient();
  const maxTokens = resolveMaxTokens(userMessage);

  const resp1 = await client.send(new ConverseCommand({
    modelId: MODEL_ID,
    system: [{ text: SYSTEM_PROMPT }],
    messages: [{ role: 'user', content: [{ text: userMessage }] }],
    inferenceConfig: { maxTokens, temperature: 0.2 },
  }));

  const text1 = resp1.output?.message?.content?.[0]?.text ?? '';
  let inputTokens = resp1.usage?.inputTokens ?? 0;
  let outputTokens = resp1.usage?.outputTokens ?? 0;

  const parsed1 = tryParseColumnsOnly(text1);
  if (parsed1) return { parsed: parsed1, inputTokens, outputTokens };

  const resp2 = await client.send(new ConverseCommand({
    modelId: MODEL_ID,
    system: [{ text: SYSTEM_PROMPT }],
    messages: [
      { role: 'user', content: [{ text: userMessage }] },
      { role: 'assistant', content: [{ text: text1 }] },
      { role: 'user', content: [{ text: 'Your previous response was not valid JSON. Return ONLY the JSON object starting with {.' }] },
    ],
    inferenceConfig: { maxTokens, temperature: 0.2 },
  }));

  inputTokens += resp2.usage?.inputTokens ?? 0;
  outputTokens += resp2.usage?.outputTokens ?? 0;
  const text2 = resp2.output?.message?.content?.[0]?.text ?? '';

  const parsed2 = tryParseColumnsOnly(text2);
  if (parsed2) return { parsed: parsed2, inputTokens, outputTokens };

  throw new Error(`[enrich] columns-only LLM produced invalid JSON after retry. path=${userMessage.slice(0, 80)}`);
}

// ── Per-object enrichment (public) ────────────────────────────────────────────

export interface EnrichObjectStats {
  objectId: string;
  columnsEnriched: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export async function enrichObject(objectId: string, orgId: string): Promise<EnrichObjectStats> {
  // 1. Load object with columns, profiles, and schema siblings
  const obj = await prisma.platformContextObject.findUniqueOrThrow({
    where: { id: objectId },
    select: {
      full_path: true,
      object_kind: true,
      native_comment: true,
      source_id: true,
      schema_name: true,
      columns: {
        where: { lifecycle: 'active' },
        orderBy: { ordinal: 'asc' },
        select: {
          name: true,
          data_type: true,
          is_nullable: true,
          native_comment: true,
          profile: true,
          semantic: true,
        },
      },
    },
  });

  const [profiles, siblings] = await Promise.all([
    prisma.platformContextProfile.findMany({
      where: { object_id: objectId },
      orderBy: { version: 'asc' },
      select: { version: true, captured_at: true, drift: true },
    }),
    prisma.platformContextObject.findMany({
      where: {
        source_id: obj.source_id,
        schema_name: obj.schema_name,
        lifecycle: 'active',
        NOT: { id: objectId },
      },
      select: { full_path: true, object_kind: true, native_comment: true, row_count_est: true },
      orderBy: { full_path: 'asc' },
      take: 20,
    }),
  ]);

  const driftSummary = assembleDriftSummary(profiles);
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let mergedColumns: z.infer<typeof LlmResponseSchema>['columns'] = {};
  let finalCard: z.infer<typeof ObjectCardSchema>;

  if (obj.columns.length > COLUMN_BATCH_SIZE) {
    // Wide table: process columns in batches, generate card only on the final batch
    const batches: ColumnRow[][] = [];
    for (let i = 0; i < obj.columns.length; i += COLUMN_BATCH_SIZE) {
      batches.push(obj.columns.slice(i, i + COLUMN_BATCH_SIZE));
    }

    console.log(`[t2_semantic] ${obj.full_path}: wide table (${obj.columns.length} cols) → ${batches.length} batches`);

    // Intermediate batches: columns only
    for (let i = 0; i < batches.length - 1; i++) {
      const msg = buildColumnsOnlyMessage(
        obj.full_path, obj.object_kind, obj.native_comment,
        batches[i], i, batches.length,
      );
      const { parsed, inputTokens, outputTokens } = await callBedrockColumnsOnly(msg);
      mergedColumns = { ...mergedColumns, ...parsed.columns };
      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
    }

    // Final batch: full prompt (generates card + remaining columns)
    const lastBatch = batches[batches.length - 1];
    let finalMsg = buildUserMessage(
      obj.full_path, obj.object_kind, obj.native_comment,
      lastBatch, driftSummary, siblings,
    );
    // Append T3 usage signals if available (append-only — never gates T2)
    try {
      const usageSignals = await getUsageSignalsForEnrich(orgId, objectId);
      if (usageSignals.hasUsage) {
        finalMsg += '\n\nOBSERVED USAGE (from query history — treat as ground truth):\n'
          + JSON.stringify({
              access_stats: usageSignals.accessStats,
              key_columns: usageSignals.keyColumns,
              filter_patterns: usageSignals.filterPatterns,
            });
      }
    } catch {
      // T3 unavailability must never block T2 enrichment
    }
    const { parsed: finalParsed, inputTokens: fi, outputTokens: fo } = await callBedrock(finalMsg);
    mergedColumns = { ...mergedColumns, ...finalParsed.columns };
    finalCard = finalParsed.card;
    totalInputTokens += fi;
    totalOutputTokens += fo;
  } else {
    // Normal path: single call
    let userMessage = buildUserMessage(
      obj.full_path, obj.object_kind, obj.native_comment,
      obj.columns, driftSummary, siblings,
    );
    // Append T3 usage signals if available (append-only — never gates T2)
    try {
      const usageSignals = await getUsageSignalsForEnrich(orgId, objectId);
      if (usageSignals.hasUsage) {
        userMessage += '\n\nOBSERVED USAGE (from query history — treat as ground truth):\n'
          + JSON.stringify({
              access_stats: usageSignals.accessStats,
              key_columns: usageSignals.keyColumns,
              filter_patterns: usageSignals.filterPatterns,
            });
      }
    } catch {
      // T3 unavailability must never block T2 enrichment
    }
    const { parsed, inputTokens, outputTokens } = await callBedrock(userMessage);
    mergedColumns = parsed.columns;
    finalCard = parsed.card;
    totalInputTokens = inputTokens;
    totalOutputTokens = outputTokens;
  }

  // 4. Persist card + column semantics, then stamp last_t2_at
  await persistCard(objectId, orgId, finalCard!);
  const columnsEnriched = await persistColumnSemantics(objectId, mergedColumns);

  // 5. Derive domain_keywords from the freshly-written card and column semantics.
  //    Reload the object with updated columns so semantic roles are visible.
  const objForKeywords = await prisma.platformContextObject.findUniqueOrThrow({
    where: { id: objectId },
    select: {
      full_path: true,
      entity_tags: true,
      columns: {
        where: { lifecycle: 'active' },
        select: { name: true, semantic: true },
      },
    },
  });

  const domainKeywords = extractDomainKeywords({
    full_path: objForKeywords.full_path,
    card: {
      summary: typeof finalCard!.summary === 'string' ? finalCard!.summary : '',
      grain: typeof finalCard!.grain === 'string' ? finalCard!.grain : '',
      entity: typeof finalCard!.entity === 'string' ? finalCard!.entity : undefined,
      key_columns: Array.isArray(finalCard!.key_columns) ? finalCard!.key_columns : [],
    },
    entity_tags: objForKeywords.entity_tags as { groups?: Array<{ label: string }> } | null,
    columns: objForKeywords.columns.map((c) => ({
      name: c.name,
      semantic: c.semantic ? (c.semantic as { role?: string; entity?: string }) : null,
    })),
  });

  await prisma.platformContextObject.update({
    where: { id: objectId },
    data: { last_t2_at: new Date(), domain_keywords: domainKeywords },
  });

  const costUsd =
    (totalInputTokens * PRICE_INPUT_PER_M_USD + totalOutputTokens * PRICE_OUTPUT_PER_M_USD) / 1_000_000;

  return { objectId, columnsEnriched, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, costUsd };
}

// ── Batch runner (public) ─────────────────────────────────────────────────────

export interface T2EnrichResult {
  jobId: string;
  objectsEnriched: number;
  objectsSkipped: number;
  columnsEnriched: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  status: 'succeeded' | 'failed' | 'partial';
  error?: string;
}

/**
 * Enrich all objects in a source where last_t2_at IS NULL or < last_t1_at.
 * T1 must have run first (last_t1_at NOT NULL) — objects without a profile are skipped.
 *
 * If existingJobId is provided (claimed by the orchestrator via claimNext), that
 * job row is finalised on completion. Otherwise a new job row is created and
 * immediately moved to running.
 */
export async function runT2Enrich(
  sourceId: string,
  existingJobId?: string,
  opts?: {
    excludeSchemas?: string[];
    includePatterns?: string[];
    /** Auto-split: restrict DB query to a single catalog+schema partition */
    partitionCatalog?: string;
    partitionSchema?: string;
    /** Auto-split: if set, only enrich these object names within the partition */
    partitionObjects?: string[];
  },
): Promise<T2EnrichResult> {
  const source = await prisma.platformContextSource.findUniqueOrThrow({
    where: { id: sourceId },
    select: { org_id: true },
  });
  const orgId = source.org_id;

  let jobId: string;
  if (existingJobId) {
    jobId = existingJobId;
  } else {
    const job = await enqueue('t2_semantic', sourceId, null, 'on_demand', orgId);
    await prisma.platformContextJob.update({
      where: { id: job.id },
      data: { status: 'running', started_at: new Date() },
    });
    jobId = job.id;
  }

  // Fetch all profiled objects; apply excludeSchemas and includePatterns in JS.
  // excludeSchemas format is "catalog.schema" — filter by exact pair.
  // Bare schema names (no ".") match any catalog for backward compatibility.
  const allCandidates = await prisma.platformContextObject.findMany({
    where: {
      source_id: sourceId,
      lifecycle: 'active',
      last_t1_at: { not: null },
      ...(opts?.partitionCatalog ? { catalog_name: opts.partitionCatalog } : {}),
      ...(opts?.partitionSchema ? { schema_name: opts.partitionSchema } : {}),
      ...(opts?.partitionObjects?.length ? { object_name: { in: opts.partitionObjects } } : {}),
    },
    select: { id: true, full_path: true, catalog_name: true, schema_name: true, last_t1_at: true, last_t2_at: true },
  });

  const excludeSet = new Set((opts?.excludeSchemas ?? []).map(s => s.toLowerCase()));
  const candidates = (() => {
    let objs = allCandidates;
    if (!opts?.partitionSchema && excludeSet.size > 0) {
      objs = objs.filter(o => {
        const qualifiedKey = `${o.catalog_name}.${o.schema_name}`;
        return !excludeSet.has(qualifiedKey)
          && !(o.schema_name != null && excludeSet.has(o.schema_name));
      });
    }
    if (!opts?.partitionCatalog && opts?.includePatterns?.length) {
      objs = objs.filter(o => matchesPatterns(o.full_path, opts.includePatterns!));
    }
    return objs;
  })();

  if (opts?.includePatterns?.length) {
    console.log(`[t2_semantic] scoped to ${opts.includePatterns.join(', ')} — ${candidates.length} candidates`);
  } else if (opts?.excludeSchemas?.length) {
    console.log(`[t2_semantic] excluding schemas: ${opts.excludeSchemas.join(', ')} — ${candidates.length} candidates`);
  }

  const toEnrich = candidates.filter((o) => {
    if (!o.last_t1_at) return false;
    if (!o.last_t2_at) return true;
    return o.last_t2_at < o.last_t1_at;
  });

  let objectsEnriched = 0;
  let objectsSkipped = 0;
  let columnsEnriched = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  const errors: string[] = [];

  for (const obj of toEnrich) {
    try {
      const stats = await enrichObject(obj.id, orgId);
      objectsEnriched++;
      columnsEnriched += stats.columnsEnriched;
      inputTokens += stats.inputTokens;
      outputTokens += stats.outputTokens;
      costUsd += stats.costUsd;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[t2_semantic] ERROR on ${obj.full_path}: ${msg}`);
      errors.push(`${obj.full_path}: ${msg}`);
      objectsSkipped++;
    }
  }

  const status =
    errors.length === 0 ? 'succeeded' : objectsEnriched > 0 ? 'partial' : 'failed';

  await finalize(
    jobId,
    status,
    {
      objects_enriched: objectsEnriched,
      objects_skipped: objectsSkipped,
      columns_enriched: columnsEnriched,
      tokens_used: inputTokens + outputTokens,
      cost_usd: costUsd,
      prompt_version: PROMPT_VERSION,
      model_id: MODEL_ID,
    },
    errors.length > 0 ? errors.join('\n') : undefined,
  );

  return {
    jobId,
    objectsEnriched,
    objectsSkipped,
    columnsEnriched,
    inputTokens,
    outputTokens,
    costUsd,
    status,
    ...(errors.length > 0 ? { error: errors.join('\n') } : {}),
  };
}

// ── PII retro-scrub (public) ───────────────────────────────────────────────────

export interface ScrubResult {
  columnsScrubbed: number;
}

/**
 * One-time retro-scrub: remove the top_k key from platform_context_columns.profile
 * for every column where semantic->>'pii_flag' = 'true'.
 *
 * Idempotent — columns already missing top_k are unaffected.
 * Keeps null_rate, distinct_est, min, max, patterns, sampled_at (DESIGN.md §5.3, CH5 D-05).
 * Scoped to orgId so it is safe to run against a multi-tenant Aurora instance.
 */
export async function scrubPiiTopK(orgId: string): Promise<ScrubResult> {
  const columnsScrubbed = await prisma.$executeRaw`
    UPDATE platform_context_columns
    SET    profile    = profile - 'top_k',
           updated_at = now()
    WHERE  org_id = ${orgId}
      AND  (semantic->>'pii_flag')::boolean = true
      AND  profile IS NOT NULL
      AND  profile ? 'top_k'
  `;
  return { columnsScrubbed };
}
