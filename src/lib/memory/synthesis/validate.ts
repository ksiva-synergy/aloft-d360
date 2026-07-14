/**
 * Rama Validation Gate — deterministic phantom-prevention for memory candidates.
 *
 * Called by curate() AFTER scrubBulletText and BEFORE embedQuery.
 * Pure function: no LLM calls, no DB access, no side effects.
 *
 * Principle (Rama's invariant): a bullet can only be committed if at least one
 * identifier or error token it mentions is directly observable in the trace that
 * produced it. If nothing the bullet names appears in any trace node payload,
 * the bullet is a hallucination — a "phantom" — and must be blocked.
 *
 * Validation rules by ruleType:
 *
 *   SCHEMA_MAP   — highest phantom risk. Extract dotted identifiers from ruleText.
 *                  Require ≥1 to appear in any OUTCOME node's responseSummary or
 *                  toolParams. Reject if zero overlap.
 *
 *   HARD_RULE    — extract the error/failure clause (first 50 chars of the
 *                  error/entity keyword). Require ≥1 DEAD_END or CORRECTION node
 *                  whose payload contains a case-insensitive substring match.
 *                  Reject if no match.
 *
 *   FAILURE_MODE — same as HARD_RULE, but additionally reject immediately if
 *                  the trace contains zero DEAD_END nodes.
 *
 *   HEURISTIC    — lighter check: extract entity keywords from ruleText, require
 *   SOURCE_PREF    ≥1 to appear in any ACTION or OUTCOME payload.
 *                  Reject if zero keyword overlap.
 */

import type { CandidateBullet } from './reflect';
import type { TraceWalkRow } from '@/lib/memory/trace/reconstruct';
import { extractEntityKeywordsFromText, SQL_KEYWORD_RE } from './entities';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid:   boolean;
  reason?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Stringify a trace node's payload field for substring scanning. */
function payloadText(node: TraceWalkRow): string {
  const p = node.payload as Record<string, unknown> | null | undefined;
  if (!p) return '';
  const parts: string[] = [];
  if (typeof p.responseSummary === 'string') parts.push(p.responseSummary);
  if (p.toolParams)  parts.push(JSON.stringify(p.toolParams));
  if (p.toolName && typeof p.toolName === 'string') parts.push(p.toolName);
  if (p.errorMessage && typeof p.errorMessage === 'string') parts.push(p.errorMessage);
  if (p.notes && typeof p.notes === 'string') parts.push(p.notes);
  return parts.join(' ');
}

// Common English words that look like identifiers but are not schema objects.
// Kept small — SQL_KEYWORD_RE handles SQL terms; this covers prose words that
// appear in ruleText but are not meaningful schema identifiers.
const PROSE_WORD_RE =
  /^(the|for|use|this|from|have|that|with|your|into|will|been|more|also|only|than|its|all|but|not|are|was|were|has|had|may|can|get|set|let|put|new|old|one|two|any|per|via|see|how|why|who|now|our|out|off|try|far|too|few|lot|row|col|val|key|ref|log|msg|err|ret|tmp|var|obj|map|arr|vec|str|buf|len|idx|num|max|min|sum|avg|top|end|has|add|del|rem|get|put|run|use|via|see|try|may|can|had|was|were|has|lot|row|col|val|key|ref|msg|err|tmp|obj|map|arr|vec|str|buf|len|num|top|rem|del|add|ret)$/i;

/**
 * Extract dotted-identifier tokens from ruleText for SCHEMA_MAP validation
 * and caveat-guard bullet correlation.
 * Returns every contiguous dotted path found and individual parts, filtered
 * to retain only tokens that look like schema objects (not prose words).
 *
 * Exported so the caveat guard can reuse the same extraction primitive when
 * correlating candidate bullet text back to session table paths.
 */
