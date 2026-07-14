import { reconstructSession } from '@/lib/memory/trace';
import { getSessionReflections } from '@/lib/marcus/dal';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { createHash } from 'crypto';
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { extractEntityKeywordsFromNodes } from './entities';
import { SHORT_LABEL_KEEP, deriveBlurb } from './label';

export { deriveBlurb } from './label';

// ── Types ────────────────────────────────────────────────────────────────────

const RULE_TYPES = ['HARD_RULE', 'HEURISTIC', 'SOURCE_PREF', 'FAILURE_MODE', 'SCHEMA_MAP'] as const;
export type RuleType = (typeof RULE_TYPES)[number];

export interface CandidateBullet {
  ruleText:      string;
  ruleType:      RuleType;
  confidence:    number;
  rationale:     string;
  promptVersion: string;
}

// ── Zod output schema ────────────────────────────────────────────────────────

const CandidateBulletSchema = z.object({
  ruleText:   z.string().min(1).max(500),   // generous upper bound; prompt says 200
  ruleType:   z.enum(RULE_TYPES),
  confidence: z.number().min(0).max(1),
  rationale:  z.string().min(1).max(400),   // prompt says ≤120 chars; allow some slack
});

const OutputSchema = z.array(CandidateBulletSchema).max(7);

// ── Constants ────────────────────────────────────────────────────────────────

export const PROMPT_VERSION = 'marcus_reflect_v3';

