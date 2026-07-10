/**
 * Curator — delta-only merge of Reflector candidates into platform_agent_memory.
 *
 * CRITICAL INVARIANT (context-collapse prevention):
 *   curate() NEVER deletes rows.
 *   curate() NEVER rewrites bullets it didn't match.
 *   curate() NEVER touches bullets outside the candidate's taskSignature scope.
 *   Every mutation is logged for audit.
 *
 * Three paths per candidate:
 *   DEDUP      — cosine distance < 0.07 (similarity > 0.93): increment helpfulCount
 *   SUPERSEDE  — distance 0.07–0.20 AND (ruleType changed OR confidence higher):
 *                mark old SUPERSEDED, insert new at version + 1
 *   INSERT     — no match within 0.20 distance: insert fresh bullet
 */

import { prisma } from '@/lib/prisma';
import { createId } from '@paralleldrive/cuid2';
import { embedQuery } from '@/lib/context/embed';
import type { CandidateBullet } from './reflect';
import { deriveBlurb } from './label';
import { scrubBulletText } from './scrub';
import { validateAgainstTrace } from './validate';
import type { TraceWalkRow } from '@/lib/memory/trace/reconstruct';
import {
  isCaveatGuardEnabled,
  buildSessionCaveatMap,
  checkBulletCaveat,
  type CaveatMap,
} from '@/lib/memory/caveat-guard';

// ── Thresholds ────────────────────────────────────────────────────────────────

// Cosine *distance* (0 = identical, 2 = opposite). pgvector <=> operator.
// similarity = 1 - distance  (for normalized vectors)
const DEDUP_DISTANCE     = 0.07;  // similarity > 0.93 — treat as same rule
const SUPERSEDE_DISTANCE = 0.20;  // similarity > 0.80 — close enough to compare types

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CurateResult {
  inserted:          number;
  deduped:           number;
  superseded:        number;
  phantomsBlocked:   number;
  quarantined:       number;
}

// Row returned by the nearest-neighbours query
interface NearRow {
  id:            string;
  rule_type:     string;
  confidence:    number;
  helpful_count: number;
  version:       number;
  source_session_ids: string[];
  distance:      number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function vecLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}

// ── curate ────────────────────────────────────────────────────────────────────

/**
 * Merge a Reflector candidate set into platform_agent_memory for one session.
 * Called once per session by the nightly synthesize job (or inline by tests).
 *
 * @param orgId         Organisation scope
 * @param sessionId     The session that produced these candidates
 * @param agentClass    Resolved from the session's first trace node
 * @param taskSignature SHA-256 hash from computeTaskSignature()
 * @param candidates    Output of reflectSession()
 * @param traceNodes    Optional trace walk rows for Rama validation
 * @param shortLabel    Human-readable label: "agentClass · keyword1 · keyword2"
 */
