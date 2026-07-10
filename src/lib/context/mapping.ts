// INVARIANT: no warehouse access in this file.
// All reads come exclusively from platform_context_* tables via Prisma.
// executeDatabricksSQL must never be called here, directly or transitively.

import 'server-only';
import { z } from 'zod';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import prisma from '@/lib/db';
import { finalize } from './queue';

// ── Weights & defaults (exported for config overrides) ────────────────────────

export const DEFAULT_WEIGHTS = {
  embed_sim: 0.45,
  name_sim: 0.25,
  type_compat: 0.15,
  profile_compat: 0.15,
} as const;

const DEFAULT_THRESHOLD = 0.55;
const DEFAULT_TOP_K_PER_LEFT = 5;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MappingWeights {
  embed_sim: number;
  name_sim: number;
  type_compat: number;
  profile_compat: number;
}

export interface MappingConfig {
  weights?: Partial<MappingWeights>;
  candidateThreshold?: number;
  topKPerLeft?: number;
}

export interface SignalSet {
  embed_sim: number | null;
  name_sim: number;
  type_compat: number;
  profile_compat: number;
  /** null = no evidence (both lack top_k or either is PII-suppressed) */
  value_overlap_jaccard: number | null;
}

export interface CandidatePair {
  leftColId: string;
  rightColId: string;
  leftPath: string;
  rightPath: string;
  signals: SignalSet;
  blendedScore: number;
  tier: 'high' | 'medium' | 'low';
}

// ── Confidence tier (exported for persistence layer) ──────────────────────────

export function confidenceTier(score: number): 'high' | 'medium' | 'low' {
  if (score >= 0.80) return 'high';
  if (score >= 0.60) return 'medium';
  return 'low';
}

// ── Canonical ordering (DESIGN.md §4.7: left_id < right_id) ──────────────────

export function canonicalOrder(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

// ── Name normalisation ────────────────────────────────────────────────────────

// Whole-word abbreviation expansions (maritime domain + common, D-03)
const ABBREV_MAP: Record<string, string> = {
  id: 'identifier',
  no: 'number',
  dt: 'date',
  amt: 'amount',
  qty: 'quantity',
  sf: 'seafarer',
  imo: 'imo number',
  cba: 'collective bargaining agreement',
  grt: 'gross register tonnage',
  dwt: 'deadweight tonnage',
  cdc: 'cdc number',
  pod: 'pool of deployment',
};

function normaliseName(raw: string): string {
  // Strip ETL prefix patterns
  let s = raw.replace(/^(tbl_|fct_|dim_|stg_|raw_|src_)/i, '');
  // camelCase → words (handles UPPERCASE by treating runs of uppercase letters)
  s = s.replace(/([a-z])([A-Z])/g, '$1 $2');
  s = s.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  // Normalise separators
  s = s.replace(/[_\-]/g, ' ').toLowerCase().trim();
  // Expand whole-word abbreviations
  s = s
    .split(' ')
    .map((w) => ABBREV_MAP[w] ?? w)
    .join(' ');
  return s;
}

function nameSim(a: string, b: string): number {
  const na = normaliseName(a);
  const nb = normaliseName(b);
  if (na === nb) return 1.0;

  function bigrams(s: string): Set<string> {
    const bg = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) bg.add(s.slice(i, i + 2));
    return bg;
  }

  const ba = bigrams(na);
  const bb = bigrams(nb);
  if (ba.size === 0 && bb.size === 0) return 0;
  const inter = [...ba].filter((g) => bb.has(g)).length;
  const union = new Set([...ba, ...bb]).size;
  return union === 0 ? 0 : inter / union;
}

// ── Type compatibility ────────────────────────────────────────────────────────

const NUMERIC_TYPES = new Set([
  'int', 'integer', 'long', 'bigint', 'smallint',
  'double', 'float', 'numeric', 'decimal', 'real',
]);
const TEMPORAL_TYPES = new Set([
  'timestamp', 'date', 'datetime', 'timestamptz', 'timestamp with time zone',
]);
const STRING_TYPES = new Set([
  'string', 'text', 'varchar', 'char', 'character varying', 'nvarchar',
]);

function typeCompat(ta: string | null, tb: string | null): number {
  if (!ta || !tb) return 0.5;
  const a = ta.toLowerCase().split('(')[0].trim();
  const b = tb.toLowerCase().split('(')[0].trim();
  if (a === b) return 1.0;
  if (NUMERIC_TYPES.has(a) && NUMERIC_TYPES.has(b)) return 0.8;
  if (TEMPORAL_TYPES.has(a) && TEMPORAL_TYPES.has(b)) return 0.8;
  if (STRING_TYPES.has(a) && STRING_TYPES.has(b)) return 0.8;
  // Incompatible families → 0
  const numA = NUMERIC_TYPES.has(a);
  const numB = NUMERIC_TYPES.has(b);
  const strA = STRING_TYPES.has(a);
  const strB = STRING_TYPES.has(b);
  if ((numA && strB) || (strA && numB)) return 0.0;
  return 0.5; // unknown / castable
}

// ── Profile compatibility (D-07) ─────────────────────────────────────────────

type ProfileData = Record<string, unknown>;
type TopKEntry = { value: unknown; count: number };