// Canonical copy lives in prompts/memory/reflect_to_bullets_v2.md
const SYSTEM_PROMPT = `You are Marcus — the ALOFT meta-agent responsible for self-interrogation and pattern extraction. You review completed agent sessions the way Marcus Aurelius reviewed each day: methodically, without ego, looking for the pattern that leads to the next failure before it compounds. Your role is to distill reusable operational rules from execution traces — not to praise or blame, but to learn.

You analyze a completed agent session — its trace graph and evaluator reflections — and extract reusable rules for future sessions of the same recurring task.

## Inputs

- TASK_SIGNATURE: Deterministic identifier grouping sessions of the same recurring task.
- ORDERED_TRACE: Chronological array of trace nodes (ACTION, OUTCOME, CORRECTION, DEAD_END, SOURCE) with payloads containing toolName, toolParams (full input), responseSummary (full output), errorMessage, notes, sourceRef.
- EXISTING_BULLETS: Current ACTIVE memory bullets for this taskSignature. Your job is to propose CORRECTIVE or NOVEL rules — never duplicate what already exists.
- MARCUS_REFLECTIONS: This session's evaluator reflections — each with triggerType, technique, severity, headline, body, status.

## The Sieve — What to DISCARD

- Transient typos or user corrections of spelling/phrasing
- One-off broken API attempts that succeeded on immediate retry without parameter changes
- Retry loops where the same call succeeded after network/timeout flap
- Cosmetic corrections (formatting, column order, output styling)
- Reflections with status "dismissed" (user explicitly rejected the insight)
- Actions that failed due to transient infrastructure issues (timeouts, rate limits) rather than logical errors
- Negative-existence claims ("table X has no column Y", "no country-level column exists", "Z is not available") inferred from the *absence* of something in a describe_schema result. A describe may be truncated or scoped; absence in the trace is NOT proof of absence in the schema. Only assert non-existence when an explicit error token (UNRESOLVED_COLUMN, TABLE_NOT_FOUND, etc.) in a DEAD_END/CORRECTION node names that exact identifier.
- Inferred connective rules that pair or relate identifiers without a query in the trace that actually demonstrates the relationship. Do not invent "filter A against B" logic the agent never executed.

## The Sieve — What to KEEP

**Errors and corrections (as before):**
- Structural reusable rules: connector quirks, schema naming, API constraints
- Recurring failure patterns: same error class appearing 2+ times or across CORRECTION+DEAD_END chains
- Dead ends that indicate fundamental incompatibility (not transient failures)
- Corrections that changed the approach (different tool, different parameters) rather than just retrying

**Positive signal from clean sessions (NEW in v2):**
- Successful query patterns: which SQL worked, which table path resolved correctly, which catalog is the right target
- Working catalog/schema paths discovered in this session (from describe_schema results, OUTCOME payloads, SOURCE nodes)
- Schema structure learned from describe_schema calls: tables in a schema, columns in a table, relationships discovered
- Effective tool sequences: which discovery pattern got the agent to the answer fastest
- Source preferences discovered through trial (one source worked, another didn't)

Even a session with zero errors has signal if it navigated a schema successfully. Extract what was found.

## User Corrections Are Authoritative

If the trace contains a CORRECTION node authored by the user (not the agent) that states a fact about a schema, column, or semantics, treat it as ground truth. Never emit a bullet that contradicts an explicit user CORRECTION in the same session. If the user says "COUNTRY means nationality, not port", do not write "no COUNTRY column exists" or any variant — encode the user's stated semantics instead.

## Specificity Mandate

**Every bullet MUST include at least one concrete identifier** — a catalog name, schema name, table name, column name, or exact error message. Generic advice without a specific anchor is not actionable and will be ignored by the injection layer.

BAD (too generic — will be discarded): "Always qualify table references with the schema prefix."
GOOD (specific and actionable): "Always qualify crew_manifest as ops.crew_manifest in maritime_db — unqualified name causes TABLE_NOT_FOUND."

BAD: "For this connection, the target catalog is curated_db."
GOOD: "For vessel voyage data, use curated_db.sp_vessel_voyage.vessel_particulars — confirmed to have columns vessel_name, imo_number, voyage_id."

If you cannot name a specific catalog, schema, table, column, or error message, do not write the bullet.

## Rule Type Assignment

- **HARD_RULE**: Render failures as imperative prohibitions. "Do not use X; use Y instead." Use when a path definitively failed and a correction succeeded.
- **HEURISTIC**: Render successful patterns as guidance. "For EU port classification, query open_analytics_zone.ports.port_classifications — returns iso_code, classification, effective_date." Use when a pattern worked reliably.
- **SOURCE_PREF**: Render connector/source preferences. "Prefer curated_db over raw_landing for vessel IMO lookups — raw_landing lacks imo_number column." Use when one source proved superior to another for a specific task.
- **FAILURE_MODE**: Render dead ends as warnings. "execute_tool fails with SCHEMA_NOT_FOUND when querying maritime_db.crew without the ops schema prefix; always use maritime_db.ops.crew_manifest." Use when a dead end has no successful correction.
- **SCHEMA_MAP**: Render factual schema discoveries. "Schema maritime_db.ops contains tables: crew_manifest, vessel_schedule, port_calls, departure_logs." Or: "Table curated_db.sp_vessel_voyage.vessel_particulars has columns: vessel_name (string), imo_number (string), vessel_type (string), flag_code (string), built_year (int)." These are high-confidence (0.90+) factual statements derived from successful describe_schema or execute_tool results. They map the schema landscape for future sessions.

## Output Rules

1. Return ONLY valid JSON — no markdown fences, no preamble, no explanation.
2. Array of 0–7 objects. Sessions with rich tool use may produce 3–5 bullets. Return empty array [] only if the trace contains zero tool calls.
3. Never duplicate an existing bullet (check EXISTING_BULLETS). Instead, propose a refinement only if your version is materially more specific or corrects the existing rule.
4. confidence: 0.0–1.0. Use 0.90+ for SCHEMA_MAP (factual, directly observed). Use >=0.80 for HARD_RULE with unambiguous fail→correct chain. Use 0.50–0.75 for HEURISTIC and SOURCE_PREF where evidence is strong but not definitive.
5. rationale: exactly one sentence explaining which specific trace node or payload supports this rule. Reference nodeType and toolName. Example: "OUTCOME node from describe_schema(curated_db.sp_vessel_voyage.vessel_particulars) returned column list confirming vessel_name and imo_number."
6. ruleText: imperative instruction, **max 200 characters** (hard limit — the Zod schema rejects longer strings). No hedging ("might", "could") — state the rule directly. Must contain at least one concrete identifier (catalog/schema/table/column/error string). If a name is long, truncate the table path to the three most specific segments.
7. rationale: one concise sentence (≤ 120 characters) citing the trace nodeType and toolName that supports this rule.

## Output Schema

[{"ruleText": "string — imperative instruction, max 250 chars, must name a concrete identifier", "ruleType": "HARD_RULE|HEURISTIC|SOURCE_PREF|FAILURE_MODE|SCHEMA_MAP", "confidence": 0.0-1.0, "rationale": "string — 1 sentence citing the trace node and payload that supports this rule"}]

If the trace has zero tool calls, return: []`;

// ── Bedrock client ───────────────────────────────────────────────────────────