export function extractSchemaIdentifiers(ruleText: string): string[] {
  const tokens = new Set<string>();
  const re = /\b([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*){0,3})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ruleText)) !== null) {
    const full = m[1].toLowerCase();
    // Only add the full dotted path if it contains at least one dot (i.e. is a
    // qualified identifier like catalog.schema.table)
    if (full.includes('.')) {
      tokens.add(full);
    }
    for (const part of full.split('.')) {
      if (
        part.length >= 4 &&        // single 3-char words cause too many false positives
        !SQL_KEYWORD_RE.test(part) &&
        !PROSE_WORD_RE.test(part)
      ) {
        tokens.add(part);
      }
    }
  }
  return [...tokens];
}

/**
 * Check whether any identifier from the set appears in the target string,
 * using word-boundary anchoring to avoid substring false-positives.
 */
function hasIdentifierOverlap(identifiers: string[], target: string): boolean {
  const lower = target.toLowerCase();
  return identifiers.some(id => {
    // Full dotted paths: exact substring match is fine (they are long and specific)
    if (id.includes('.')) return lower.includes(id);
    // Single tokens: require word boundary on both sides
    const re = new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    return re.test(lower);
  });
}

/**
 * Extract the error / entity clause from a HARD_RULE or FAILURE_MODE ruleText.
 * Looks for text after "fails with", "error:", etc.; truncates at the first
 * clause boundary (semicolon, colon, pipe, parenthesis) or 50 chars.
 */
function extractFailureClause(ruleText: string): string {
  const lower = ruleText.toLowerCase();

  // Common markers that introduce the failure description
  const markers = [
    'fails with ',
    'fail with ',
    'error:',
    'error ',
    'causes ',
    'do not use ',
    'do not ',
    'not found',
    'permission denied',
    'unauthorized',
    'table not found',
    'schema not found',
  ];

  for (const marker of markers) {
    const idx = lower.indexOf(marker);
    if (idx !== -1) {
      const start = idx + marker.length;
      // Take up to 50 chars after the marker, then truncate at first clause boundary
      const raw = ruleText.slice(start, start + 50).toLowerCase().trim();
      // Stop at first semicolon, colon, pipe, or " — "
      const stop = raw.search(/[;|]| — |--/);
      return stop > 0 ? raw.slice(0, stop).trim() : raw;
    }
  }

  // No marker — use first 50 chars of the rule as anchor, stop at first boundary
  const raw = ruleText.slice(0, 50).toLowerCase().trim();
  const stop = raw.search(/[;|]| — |--/);
  return stop > 0 ? raw.slice(0, stop).trim() : raw;
}

// Detects negative-existence phrasing: "no X column", "has no", "does not have",
// "X is not available", "there is no". These claims are only valid if backed by
// an explicit error token in a DEAD_END/CORRECTION node — absence in a (possibly
// truncated) describe result never proves schema-level non-existence.
const NEGATIVE_EXISTENCE_RE =
  /\b(no [a-z_]+(?:-level)? (?:column|table|field|schema)|has no |does not (?:have|exist|contain)|there is no |not available|no such (?:column|table|field))\b/i;

function assertsNonExistence(ruleText: string): boolean {
  return NEGATIVE_EXISTENCE_RE.test(ruleText);
}

// Error tokens that legitimately confirm a non-existence claim.
const EXISTENCE_ERROR_RE =
  /\b(UNRESOLVED_COLUMN|TABLE_NOT_FOUND|SCHEMA_NOT_FOUND|COLUMN_NOT_FOUND|cannot be resolved|does not exist)\b/i;

// ── validateAgainstTrace ──────────────────────────────────────────────────────

/**
 * Validate a CandidateBullet against the trace that produced it.
 *
 * @param candidate    The candidate bullet (already scrubbed)
 * @param traceNodes   Full ordered trace for the session
 * @returns            { valid: true } or { valid: false, reason: string }
 */
