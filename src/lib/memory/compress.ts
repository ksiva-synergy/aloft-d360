/**
 * AM2.1 — SCHEMA_MAP bullet compressor (optional, feature-flagged).
 *
 * When the Tier 1 set for a given org+class is dominated by verbose SCHEMA_MAP
 * bullets that exceed the Phase 1 budget, this module can compress them into a
 * denser merged block using a Nova Pro (fermi-class) inference call.
 *
 * Compression strategy:
 *   - Group SCHEMA_MAP bullets by database/schema prefix (first two dot-segments).
 *   - For each group, merge column lists and drop redundant type annotations.
 *   - Output format: "Schema <db>.<schema>: table1(col1,col2), table2(col3,col4)"
 *
 * Compression is triggered only when:
 *   1. MEMORY_COMPRESS_ENABLED === 'true'
 *   2. The total token cost of SCHEMA_MAP bullets exceeds COMPRESS_THRESHOLD_TOKENS.
 *
 * Results are cached in-process (keyed by SHA-256 of sorted bullet IDs) to avoid
 * re-running the LLM call on every request. Cache entries expire after
 * COMPRESS_CACHE_TTL_MS to stay fresh as bullets are updated.
 *
 * This module is intentionally NOT called from the hot path in retrieve.ts.
 * To enable, wire it into selectMemory() after phase resolution:
 *
 *   const schemaBullets = result.filter(b => b.ruleType === 'SCHEMA_MAP');
 *   if (shouldCompress(schemaBullets)) {
 *     const compressed = await compressSchemaMaps(schemaBullets);
 *     // Replace SCHEMA_MAP bullets with the compressed version.
 *   }
 */

import crypto from 'crypto';
import type { MemoryBullet } from './retrieve';

// ── Feature flag ──────────────────────────────────────────────────────────────