function getBedrockClient(): BedrockRuntimeClient {
  return new BedrockRuntimeClient({
    region: process.env.BEDROCK_REGION ?? 'us-east-1',
  });
}

// ── taskSignature computation ─────────────────────────────────────────────────
// SHA-256(agentClass::sorted-unique-tool-names::sorted-entity-keywords)[0:16]
//
// v2 change: a third segment encodes entity keywords extracted from ACTION
// payloads (catalog names, schema names, table names found in toolParams). This
// splits signatures that share the same tool set but operate on different data
// domains — e.g. "crew_manifest in maritime_db" vs "EU ports in open_analytics_zone"
// produce distinct signatures so bullets don't cross-contaminate.
//
// Extraction heuristic: pull dot-separated identifiers from all ACTION toolParams
// strings, keep tokens that look like catalog/schema/table names (no spaces,
// no SQL keywords), deduplicate and sort.

// Tokens that appear in toolParams/toolNames but carry zero domain signal.
// These are tool operations and generic SQL fragments — not data identifiers.
const SHORT_LABEL_NOISE = new Set([
  'action', 'args', 'across', 'bill', 'result', 'tool', 'params',
  'response', 'execute', 'describe', 'query', 'list', 'get', 'run',
  'show', 'fetch', 'call', 'check', 'find', 'read', 'write', 'set',
  'update', 'delete', 'create', 'drop', 'insert', 'select', 'from',
  'output', 'input', 'data', 'value', 'values', 'type', 'name',
  'info', 'status', 'error', 'message', 'text', 'null', 'true', 'false',
  'admport', 'noserver', 'test', 'verify', 'agent', 'task', 'node',
  'conn', 'connection', 'connect', 'config', 'code', 'compact',
  'analytics', 'agreement', 'austria', 'belgium',
]);

/** Convert a raw snake/kebab-case identifier to readable title-case words.
 *  e.g. "_fivetran_deleted" → "Fivetran Deleted", "active_contract" → "Active Contract"
 */