export function validateAgainstTrace(
  candidate: CandidateBullet,
  traceNodes: TraceWalkRow[],
): ValidationResult {

  const { ruleType, ruleText } = candidate;

  // ── Negative-existence guard (all rule types) ───────────────────────────────
  // A claim that something does NOT exist is only admissible if the trace
  // contains an explicit error token naming that absence. Otherwise it is an
  // inference from (possibly truncated) describe output — the exact failure that
  // produced the "no country column exists" phantom.
  if (assertsNonExistence(ruleText)) {
    const errorBearingNodes = traceNodes.filter(
      n => n.nodeType === 'DEAD_END' || n.nodeType === 'CORRECTION',
    );
    const hasErrorBacking = errorBearingNodes.some(n =>
      EXISTENCE_ERROR_RE.test(payloadText(n)),
    );
    if (!hasErrorBacking) {
      return {
        valid:  false,
        reason: 'negative-existence claim not backed by an error token in trace',
      };
    }
  }

  // ── SCHEMA_MAP ──────────────────────────────────────────────────────────────
  if (ruleType === 'SCHEMA_MAP') {
    const identifiers = extractSchemaIdentifiers(ruleText);
    if (identifiers.length === 0) {
      return { valid: false, reason: 'SCHEMA_MAP produced no identifiers from ruleText' };
    }

    const outcomePayloads = traceNodes
      .filter(n => n.nodeType === 'OUTCOME')
      .map(payloadText);

    const joined = outcomePayloads.join(' ');
    const hasMatch = hasIdentifierOverlap(identifiers, joined);

    if (!hasMatch) {
      return {
        valid:  false,
        reason: 'SCHEMA_MAP references entities not observed in trace outcomes',
      };
    }
    return { valid: true };
  }

  // ── HARD_RULE ───────────────────────────────────────────────────────────────
  if (ruleType === 'HARD_RULE') {
    const clause = extractFailureClause(ruleText);

    const failureNodes = traceNodes.filter(
      n => n.nodeType === 'DEAD_END' || n.nodeType === 'CORRECTION',
    );
    if (failureNodes.length === 0) {
      return {
        valid:  false,
        reason: 'HARD_RULE references failure not observed in trace',
      };
    }

    const hasMatch = failureNodes.some(n =>
      payloadText(n).toLowerCase().includes(clause),
    );

    if (!hasMatch) {
      return {
        valid:  false,
        reason: 'HARD_RULE references failure not observed in trace',
      };
    }
    return { valid: true };
  }

  // ── FAILURE_MODE ────────────────────────────────────────────────────────────
  if (ruleType === 'FAILURE_MODE') {
    const deadEnds = traceNodes.filter(n => n.nodeType === 'DEAD_END');
    if (deadEnds.length === 0) {
      return { valid: false, reason: 'FAILURE_MODE but no dead ends in trace' };
    }

    const clause = extractFailureClause(ruleText);
    const hasMatch = traceNodes
      .filter(n => n.nodeType === 'DEAD_END' || n.nodeType === 'CORRECTION')
      .some(n => payloadText(n).toLowerCase().includes(clause));

    if (!hasMatch) {
      return {
        valid:  false,
        reason: 'HARD_RULE references failure not observed in trace',
      };
    }
    return { valid: true };
  }

  // ── HEURISTIC / SOURCE_PREF ─────────────────────────────────────────────────
  if (ruleType === 'HEURISTIC' || ruleType === 'SOURCE_PREF') {
    const keywords = extractEntityKeywordsFromText(ruleText);
    if (keywords.size === 0) {
      // No extractable entity keywords — pass through (too generic to block)
      return { valid: true };
    }

    const actionOutcomePayloads = traceNodes
      .filter(n => n.nodeType === 'ACTION' || n.nodeType === 'OUTCOME')
      .map(payloadText)
      .join(' ')
      .toLowerCase();

    const hasMatch = [...keywords].some(kw => actionOutcomePayloads.includes(kw));

    if (!hasMatch) {
      return {
        valid:  false,
        reason: 'No entity overlap between rule and trace',
      };
    }
    return { valid: true };
  }

  // Unknown ruleType — pass through rather than block
  return { valid: true };
}