export function isCompressionEnabled(): boolean {
  return process.env.MEMORY_COMPRESS_ENABLED === 'true';
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Token threshold above which SCHEMA_MAP bullets are compressed.
 * Below this threshold, raw bullets are used as-is (no LLM call needed).
 */
const COMPRESS_THRESHOLD_TOKENS = 300;

/** In-process cache TTL in milliseconds (default: 10 minutes). */
const COMPRESS_CACHE_TTL_MS = 10 * 60 * 1000;

/** Maximum tokens allowed in the compressed SCHEMA_MAP output. */
const COMPRESS_TARGET_TOKENS = 200;

// ── Token estimator (mirrors retrieve.ts) ────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ── In-process result cache ───────────────────────────────────────────────────

interface CacheEntry {
  result:    MemoryBullet;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(bullets: MemoryBullet[]): string {
  const sorted = [...bullets].map((b) => b.id).sort().join(':');
  return crypto.createHash('sha256').update(sorted).digest('hex').slice(0, 16);
}

function getCached(key: string): MemoryBullet | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.result;
}

function setCached(key: string, result: MemoryBullet): void {
  cache.set(key, { result, expiresAt: Date.now() + COMPRESS_CACHE_TTL_MS });
  // Evict stale entries on every write (keep cache bounded).
  const now = Date.now();
  for (const [k, v] of cache.entries()) {
    if (now > v.expiresAt) cache.delete(k);
  }
}

// ── Compression gate ─────────────────────────────────────────────────────────

/**
 * Returns true when the total token cost of the given SCHEMA_MAP bullets
 * exceeds the compression threshold.
 */
export function shouldCompress(schemaBullets: MemoryBullet[]): boolean {
  if (!isCompressionEnabled()) return false;
  const total = schemaBullets.reduce((sum, b) => sum + estimateTokens(b.ruleText), 0);
  return total > COMPRESS_THRESHOLD_TOKENS;
}

// ── Compression logic ─────────────────────────────────────────────────────────

/**
 * Groups SCHEMA_MAP bullets by their database.schema prefix and merges
 * column lists. Returns a single synthetic MemoryBullet with the compressed
 * text, keeping metadata (confidence, helpfulCount, harmfulCount) from the
 * highest-scoring input bullet.
 *
 * When a Nova Pro call is configured (via MEMORY_COMPRESS_MODEL env), this
 * function delegates to an LLM for more intelligent merging. Otherwise it
 * uses the deterministic regex-based merger below.
 *
 * Never throws — on any error it returns the original bullets unchanged.
 */
export async function compressSchemaMaps(
  bullets: MemoryBullet[],
): Promise<MemoryBullet[]> {
  if (bullets.length === 0) return bullets;

  const key = cacheKey(bullets);
  const cached = getCached(key);
  if (cached) return [cached];

  try {
    const useModel = process.env.MEMORY_COMPRESS_MODEL;
    const compressed = useModel
      ? await compressWithLLM(bullets, useModel)
      : compressDeterministic(bullets);

    if (estimateTokens(compressed.ruleText) <= COMPRESS_TARGET_TOKENS) {
      setCached(key, compressed);
      return [compressed];
    }

    // LLM output was still too verbose — fall back to raw bullets.
    console.warn('[memory/compress] Compressed output exceeded target tokens; using raw bullets.');
    return bullets;
  } catch (err) {
    console.warn('[memory/compress] Compression failed (non-fatal):', err instanceof Error ? err.message : String(err));
    return bullets;
  }
}

// ── Deterministic merger ──────────────────────────────────────────────────────

/**
 * Groups bullets by "db.schema" prefix and merges table/column mentions.
 * Produces output like:
 *   "Schema reporting_layer: crp(57t), digital_desk(71t), finance(59t) · Schema curated_db: crew_manifest, vessel_schedule"
 */
function compressDeterministic(bullets: MemoryBullet[]): MemoryBullet {
  const groups = new Map<string, string[]>();

  for (const bullet of bullets) {
    // Extract leading dotted prefix (e.g. "Table reporting_layer.finance has columns..." → "reporting_layer")
    const prefixMatch = bullet.ruleText.match(/(?:Table|Schema|reporting_layer|curated_db|synergy_dw|open_analytics_zone)\b[.\s]*([\w_]+)/i);
    const group = prefixMatch ? prefixMatch[1] : 'misc';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(bullet.ruleText.slice(0, 80));
  }

  const mergedLines = [...groups.entries()].map(([schema, texts]) => {
    const preview = texts.slice(0, 3).join(' | ');
    return `[${schema}] ${preview}`;
  });

  const mergedText = mergedLines.join(' · ');

  // Borrow metadata from the highest-confidence input bullet.
  const best = bullets.reduce((a, b) => (b.confidence > a.confidence ? b : a), bullets[0]);

  return {
    ...best,
    id:       `compressed:${best.id}`,
    ruleText: mergedText,
  };
}

// ── LLM-based merger ─────────────────────────────────────────────────────────

async function compressWithLLM(
  bullets: MemoryBullet[],
  modelId: string,
): Promise<MemoryBullet> {
  // Lazy import to avoid pulling Bedrock SDK into the bundle when compression
  // is disabled (which is the default).
  const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');

  const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });

  const bulletBlock = bullets.map((b) => `- ${b.ruleText}`).join('\n');

  const prompt = `You are a schema knowledge compressor. Given these verbose SCHEMA_MAP memory bullets, produce a single compressed summary under ${COMPRESS_TARGET_TOKENS * 4} characters (roughly ${COMPRESS_TARGET_TOKENS} tokens).

Rules:
- Group tables by database/schema prefix.
- Merge column lists: "db.schema: table1(col1,col2,col3), table2(col4,col5)"
- Drop data type annotations unless critical (e.g. keep "PRIMARY KEY", drop "STRING", "BOOLEAN").
- Preserve table names and column names exactly — do not paraphrase.
- Output must be a single line of plain text, no markdown.

Bullets to compress:
${bulletBlock}

Compressed output:`;

  const response = await client.send(new ConverseCommand({
    modelId,
    messages: [{ role: 'user', content: [{ text: prompt }] }],
    inferenceConfig: { maxTokens: COMPRESS_TARGET_TOKENS + 50, temperature: 0 },
  }));

  const outputText =
    (response.output?.message?.content?.[0] as { text?: string } | undefined)?.text?.trim() ?? '';

  if (!outputText) throw new Error('LLM returned empty compression output');

  const best = bullets.reduce((a, b) => (b.confidence > a.confidence ? b : a), bullets[0]);
  return {
    ...best,
    id:       `compressed:${best.id}`,
    ruleText: outputText,
  };
}