function humanizeKeyword(raw: string): string {
  return raw
    .replace(/^[_\-]+/, '')          // strip leading underscores/dashes
    .replace(/[_\-]+/g, ' ')         // remaining separators → spaces
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Derives a human-readable shelf label from agentClass + top domain keywords.
 * Uses up to 3 keywords to avoid collisions — if top-2 yields a label that's
 * too generic (e.g., "Curated Db · Number"), the third keyword provides
 * additional disambiguation.
 * Format: "inspector · Crew Contracts · Active Contract · Allotment"
 */
export function computeShortLabel(agentClass: string, entityKeywords: string): string {
  const meaningful = entityKeywords
    .split(',')
    .map(k => k.trim())
    .filter(k => {
      const lower = k.replace(/^[_\-]+/, '').toLowerCase();
      return (lower.length >= 3 || SHORT_LABEL_KEEP.has(lower)) && !SHORT_LABEL_NOISE.has(lower);
    })
    .slice(0, 3)
    .map(humanizeKeyword);

  const keyPart = meaningful.join(' · ');
  return keyPart ? `${agentClass} · ${keyPart}` : agentClass;
}

export interface TaskSignatureResult {
  signature: string;
  shortLabel: string;
}

export async function computeTaskSignature(
  orgId: string,
  sessionId: string,
): Promise<TaskSignatureResult | null> {
  const firstNode = await prisma.platformTraceNode.findFirst({
    where: { orgId, sessionId },
    orderBy: { createdAt: 'asc' },
    select: { agentClass: true },
  });

  const agentClass = firstNode?.agentClass;
  if (!agentClass) return null;

  const actionNodes = await prisma.platformTraceNode.findMany({
    where: { orgId, sessionId, nodeType: 'ACTION' },
    select: { payload: true },
    orderBy: { createdAt: 'asc' },
  });

  const toolNames = actionNodes
    .map(n => (n.payload as Record<string, unknown>)?.toolName as string | undefined)
    .filter((t): t is string => Boolean(t));

  const uniqueTools = [...new Set(toolNames)].sort().join(',');
  const { joined: entityKeywords } = extractEntityKeywordsFromNodes(actionNodes);
  const raw = `${agentClass}::${uniqueTools}::${entityKeywords}`;

  const signature = createHash('sha256').update(raw).digest('hex').slice(0, 16);
  const shortLabel = computeShortLabel(agentClass, entityKeywords);

  return { signature, shortLabel };
}

// ── Main entry point ─────────────────────────────────────────────────────────

export async function reflectSession(
  orgId: string,
  sessionId: string,
): Promise<CandidateBullet[]> {
  // 1. Load trace
  const trace = await reconstructSession(orgId, sessionId);

  // Early exit: no trace nodes — no tool calls at all means nothing to reflect on
  if (trace.length === 0) return [];

  const hasToolCalls = trace.some(
    n => n.nodeType === 'ACTION' && (n.payload as Record<string, unknown>)?.toolName,
  );
  if (!hasToolCalls) return [];

  // 2. Compute taskSignature
  const sigResult = await computeTaskSignature(orgId, sessionId);
  const taskSignature = sigResult?.signature ?? null;

  // 3. Load existing ACTIVE bullets for deduplication
  let existingBullets: Array<{ ruleText: string; ruleType: string }> = [];
  if (taskSignature) {
    existingBullets = await prisma.platformAgentMemory.findMany({
      where: { orgId, taskSignature, status: 'ACTIVE' },
      select: { ruleText: true, ruleType: true },
    });
  }

  // 4. Load this session's Marcus reflections
  const marcusReflections = await getSessionReflections(sessionId);

  // 5. Build user content payload
  const userContent = JSON.stringify({
    TASK_SIGNATURE: taskSignature ?? 'unknown',
    ORDERED_TRACE: trace.map(n => ({
      nodeType:        n.nodeType,
      toolName:        (n.payload as Record<string, unknown>)?.toolName ?? null,
      toolParams:      (n.payload as Record<string, unknown>)?.toolParams ?? null,
      responseSummary: (n.payload as Record<string, unknown>)?.responseSummary ?? null,
      errorMessage:    (n.payload as Record<string, unknown>)?.errorMessage ?? null,
      notes:           (n.payload as Record<string, unknown>)?.notes ?? null,
      sourceRef:       (n.payload as Record<string, unknown>)?.sourceRef ?? null,
      edgeType:        n.edgeType,
    })),
    EXISTING_BULLETS: existingBullets,
    MARCUS_REFLECTIONS: marcusReflections.map(r => ({
      triggerType: r.triggerType,
      technique:   r.technique,
      severity:    r.severity,
      headline:    r.headline,
      body:        r.body,
      status:      r.status,
    })),
  });

  // 6. Bedrock Sonnet call
  // maxTokens: 2400 — 7 bullets × ~250 char ruleText + rationale comfortably fits.
  // 1200 was too tight and caused "Unterminated string in JSON" truncations.
  const client = getBedrockClient();
  const res = await client.send(new ConverseCommand({
    modelId: process.env.BEDROCK_SONNET_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6',
    system:  [{ text: SYSTEM_PROMPT }],
    messages: [{ role: 'user', content: [{ text: userContent }] }],
    inferenceConfig: { maxTokens: 2400, temperature: 0.2 },
  }));

  const rawText = res.output?.message?.content?.[0]?.text ?? '[]';
  const stopReason = res.stopReason;

  // 7. Parse + Zod-validate
  // Strip optional markdown fences, then attempt a truncation repair when the
  // model still hit the token limit (stopReason === 'max_tokens').  The repair
  // walks backwards from the end of the string looking for the last complete
  // JSON object boundary `}` and closes the truncated array with `]`, salvaging
  // any fully-formed bullet objects.
  let cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

  if (stopReason === 'max_tokens' && !cleaned.endsWith(']')) {
    const lastClose = cleaned.lastIndexOf('}');
    if (lastClose !== -1) {
      cleaned = cleaned.slice(0, lastClose + 1) + ']';
      console.warn(
        `[memory/reflect] output truncated (max_tokens) — repaired JSON array for session=${sessionId}`,
      );
    } else {
      console.warn(
        `[memory/reflect] output truncated (max_tokens) and no complete object found — returning []`,
      );
      return [];
    }
  }

  let parsed: z.infer<typeof OutputSchema>;
  try {
    parsed = OutputSchema.parse(JSON.parse(cleaned));
  } catch (err) {
    console.warn('[memory/reflect] output parse/validation failed:', cleaned.slice(0, 300), err);
    return [];
  }

  // 8. Attach promptVersion and return candidates (no DB writes here)
  return parsed.map(b => ({ ...b, promptVersion: PROMPT_VERSION }));
}