export async function curate(
  orgId:         string,
  sessionId:     string,
  agentClass:    string,
  taskSignature: string,
  candidates:    CandidateBullet[],
  traceNodes?:   TraceWalkRow[],
  shortLabel?:   string,
): Promise<CurateResult> {
  const result: CurateResult = { inserted: 0, deduped: 0, superseded: 0, phantomsBlocked: 0, quarantined: 0 };

  if (candidates.length === 0) return result;

  console.log(
    `[curate] org=${orgId} session=${sessionId} agentClass=${agentClass}` +
    ` taskSig=${taskSignature} candidates=${candidates.length}`,
  );

  // ── Session-level caveat map (built once, used per-bullet) ───────────────
  //
  // When the caveat guard is enabled for this org, extract table paths from
  // the trace nodes and resolve them against PlatformContextObject +
  // PlatformContextSemantic in one batch query. The resulting CaveatMap is
  // shared across all candidate bullets in this session.
  //
  // Guard is skipped (empty map) when:
  //   - MEMORY_CAVEAT_GUARD_ENABLED != 'true'
  //   - orgId is not in MEMORY_CAVEAT_GUARD_ORGS
  //   - traceNodes is absent or empty (e.g. inline unit tests)
  let caveatMap: CaveatMap = new Map();
  if (isCaveatGuardEnabled(orgId) && traceNodes && traceNodes.length > 0) {
    caveatMap = await buildSessionCaveatMap(orgId, traceNodes);
  }

  for (const candidate of candidates) {

    // ── 0. PII / credential scrub ────────────────────────────────────────────
    //
    // Scrub before embedding AND before any DB write so that no credential or
    // contact-data value ever reaches rule_text or embed_text columns.
    // COMPLIANCE: Mandatory pre-commit scrub (C4-lite invariant — see scrub.ts).

    const { scrubbed, redactions, categories } = scrubBulletText(candidate.ruleText);
    if (redactions > 0) {
      console.warn(
        `[curate/scrub] REDACTED ${redactions} pattern(s) from candidate before commit` +
        ` session=${sessionId} categories=${categories.join(',')}` +
        ` original="${candidate.ruleText.slice(0, 80)}"`,
      );
    }
    // Mutate candidate in-place so all downstream paths use the clean text.
    // The original ruleText is intentionally discarded after this point.
    candidate.ruleText = scrubbed;

    // ── 0b. Rama validation gate ──────────────────────────────────────────────
    //
    // Deterministic regex check: a bullet can only be committed if at least
    // one identifier or error token it names is directly observable in the
    // trace that produced it.  If the trace is absent (e.g. inline tests that
    // do not pass traceNodes) the gate is skipped to preserve backward
    // compatibility.

    if (traceNodes && traceNodes.length > 0) {
      const validation = validateAgainstTrace(candidate, traceNodes);
      if (!validation.valid) {
        console.log(
          `[curate/rama] PHANTOM BLOCKED id=${sessionId}` +
          ` ruleType=${candidate.ruleType}` +
          ` reason="${validation.reason}"` +
          ` rule="${candidate.ruleText.slice(0, 80)}"`,
        );
        result.phantomsBlocked++;
        continue;
      }
    }

    // ── 0c. Caveat guard ──────────────────────────────────────────────────────
    //
    // Checks whether this candidate bullet names a HIGH-severity caveated table.
    // HEURISTIC and SOURCE_PREF bullets are quarantined (written to DB with
    // status='QUARANTINED') rather than hard-blocked, so they remain auditable
    // and can be manually promoted to ACTIVE after human review.
    // HARD_RULE / FAILURE_MODE / SCHEMA_MAP are exempt — error patterns and schema
    // facts remain useful regardless of source data quality (D5).
    //
    // Quarantined bullets are not returned by any retrieval query (all queries
    // filter status='ACTIVE') and cannot accumulate helpful_count signal.

    if (caveatMap.size > 0) {
      const caveatResult = checkBulletCaveat(candidate.ruleText, candidate.ruleType, caveatMap);
      if (caveatResult) {
        const newId  = createId();
        const blurb  = deriveBlurb({ ruleType: candidate.ruleType, ruleText: candidate.ruleText, shortLabel });
        const caveatCtx = {
          paths:   caveatResult.paths,
          tier:    caveatResult.tier,
          signals: caveatResult.signals,
        };

        await prisma.$executeRaw`
          INSERT INTO platform_agent_memory
            (id, org_id, agent_class, task_signature, short_label, blurb,
             rule_text, rule_type, confidence,
             source_session_ids, version, status, caveat_context,
             valid_from, created_at, updated_at)
          VALUES (
            ${newId}, ${orgId}, ${agentClass}, ${taskSignature}, ${shortLabel ?? null}, ${blurb},
            ${candidate.ruleText}, ${candidate.ruleType}, ${candidate.confidence},
            ${[sessionId]}, 1, 'QUARANTINED', ${JSON.stringify(caveatCtx)}::jsonb,
            NOW(), NOW(), NOW()
          )
        `;

        console.log(
          `[curate/caveat] QUARANTINED id=${newId} type=${candidate.ruleType}` +
          ` tier=${caveatResult.tier} paths=${caveatResult.paths.join(', ')}` +
          ` rule="${candidate.ruleText.slice(0, 60)}"`,
        );
        result.quarantined++;
        continue;
      }
    }

    // ── 1. Embed the candidate text ─────────────────────────────────────────

    const vec = await embedQuery(candidate.ruleText);
    if (!vec) {
      console.warn(
        `[curate] SKIP session=${sessionId} — Titan embedding returned null` +
        ` for: "${candidate.ruleText.slice(0, 80)}"`,
      );
      continue;
    }

    const vecStr = vecLiteral(vec);

    // ── 2. Nearest-neighbours query (scoped to taskSignature + ACTIVE) ──────
    //
    // Returns up to 3 neighbours sorted by cosine distance ascending.
    // We do NOT use Prisma ORM here because Prisma cannot bind vector literals
    // as typed parameters — the ::text::vector cast requires a raw string.

    const neighbours = await prisma.$queryRaw<NearRow[]>`
      SELECT
        id,
        rule_type,
        confidence,
        helpful_count,
        version,
        source_session_ids,
        (embedding <=> ${vecStr}::text::vector) AS distance
      FROM platform_agent_memory
      WHERE
        org_id         = ${orgId}
        AND task_signature = ${taskSignature}
        AND status     = 'ACTIVE'
        AND embedding  IS NOT NULL
      ORDER BY embedding <=> ${vecStr}::text::vector
      LIMIT 3
    `;

    // Normalise numeric distance — Postgres may return it as string
    const rows = neighbours.map(r => ({
      ...r,
      distance: typeof r.distance === 'number'
        ? r.distance
        : parseFloat(r.distance as unknown as string),
    }));

    const closest = rows[0] ?? null;

    // ── 3. DEDUP path ────────────────────────────────────────────────────────
    //
    // Dedup takes priority UNLESS the candidate is a genuine supersession
    // (different ruleType or materially higher confidence). In that case we
    // fall through to the supersede check even if the distance is near-zero,
    // because a higher-confidence refinement of an existing rule should
    // replace it, not just bump a counter.

    const isSupersedeable = closest &&
      closest.distance < SUPERSEDE_DISTANCE &&
      (closest.rule_type !== candidate.ruleType ||
       candidate.confidence > closest.confidence + 0.05);

    if (closest && closest.distance < DEDUP_DISTANCE && !isSupersedeable) {
      const alreadyHasSession = closest.source_session_ids.includes(sessionId);
      const newSessionIds = alreadyHasSession
        ? closest.source_session_ids
        : [...closest.source_session_ids, sessionId];

      await prisma.platformAgentMemory.update({
        where: { id: closest.id },
        data: {
          helpfulCount:     { increment: 1 },
          sourceSessionIds: newSessionIds,
        },
      });

      console.log(
        `[curate] DEDUP  id=${closest.id} dist=${closest.distance.toFixed(4)}` +
        ` helpfulCount=${closest.helpful_count + 1}` +
        ` rule="${candidate.ruleText.slice(0, 60)}"`,
      );
      result.deduped++;
      continue;
    }

    // ── 4. SUPERSEDE path ─────────────────────────────────────────────────

    // Closest row is within 0.20 distance AND either has a different ruleType
    // or the candidate has materially higher confidence. isSupersedeable was
    // already computed above (used to gate the dedup path).
    if (isSupersedeable && closest) {
      const now = new Date();

      // Inherit source sessions from the old bullet, add current session
      const inheritedSessions = Array.from(
        new Set([...closest.source_session_ids, sessionId]),
      );

      // Mark old bullet SUPERSEDED
      await prisma.platformAgentMemory.update({
        where: { id: closest.id },
        data: {
          status:     'SUPERSEDED',
          validUntil: now,
        },
      });

      console.log(
        `[curate] SUPERSEDED id=${closest.id} dist=${closest.distance.toFixed(4)}` +
        ` oldType=${closest.rule_type} newType=${candidate.ruleType}` +
        ` oldConf=${closest.confidence.toFixed(2)} newConf=${candidate.confidence.toFixed(2)}`,
      );

      // Insert successor at version + 1
      const newId = createId();
      const blurb = deriveBlurb({ ruleType: candidate.ruleType, ruleText: candidate.ruleText, shortLabel });
      await prisma.$executeRaw`
        INSERT INTO platform_agent_memory
          (id, org_id, agent_class, task_signature, short_label, blurb,
           rule_text, rule_type, confidence,
           embed_text, embedding,
           source_session_ids, version, status,
           valid_from, created_at, updated_at)
        VALUES (
          ${newId}, ${orgId}, ${agentClass}, ${taskSignature}, ${shortLabel ?? null}, ${blurb},
          ${candidate.ruleText}, ${candidate.ruleType}, ${candidate.confidence},
          ${candidate.ruleText}, ${vecStr}::text::vector,
          ${inheritedSessions}, ${closest.version + 1}, 'ACTIVE',
          NOW(), NOW(), NOW()
        )
      `;

      console.log(
        `[curate] INSERT  id=${newId} version=${closest.version + 1}` +
        ` type=${candidate.ruleType} conf=${candidate.confidence.toFixed(2)}` +
        ` rule="${candidate.ruleText.slice(0, 60)}"`,
      );
      result.superseded++;
      continue;
    }

    // ── 5. Genuine INSERT path ───────────────────────────────────────────────

    const newId = createId();
    const blurb = deriveBlurb({ ruleType: candidate.ruleType, ruleText: candidate.ruleText, shortLabel });
    await prisma.$executeRaw`
      INSERT INTO platform_agent_memory
        (id, org_id, agent_class, task_signature, short_label, blurb,
         rule_text, rule_type, confidence,
         embed_text, embedding,
         source_session_ids, version, status,
         valid_from, created_at, updated_at)
      VALUES (
        ${newId}, ${orgId}, ${agentClass}, ${taskSignature}, ${shortLabel ?? null}, ${blurb},
        ${candidate.ruleText}, ${candidate.ruleType}, ${candidate.confidence},
        ${candidate.ruleText}, ${vecStr}::text::vector,
        ${[sessionId]}, 1, 'ACTIVE',
        NOW(), NOW(), NOW()
      )
    `;

    console.log(
      `[curate] INSERT  id=${newId} version=1 type=${candidate.ruleType}` +
      ` conf=${candidate.confidence.toFixed(2)}` +
      ` rule="${candidate.ruleText.slice(0, 60)}"`,
    );
    result.inserted++;
  }

  console.log(
    `[curate] done session=${sessionId}` +
    ` inserted=${result.inserted} deduped=${result.deduped}` +
    ` superseded=${result.superseded} phantomsBlocked=${result.phantomsBlocked}` +
    ` quarantined=${result.quarantined}`,
  );
  return result;
}