function profileCompat(profA: ProfileData | null, profB: ProfileData | null): number {
  if (!profA || !profB) return 0.5;

  // 1. Cardinality ratio
  const da = Number(profA.distinct_est ?? 0);
  const db = Number(profB.distinct_est ?? 0);
  const cardRatio = da === 0 || db === 0 ? 0.5 : Math.min(da, db) / Math.max(da, db);

  // 2. Null rate proximity (penalise large difference; >0.5 delta → 0)
  const na = typeof profA.null_rate === 'number' ? profA.null_rate : 0;
  const nb = typeof profB.null_rate === 'number' ? profB.null_rate : 0;
  const nullProx = Math.max(0, 1 - Math.abs(na - nb) * 2);

  // 3. Pattern match — Jaccard of top_k values when available
  let patternMatch = 0.5;
  const topkA = Array.isArray(profA.top_k) ? (profA.top_k as TopKEntry[]) : null;
  const topkB = Array.isArray(profB.top_k) ? (profB.top_k as TopKEntry[]) : null;
  if (topkA && topkA.length > 0 && topkB && topkB.length > 0) {
    const sa = new Set(topkA.map((e) => String(e.value)));
    const sb = new Set(topkB.map((e) => String(e.value)));
    const inter = [...sa].filter((v) => sb.has(v)).length;
    const union = new Set([...sa, ...sb]).size;
    patternMatch = union === 0 ? 0.5 : inter / union;
  }

  return cardRatio * 0.5 + nullProx * 0.3 + patternMatch * 0.2;
}

// ── Stage 2 — value overlap Jaccard ──────────────────────────────────────────

function jaccardTopK(
  topkA: TopKEntry[] | null,
  topkB: TopKEntry[] | null,
): number | null {
  if (!topkA || !topkB || topkA.length === 0 || topkB.length === 0) return null;
  const sa = new Set(topkA.map((e) => String(e.value)));
  const sb = new Set(topkB.map((e) => String(e.value)));
  const inter = [...sa].filter((v) => sb.has(v)).length;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? null : inter / union;
}

// ── Vector utilities ──────────────────────────────────────────────────────────

function parseVec(s: string | null | undefined): number[] | null {
  if (!s) return null;
  return s
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(',')
    .map(Number);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// ── Scope resolver ────────────────────────────────────────────────────────────

export async function resolveObjectsForGlob(
  orgId: string,
  sourceId: string,
  pathGlob: string,
): Promise<string[]> {
  const cleanGlob = pathGlob.trim();
  let objects: Array<{ id: string }>;
  if (cleanGlob === '*' || cleanGlob === '') {
    objects = await prisma.platformContextObject.findMany({
      where: { org_id: orgId, source_id: sourceId, lifecycle: 'active' },
      select: { id: true },
    });
  } else if (!cleanGlob.includes('*')) {
    objects = await prisma.platformContextObject.findMany({
      where: { org_id: orgId, source_id: sourceId, lifecycle: 'active', full_path: cleanGlob },
      select: { id: true },
    });
  } else {
    const prefix = cleanGlob.split('*')[0];
    objects = await prisma.platformContextObject.findMany({
      where: { org_id: orgId, source_id: sourceId, lifecycle: 'active', full_path: { startsWith: prefix } },
      select: { id: true },
    });
  }
  return objects.map((o) => o.id);
}

async function resolveObjectsInScope(
  orgId: string,
  scope: string,
): Promise<Array<{ id: string; full_path: string }>> {
  if (scope.startsWith('ids:')) {
    const ids = scope.slice(4).split(',').filter(Boolean);
    if (ids.length === 0) return [];
    return prisma.platformContextObject.findMany({
      where: { org_id: orgId, lifecycle: 'active', id: { in: ids } },
      select: { id: true, full_path: true },
    });
  }
  if (!scope.includes('*')) {
    return prisma.platformContextObject.findMany({
      where: { org_id: orgId, lifecycle: 'active', full_path: scope },
      select: { id: true, full_path: true },
    });
  }
  const prefix = scope.split('*')[0];
  return prisma.platformContextObject.findMany({
    where: { org_id: orgId, lifecycle: 'active', full_path: { startsWith: prefix } },
    select: { id: true, full_path: true },
  });
}

// ── generateCandidates (Stages 1+2) ──────────────────────────────────────────

/**
 * Stage 1: compute blended signal scores for all cross-object column pairs
 * within the given scope pair, return top-K per left column above threshold.
 *
 * Stage 2: add value_overlap_jaccard for pairs where both sides have top_k
 * (null = no evidence, not zero, per spec).
 *
 * Canonical ordering enforced: leftColId < rightColId on all returned pairs.
 * Same-object pairs are always skipped.
 */
export async function generateCandidates(
  orgId: string,
  leftScope: string,
  rightScope: string,
  config?: MappingConfig,
): Promise<CandidatePair[]> {
  const W: MappingWeights = { ...DEFAULT_WEIGHTS, ...(config?.weights ?? {}) };
  const threshold = config?.candidateThreshold ?? DEFAULT_THRESHOLD;
  const topKPerLeft = config?.topKPerLeft ?? DEFAULT_TOP_K_PER_LEFT;

  // Resolve objects in scope
  const [leftObjects, rightObjects] = await Promise.all([
    resolveObjectsInScope(orgId, leftScope),
    resolveObjectsInScope(orgId, rightScope),
  ]);

  if (leftObjects.length === 0 || rightObjects.length === 0) return [];

  const leftObjIds = leftObjects.map((o) => o.id);
  const rightObjIds = rightObjects.map((o) => o.id);

  // Load columns (profile + semantic JSONB via Prisma typed API)
  const [leftCols, rightCols] = await Promise.all([
    prisma.platformContextColumn.findMany({
      where: { object_id: { in: leftObjIds }, lifecycle: 'active' },
      select: {
        id: true, name: true, data_type: true, profile: true, semantic: true,
        object: { select: { full_path: true } },
      },
    }),
    prisma.platformContextColumn.findMany({
      where: { object_id: { in: rightObjIds }, lifecycle: 'active' },
      select: {
        id: true, name: true, data_type: true, profile: true, semantic: true,
        object: { select: { full_path: true } },
      },
    }),
  ]);

  if (leftCols.length === 0 || rightCols.length === 0) return [];

  // Load embedding vectors for all columns in scope
  const allColIds = [
    ...leftCols.map((c) => c.id),
    ...rightCols.map((c) => c.id),
  ];

  type EmbedRow = { subject_id: string; embedding: string | null };
  const embedRows = await prisma.$queryRaw<EmbedRow[]>`
    SELECT subject_id::text, embedding::text
    FROM platform_context_embeddings
    WHERE subject_kind = 'column'
      AND org_id = ${orgId}
      AND subject_id = ANY(${allColIds}::uuid[])
  `;
  const vecMap = new Map<string, number[] | null>(
    embedRows.map((e) => [e.subject_id, parseVec(e.embedding)]),
  );

  // Compute all-pairs signal scores
  const pairMap = new Map<string, CandidatePair>();

  for (const lCol of leftCols) {
    const lVec = vecMap.get(lCol.id) ?? null;
    const lProf = (lCol.profile ?? {}) as ProfileData;
    const lSem = (lCol.semantic ?? {}) as Record<string, unknown>;
    const lPii = lSem.pii_flag === true;

    const lTopKVals = !lPii && Array.isArray(lProf.top_k) ? (lProf.top_k as TopKEntry[]) : null;

    const candidates: Array<{ key: string; score: number; pair: CandidatePair }> = [];

    for (const rCol of rightCols) {
      // Skip same-object pairs
      if (lCol.object.full_path === rCol.object.full_path) continue;

      const rVec = vecMap.get(rCol.id) ?? null;
      const rProf = (rCol.profile ?? {}) as ProfileData;
      const rSem = (rCol.semantic ?? {}) as Record<string, unknown>;
      const rPii = rSem.pii_flag === true;

      // Signal computation
      const embedSim = lVec && rVec ? cosine(lVec, rVec) : null;
      const ns = nameSim(lCol.name, rCol.name);
      const tc = typeCompat(lCol.data_type, rCol.data_type);
      const pc = profileCompat(lProf, rProf);

      // Blended score (D-02: redistribute embed weight when embedding unavailable)
      let score: number;
      if (embedSim !== null) {
        score =
          embedSim * W.embed_sim +
          ns * W.name_sim +
          tc * W.type_compat +
          pc * W.profile_compat;
      } else {
        const nonEmbedTotal = W.name_sim + W.type_compat + W.profile_compat;
        score =
          ns * (W.name_sim / nonEmbedTotal) +
          tc * (W.type_compat / nonEmbedTotal) +
          pc * (W.profile_compat / nonEmbedTotal);
      }

      if (score < threshold) continue;

      // Stage 2: value overlap Jaccard — null if either side lacks top_k or is PII (D-04)
      const rTopKVals = !rPii && Array.isArray(rProf.top_k) ? (rProf.top_k as TopKEntry[]) : null;
      const jaccard = jaccardTopK(lTopKVals, rTopKVals);

      // Canonical ordering (D-06)
      const [canonLeft, canonRight] = canonicalOrder(lCol.id, rCol.id);
      const swapped = canonLeft !== lCol.id;

      const pair: CandidatePair = {
        leftColId: canonLeft,
        rightColId: canonRight,
        leftPath: swapped
          ? `${rCol.object.full_path}.${rCol.name}`
          : `${lCol.object.full_path}.${lCol.name}`,
        rightPath: swapped
          ? `${lCol.object.full_path}.${lCol.name}`
          : `${rCol.object.full_path}.${rCol.name}`,
        signals: {
          embed_sim: embedSim,
          name_sim: ns,
          type_compat: tc,
          profile_compat: pc,
          value_overlap_jaccard: jaccard,
        },
        blendedScore: score,
        tier: confidenceTier(score),
      };

      const key = `${canonLeft}:${canonRight}`;
      candidates.push({ key, score, pair });
    }

    // Sort by score descending, take top-K
    candidates.sort((a, b) => b.score - a.score);
    const topCandidates = candidates.slice(0, topKPerLeft);

    // Merge into pairMap, keeping highest score for deduplication
    for (const { key, score, pair } of topCandidates) {
      const existing = pairMap.get(key);
      if (!existing || score > existing.blendedScore) {
        pairMap.set(key, pair);
      }
    }
  }

  return [...pairMap.values()];
}

// ── MappingJobResult ──────────────────────────────────────────────────────────

export interface MappingJobResult {
  jobId: string;
  candidatesGenerated: number;
  byTier: { high: number; medium: number; low: number };
  pairsAdjudicated: number;
  llmTokens: { input: number; output: number; cost_usd: number };
  proposalsByKind: Record<string, number>;
  notMappedCount: number;
  status: 'succeeded' | 'failed' | 'partial';
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION C — Stage 3: LLM adjudication, Stage 4: persistence, entity tagging
// ═══════════════════════════════════════════════════════════════════════════════

const ADJUDICATE_MODEL = 'us.anthropic.claude-sonnet-4-6';
const BATCH_SIZE = 10;
const PRICE_INPUT_PER_M = 3;   // Sonnet: $3/$15 per 1M in/out tokens
const PRICE_OUTPUT_PER_M = 15;

// ── Zod schemas (adjudicate_mapping_v1) ──────────────────────────────────────

const PairVerdictSchema = z.object({
  pair_index: z.number().int().nonnegative(),
  verdict: z.enum(['mapped', 'not_mapped', 'uncertain']),
  mapping_kind: z.enum([
    'same_attribute', 'same_entity_key', 'derivable', 'partial_overlap', 'code_lookup',
  ]).nullable(),
  rationale: z.string(),
  caveats: z.string(),
  transform_hint: z.string(),
  confidence: z.number().min(0).max(1),
});
const AdjudicationBatchSchema = z.array(PairVerdictSchema);
type PairVerdict = z.infer<typeof PairVerdictSchema>;

// ── System prompt (adjudicate_mapping_v1) ─────────────────────────────────────

const ADJUDICATION_SYSTEM = `You are a data catalog mapping engine for a maritime crew-management platform.
Your job is to adjudicate candidate column mappings across database tables and decide whether two columns represent the same or a related real-world concept.

Return a single valid JSON array — one element per input pair, in the same order as the input.
No markdown fences. No preamble. No trailing explanation.
The first character of your response must be [ and the last must be ].

Each array element has EXACTLY this structure:
{ "pair_index": <int>, "verdict": "mapped"|"not_mapped"|"uncertain", "mapping_kind": "same_attribute"|"same_entity_key"|"derivable"|"partial_overlap"|"code_lookup"|null, "rationale": "<one sentence>", "caveats": "<one sentence or empty string>", "transform_hint": "<practical guidance or empty string>", "confidence": <0.0-1.0> }

verdict meanings:
- mapped: columns represent the same or closely related real-world concept. Two corroborating signals required (Rule 2).
- not_mapped: columns are unrelated or similarity is coincidental.
- uncertain: insufficient evidence. Leave for human review. This is a correct outcome — do not force mapped.

mapping_kind (required for mapped or uncertain; null for not_mapped):
- same_attribute: both store the same fact about the same entity
- same_entity_key: both identify the same real-world entity (join keys)
- derivable: one can be computed from the other
- partial_overlap: related concept but different grain, population, or time range
- code_lookup: one is a short code, the other is its description

MANDATORY RULES:

Rule 1: Return ONLY the JSON array. First character [. No markdown fences. No commentary after the closing ].

Rule 2: Two-corroborating-signals requirement for mapped.
Never return verdict "mapped" unless at least two of the following hold independently:
- embed_sim >= 0.70
- name_sim >= 0.75 (columns named nearly identically after normalisation)
- type_compat = 1.00 combined with at least one other signal >= 0.65
- value_overlap_jaccard >= 0.30 (meaningful shared values)
- Description + role independently confirm the same concept
When only one signal is strong, return uncertain — not mapped.

Rule 3: uncertain is always valid. Set mapping_kind to the most plausible kind even for uncertain verdicts.

Rule 4: PII columns — pii_suppressed: true means top_k is absent. Adjudicate on description, role, entity, and signals only. Lower confidence by ~0.10 relative to equivalent non-PII pair.

Rule 5: mapping_kind precision:
- same_entity_key: join keys identifying same real-world entity; not descriptive columns that happen to share a name
- derivable: only when explicit computational relationship exists (one is a strict function of the other)
- partial_overlap: related but genuinely different populations, time horizons, or data states
- code_lookup: only when one side is clearly a short code (distinct cardinality <= 20 with short values)

Rule 6: Return exactly pair_count elements. Do not skip any pair. If you cannot evaluate a pair, return uncertain with confidence 0.3.

Rule 7: Domain context:
- seafarer (also: crew): person employed to work on a vessel
- vessel: the ship; uniquely identified by IMO number (International Maritime Organization)
- contract / agreement: employment contract; contracts_raw_info = latest row per contract; contracts_raw_info_full = all historical rows (addenda, amendments included)
- sea_experience: one row per voyage leg a seafarer completed
- CBA: Collective Bargaining Agreement code
- CDC: Continuous Discharge Certificate (seafarer identity document)
- Fivetran columns (_fivetran_deleted, _fivetran_synced): pipeline ingest metadata, not business attributes
- signed/approved/void: common contract lifecycle statuses`;

// ── Bedrock client ────────────────────────────────────────────────────────────

function getBedrockClient(): BedrockRuntimeClient {
  return new BedrockRuntimeClient({
    region: process.env.BEDROCK_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
}

// ── Column card type for adjudication payload ─────────────────────────────────

interface ColCardForLlm {
  path: string;
  data_type: string;
  description: string;
  role: string;
  entity: string;
  null_rate: number | null;
  top_k?: { value: unknown; count: number }[];
  pii_suppressed?: true;
}

type ColRow = {
  id: string;
  name: string;
  data_type: string | null;
  profile: unknown;
  semantic: unknown;
  object: { full_path: string };
};

function buildColCard(row: ColRow): ColCardForLlm {
  const sem = (row.semantic ?? {}) as Record<string, unknown>;
  const prof = (row.profile ?? {}) as Record<string, unknown>;
  const isPii = sem.pii_flag === true;

  const card: ColCardForLlm = {
    path: `${row.object.full_path}.${row.name}`,
    data_type: row.data_type ?? 'unknown',
    description: typeof sem.description === 'string' ? sem.description : row.name,
    role: typeof sem.role === 'string' ? sem.role : 'unknown',
    entity: typeof sem.entity === 'string' ? sem.entity : '',
    null_rate: typeof prof.null_rate === 'number' ? prof.null_rate : null,
  };

  if (isPii) {
    card.pii_suppressed = true;
  } else if (Array.isArray(prof.top_k) && (prof.top_k as TopKEntry[]).length > 0) {
    card.top_k = (prof.top_k as TopKEntry[]).slice(0, 5);
  }

  return card;
}

// ── JSON parse + Zod validate (array-first) ───────────────────────────────────

function tryParseAndValidate(text: string): PairVerdict[] | null {
  let s = text.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
  }
  try {
    const parsed = JSON.parse(s);
    const result = AdjudicationBatchSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

// ── Invoke Bedrock for one batch of pairs ─────────────────────────────────────

async function callOneBatch(
  batchPairs: CandidatePair[],
  cardMap: Map<string, ColCardForLlm>,
): Promise<{ verdicts: PairVerdict[]; inputTokens: number; outputTokens: number }> {
  const pairsJson = JSON.stringify(
    batchPairs.map((pair, localIdx) => ({
      pair_index: localIdx,
      left: cardMap.get(pair.leftColId),
      right: cardMap.get(pair.rightColId),
      signals: {
        embed_sim: pair.signals.embed_sim,
        name_sim: pair.signals.name_sim,
        type_compat: pair.signals.type_compat,
        profile_compat: pair.signals.profile_compat,
        value_overlap_jaccard: pair.signals.value_overlap_jaccard,
        blended_score: pair.blendedScore,
        tier: pair.tier,
      },
    })),
    null,
    2,
  );

  const userMessage =
    `Adjudicate the following column mapping candidates and return a JSON array of verdicts.\n\n` +
    `## Context\n\nPlatform: maritime crew management (Synergy Group). All tables are in the same Databricks data estate.\n` +
    `Candidate pairs were generated by the ALOFT Mendeleev context harness Stage 1 signal engine.\n\n` +
    `## Pairs (${batchPairs.length} total)\n\n${pairsJson}\n\n` +
    `## Output\n\nReturn a JSON array of exactly ${batchPairs.length} elements, one per pair in the same order.\n` +
    `Each element: { pair_index, verdict, mapping_kind, rationale, caveats, transform_hint, confidence }\n` +
    `First character must be [. No markdown. No preamble.`;

  type Msg = { role: 'user' | 'assistant'; content: { type: 'text'; text: string }[] };
  const messages: Msg[] = [{ role: 'user', content: [{ type: 'text', text: userMessage }] }];

  const client = getBedrockClient();

  async function invoke(msgs: Msg[]): Promise<{ text: string; input: number; output: number }> {
    const cmd = new ConverseCommand({
      modelId: ADJUDICATE_MODEL,
      system: [{ text: ADJUDICATION_SYSTEM }],
      messages: msgs,
      inferenceConfig: { temperature: 0.2, maxTokens: 8192 },
    });
    const resp = await client.send(cmd);
    const text =
      resp.output?.message?.content
        ?.map((b) => ('text' in b ? (b as { text: string }).text : ''))
        .join('') ?? '';
    return {
      text,
      input: resp.usage?.inputTokens ?? 0,
      output: resp.usage?.outputTokens ?? 0,
    };
  }

  let { text, input, output } = await invoke(messages);
  let parsed = tryParseAndValidate(text);

  if (!parsed) {
    // Retry once — array-first correction (NOT "starting with {" — D-10)
    const retryMsgs: Msg[] = [
      ...messages,
      { role: 'assistant', content: [{ type: 'text', text }] },
      {
        role: 'user',
        content: [{ type: 'text', text: 'Your previous response was not valid JSON array. Return ONLY the array starting with [. No other text.' }],
      },
    ];
    const retry = await invoke(retryMsgs);
    input += retry.input;
    output += retry.output;
    parsed = tryParseAndValidate(retry.text);
  }

  if (!parsed) {
    // Both attempts failed — mark all pairs as uncertain/confidence 0; NOT persisted (D-10)
    const failed: PairVerdict[] = batchPairs.map((_, idx) => ({
      pair_index: idx,
      verdict: 'uncertain',
      mapping_kind: null,
      rationale: 'LLM adjudication failed after retry',
      caveats: '',
      transform_hint: '',
      confidence: 0,
    }));
    return { verdicts: failed, inputTokens: input, outputTokens: output };
  }

  return { verdicts: parsed, inputTokens: input, outputTokens: output };
}

// ── adjudicateCandidates — batched Stage 3 orchestration ─────────────────────

async function adjudicateCandidates(
  candidates: CandidatePair[],
  orgId: string,
): Promise<{
  verdictMap: Map<string, PairVerdict>;
  inputTokens: number;
  outputTokens: number;
}> {
  // Batch-fetch all column metadata for building LLM cards
  const allColIds = [...new Set(candidates.flatMap((c) => [c.leftColId, c.rightColId]))];
  const colRows = await prisma.platformContextColumn.findMany({
    where: { id: { in: allColIds } },
    select: {
      id: true,
      name: true,
      data_type: true,
      profile: true,
      semantic: true,
      object: { select: { full_path: true } },
    },
  });

  const cardMap = new Map<string, ColCardForLlm>(
    colRows.map((row) => [row.id, buildColCard(row as ColRow)]),
  );

  // Split into batches of BATCH_SIZE
  const batches: CandidatePair[][] = [];
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    batches.push(candidates.slice(i, i + BATCH_SIZE));
  }

  const verdictMap = new Map<string, PairVerdict>();
  let totalInput = 0;
  let totalOutput = 0;

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    const { verdicts, inputTokens, outputTokens } = await callOneBatch(batch, cardMap);
    totalInput += inputTokens;
    totalOutput += outputTokens;

    // Map local pair_index back to global candidate key
    for (const v of verdicts) {
      const candidate = batch[v.pair_index];
      if (!candidate) continue;
      const key = `${candidate.leftColId}:${candidate.rightColId}`;
      verdictMap.set(key, v);
    }
  }

  return { verdictMap, inputTokens: totalInput, outputTokens: totalOutput };
}

// ── persistProposals — Stage 4 ────────────────────────────────────────────────

async function persistProposals(
  candidates: CandidatePair[],
  verdictMap: Map<string, PairVerdict>,
  orgId: string,
): Promise<{ proposalsByKind: Record<string, number>; notMappedCount: number }> {
  const proposalsByKind: Record<string, number> = {};
  let notMappedCount = 0;

  for (const pair of candidates) {
    const key = `${pair.leftColId}:${pair.rightColId}`;
    const verdict = verdictMap.get(key);
    if (!verdict) continue;

    // not_mapped → count only, no persistence (D-11)
    if (verdict.verdict === 'not_mapped') {
      notMappedCount++;
      continue;
    }

    // uncertain with confidence 0 → adjudication failed, not persisted (D-10)
    if (verdict.verdict === 'uncertain' && verdict.confidence === 0) {
      continue;
    }

    // Cap uncertain confidence at 0.5 (invariant 7)
    const cappedConf =
      verdict.verdict === 'uncertain'
        ? Math.min(verdict.confidence, 0.5)
        : verdict.confidence;

    const llmVerdict = {
      verdict: verdict.verdict,
      rationale: verdict.rationale,
      caveats: verdict.caveats,
      transform_hint: verdict.transform_hint,
      confidence: verdict.confidence,
    };

    const signalsJson = JSON.stringify(pair.signals);
    const llmVerdictJson = JSON.stringify(llmVerdict);
    const mappingKind = verdict.mapping_kind;

    await prisma.$executeRaw`
      INSERT INTO platform_context_mappings
        (id, org_id, left_column_id, right_column_id, mapping_kind, signals, llm_verdict, confidence, status)
      VALUES (
        gen_random_uuid(),
        ${orgId},
        ${pair.leftColId}::uuid,
        ${pair.rightColId}::uuid,
        ${mappingKind},
        ${signalsJson}::jsonb,
        ${llmVerdictJson}::jsonb,
        ${cappedConf}::real,
        'proposed'
      )
      ON CONFLICT (left_column_id, right_column_id)
      DO UPDATE SET
        mapping_kind  = EXCLUDED.mapping_kind,
        signals       = EXCLUDED.signals,
        llm_verdict   = EXCLUDED.llm_verdict,
        confidence    = EXCLUDED.confidence,
        status        = EXCLUDED.status
    `;

    const kind = verdict.mapping_kind ?? 'unknown';
    proposalsByKind[kind] = (proposalsByKind[kind] ?? 0) + 1;
  }

  return { proposalsByKind, notMappedCount };
}

// ── computeEntityTags — object-level connected components ─────────────────────

/**
 * Builds an object-level graph from proposed column mappings, finds connected
 * components, and writes entity_tags JSONB to each member object.
 *
 * Edge inclusion rules (DESIGN.md §8):
 * - >= 2 proposed mappings of kind same_entity_key or same_attribute between a pair, OR
 * - >= 1 high-confidence (>= 0.80) same_entity_key mapping between a pair
 *
 * Always basis: 'proposed' (D-09).
 */
export async function computeEntityTags(orgId: string): Promise<void> {
  type MappingRow = {
    id: string;
    mapping_kind: string | null;
    confidence: number | null;
    left_object_id: string;
    left_object_path: string;
    right_object_id: string;
    right_object_path: string;
  };

  const rows = await prisma.$queryRaw<MappingRow[]>`
    SELECT
      m.id,
      m.mapping_kind,
      m.confidence::float AS confidence,
      lc.object_id::text AS left_object_id,
      lo.full_path        AS left_object_path,
      rc.object_id::text  AS right_object_id,
      ro.full_path        AS right_object_path
    FROM platform_context_mappings m
    JOIN platform_context_columns  lc ON lc.id = m.left_column_id
    JOIN platform_context_objects  lo ON lo.id = lc.object_id
    JOIN platform_context_columns  rc ON rc.id = m.right_column_id
    JOIN platform_context_objects  ro ON ro.id = rc.object_id
    WHERE m.org_id       = ${orgId}
      AND m.status       = 'proposed'
      AND m.mapping_kind IN ('same_entity_key', 'same_attribute')
  `;

  // Build edge counts per object-pair (canonical ordering)
  type EdgeData = { count: number; hasHighConfSEK: boolean };
  const edges = new Map<string, EdgeData>();
  const objPathMap = new Map<string, string>();

  for (const row of rows) {
    if (row.left_object_id === row.right_object_id) continue;

    objPathMap.set(row.left_object_id, row.left_object_path);
    objPathMap.set(row.right_object_id, row.right_object_path);

    const [aId, bId] =
      row.left_object_id < row.right_object_id
        ? [row.left_object_id, row.right_object_id]
        : [row.right_object_id, row.left_object_id];
    const edgeKey = `${aId}:${bId}`;
    const existing = edges.get(edgeKey) ?? { count: 0, hasHighConfSEK: false };
    existing.count++;
    if (row.mapping_kind === 'same_entity_key' && (row.confidence ?? 0) >= 0.8) {
      existing.hasHighConfSEK = true;
    }
    edges.set(edgeKey, existing);
  }

  // Apply edge inclusion rules
  const includedEdges: Array<[string, string]> = [];
  for (const [edgeKey, data] of edges) {
    if (data.count >= 2 || data.hasHighConfSEK) {
      const [a, b] = edgeKey.split(':');
      includedEdges.push([a, b]);
    }
  }

  if (includedEdges.length === 0) return;

  // Build adjacency list and find connected components via BFS
  const adjList = new Map<string, Set<string>>();
  for (const [a, b] of includedEdges) {
    if (!adjList.has(a)) adjList.set(a, new Set());
    if (!adjList.has(b)) adjList.set(b, new Set());
    adjList.get(a)!.add(b);
    adjList.get(b)!.add(a);
  }

  const visited = new Set<string>();
  const components: string[][] = [];

  for (const objId of adjList.keys()) {
    if (visited.has(objId)) continue;
    const component: string[] = [];
    const queue = [objId];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (visited.has(curr)) continue;
      visited.add(curr);
      component.push(curr);
      for (const neighbor of adjList.get(curr) ?? []) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }
    if (component.length > 1) components.push(component);
  }

  const now = new Date().toISOString();

  for (const component of components) {
    const memberPaths = component.map((id) => objPathMap.get(id) ?? id).sort();

    // Derive group label from the most common entity field in semantic cards
    const semanticRows = await prisma.platformContextSemantic.findMany({
      where: { subject_kind: 'object', subject_id: { in: component } },
      orderBy: { version: 'desc' },
      select: { subject_id: true, card: true },
    });

    const entityByObjId = new Map<string, string>();
    for (const s of semanticRows) {
      if (!entityByObjId.has(s.subject_id)) {
        const c = s.card as Record<string, unknown>;
        if (typeof c.entity === 'string' && c.entity) {
          entityByObjId.set(s.subject_id, c.entity);
        }
      }
    }

    const entityCounts = new Map<string, number>();
    for (const entity of entityByObjId.values()) {
      entityCounts.set(entity, (entityCounts.get(entity) ?? 0) + 1);
    }

    let label = 'unknown';
    let maxCount = 0;
    for (const [entity, count] of entityCounts) {
      if (count > maxCount) {
        maxCount = count;
        label = entity;
      }
    }
    if (label === 'unknown' && component.length > 0) {
      label = (objPathMap.get(component[0]) ?? '').split('.').pop() ?? 'unknown';
    }

    // Count total via_mappings edges within this component
    const componentSet = new Set(component);
    let viaMappings = 0;
    for (const [edgeKey, data] of edges) {
      const [a, b] = edgeKey.split(':');
      if (componentSet.has(a) && componentSet.has(b)) {
        viaMappings += data.count;
      }
    }

    const entityTagEntry = {
      label,
      member_paths: memberPaths,
      via_mappings: viaMappings,
      computed_at: now,
      basis: 'proposed',
    };

    for (const objId of component) {
      await prisma.platformContextObject.update({
        where: { id: objId },
        data: { entity_tags: { groups: [entityTagEntry] } },
      });
    }
  }
}

// ── runMappingJob — full pipeline orchestrator ────────────────────────────────

/**
 * Full mapping pipeline: Stage 1+2 (signals) → Stage 3 (LLM adjudication) →
 * Stage 4 (persistence) → entity tagging.
 *
 * Called by the job queue worker for job_kind='mapping'.
 * scope: { leftScope, rightScope, config? }
 * Nothing sets status='confirmed' here — proposals only (CH7 invariant).
 */
export async function runMappingJob(
  jobId: string,
  orgId: string,
  scope: {
    leftScope?: string;
    rightScope?: string;
    left?: { sourceId: string; pathGlob: string };
    right?: { sourceId: string; pathGlob: string };
    includeRejected?: boolean;
    config?: MappingConfig;
  },
): Promise<MappingJobResult> {
  const tStart = Date.now();
  await prisma.platformContextJob.update({
    where: { id: jobId },
    data: {
      status: 'running',
      started_at: new Date(),
      stats: { stage: 'candidate_generation', stage_start: new Date().toISOString() }
    },
  });

  try {
    // 1. Resolve glob → object IDs in the scoping layer
    let leftObjIds: string[] = [];
    let rightObjIds: string[] = [];
    let includeRejected = scope.includeRejected === true;

    if (scope.left && scope.right) {
      leftObjIds = await resolveObjectsForGlob(orgId, scope.left.sourceId, scope.left.pathGlob);
      rightObjIds = await resolveObjectsForGlob(orgId, scope.right.sourceId, scope.right.pathGlob);
    } else if (scope.leftScope && scope.rightScope) {
      // Fallback/backward compatibility for old payload strings
      const [leftObjs, rightObjs] = await Promise.all([
        resolveObjectsInScope(orgId, scope.leftScope),
        resolveObjectsInScope(orgId, scope.rightScope),
      ]);
      leftObjIds = leftObjs.map((o) => o.id);
      rightObjIds = rightObjs.map((o) => o.id);
    }

    const byTier = { high: 0, medium: 0, low: 0 };

    if (leftObjIds.length === 0 || rightObjIds.length === 0) {
      const result: MappingJobResult = {
        jobId,
        candidatesGenerated: 0,
        byTier,
        pairsAdjudicated: 0,
        llmTokens: { input: 0, output: 0, cost_usd: 0 },
        proposalsByKind: {},
        notMappedCount: 0,
        status: 'succeeded',
      };
      await finalize(jobId, 'succeeded', {
        candidates_generated: 0,
        by_tier: byTier,
        candidate_generation_duration_ms: Date.now() - tStart,
      });
      return result;
    }

    // 2. Call candidate generation (Stage 1) using synthetic ids: scope
    // keeping Stage 1 internals completely untouched.
    let candidates = await generateCandidates(
      orgId,
      `ids:${leftObjIds.join(',')}`,
      `ids:${rightObjIds.join(',')}`,
      scope.config,
    );

    const tCandidates = Date.now();
    const candidateDuration = tCandidates - tStart;

    // 3. Exclude same-object pairs (left_object_id === right_object_id) at scope layer
    if (candidates.length > 0) {
      const allColIds = Array.from(new Set([
        ...candidates.map((c) => c.leftColId),
        ...candidates.map((c) => c.rightColId),
      ]));
      const cols = await prisma.platformContextColumn.findMany({
        where: { id: { in: allColIds } },
        select: { id: true, object_id: true },
      });
      const colToObjMap = new Map(cols.map((c) => [c.id, c.object_id]));
      candidates = candidates.filter((c) => {
        const leftObjId = colToObjMap.get(c.leftColId);
        const rightObjId = colToObjMap.get(c.rightColId);
        return leftObjId !== rightObjId;
      });
    }

    // 4. Filter out rejected mappings if includeRejected is false
    if (!includeRejected && candidates.length > 0) {
      const allColIds = Array.from(new Set([
        ...candidates.map((c) => c.leftColId),
        ...candidates.map((c) => c.rightColId),
      ]));
      const rejected = await prisma.platformContextMapping.findMany({
        where: {
          org_id: orgId,
          status: 'rejected',
          OR: [
            { left_column_id: { in: allColIds } },
            { right_column_id: { in: allColIds } },
          ],
        },
        select: { left_column_id: true, right_column_id: true },
      });
      const rejectedPairs = new Set(
        rejected.map((r) => `${r.left_column_id}:${r.right_column_id}`),
      );
      candidates = candidates.filter((c) => {
        const key = `${c.leftColId}:${c.rightColId}`;
        return !rejectedPairs.has(key);
      });
    }

    for (const c of candidates) byTier[c.tier]++;

    if (candidates.length === 0) {
      const result: MappingJobResult = {
        jobId,
        candidatesGenerated: 0,
        byTier,
        pairsAdjudicated: 0,
        llmTokens: { input: 0, output: 0, cost_usd: 0 },
        proposalsByKind: {},
        notMappedCount: 0,
        status: 'succeeded',
      };
      await finalize(jobId, 'succeeded', {
        candidates_generated: 0,
        by_tier: byTier,
        candidate_generation_duration_ms: candidateDuration,
      });
      return result;
    }

    // Transition to Stage 3: LLM adjudication
    await prisma.platformContextJob.update({
      where: { id: jobId },
      data: {
        stats: {
          stage: 'llm_adjudication',
          stage_start: new Date().toISOString(),
          candidate_generation_duration_ms: candidateDuration,
          candidates_generated: candidates.length,
        },
      },
    });

    const { verdictMap, inputTokens, outputTokens } = await adjudicateCandidates(
      candidates,
      orgId,
    );

    const tLLM = Date.now();
    const llmDuration = tLLM - tCandidates;

    // Transition to Stage 4: persist proposals
    await prisma.platformContextJob.update({
      where: { id: jobId },
      data: {
        stats: {
          stage: 'persist',
          stage_start: new Date().toISOString(),
          candidate_generation_duration_ms: candidateDuration,
          llm_adjudication_duration_ms: llmDuration,
          candidates_generated: candidates.length,
          pairs_adjudicated: verdictMap.size,
        },
      },
    });

    const { proposalsByKind, notMappedCount } = await persistProposals(
      candidates,
      verdictMap,
      orgId,
    );

    const tPersist = Date.now();
    const persistDuration = tPersist - tLLM;

    // Entity tagging (idempotent)
    await computeEntityTags(orgId);

    const costUsd =
      (inputTokens * PRICE_INPUT_PER_M + outputTokens * PRICE_OUTPUT_PER_M) / 1_000_000;

    const result: MappingJobResult = {
      jobId,
      candidatesGenerated: candidates.length,
      byTier,
      pairsAdjudicated: verdictMap.size,
      llmTokens: { input: inputTokens, output: outputTokens, cost_usd: costUsd },
      proposalsByKind,
      notMappedCount,
      status: 'succeeded',
    };

    await finalize(jobId, 'succeeded', {
      candidates_generated: candidates.length,
      by_tier: byTier,
      pairs_adjudicated: verdictMap.size,
      proposals_by_kind: proposalsByKind,
      not_mapped_count: notMappedCount,
      llm_tokens: { input: inputTokens, output: outputTokens },
      cost_usd: costUsd,
      candidate_generation_duration_ms: candidateDuration,
      llm_adjudication_duration_ms: llmDuration,
      persist_duration_ms: persistDuration,
    });

    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finalize(jobId, 'failed', {}, msg);
    return {
      jobId,
      candidatesGenerated: 0,
      byTier: { high: 0, medium: 0, low: 0 },
      pairsAdjudicated: 0,
      llmTokens: { input: 0, output: 0, cost_usd: 0 },
      proposalsByKind: {},
      notMappedCount: 0,
      status: 'failed',
      error: msg,
    };
  }
}
