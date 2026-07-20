/**
 * src/lib/semantic/authoring-access.ts
 *
 * Pure access-decision logic for the 3.5A authoring-mode execution bypass.
 * No I/O — fully unit-testable in isolation. execute.ts loads the candidate
 * definition rows and applies decideDefinitionAccess() to each one.
 *
 * The security boundary of the whole authoring bypass lives here: a `draft`
 * definition is executable ONLY by its owner, and ONLY when an authoring
 * execution supplies both authoringMode AND authoringUserId. Everything else
 * (the LLM tool, dashboards, all existing callers) passes no opts and never
 * sees a draft.
 */

export type SemTableKind = 'entity' | 'dimension' | 'measure';

export interface AuthoringOpts {
  /** When true (with authoringUserId), admit the owner's own drafts. */
  authoringMode?: boolean;
  /** The owner previewing their drafts. Required — authoringMode alone is insufficient. */
  authoringUserId?: string;
}

/** A definition row as seen by the access decision — status + owner only. */
export interface DefinitionAccessRow {
  status: string; // 'draft' | 'candidate' | 'governed' | 'archived'
  createdBy: string | null; // owner of an authored draft; NULL = system/T4-generated
}

export type AccessDecision = 'allow' | 'exclude' | 'forbid-draft';

/**
 * Decide whether a single definition row is usable for a given execution.
 *
 *   governed / candidate → 'allow'
 *       (candidates already execute inside a governed model — pre-3.5A behavior)
 *   archived             → 'exclude'      (retired — never queryable)
 *   draft:
 *     - not an authoring execution          → 'exclude'      (invisible to everything but its owner)
 *     - authoring, owner === authoringUser  → 'allow'
 *     - authoring, owner !== authoringUser  → 'forbid-draft' (owner-only security boundary)
 *
 * 'exclude' means "drop from the compilable set" — a referenced excluded def
 * then fails ordinary reference validation (a clean forbid for the default
 * path). 'forbid-draft' is reserved for a referenced draft owned by SOMEONE
 * ELSE, which the caller must surface as a hard SemanticDraftAccessError.
 */
export function decideDefinitionAccess(
  row: DefinitionAccessRow,
  opts: AuthoringOpts | undefined,
): AccessDecision {
  if (row.status === 'archived') return 'exclude';
  if (row.status !== 'draft') return 'allow'; // candidate | governed | (any future non-draft, non-archived)

  // ── draft ──
  if (!isAuthoringExecution(opts)) return 'exclude';
  return row.createdBy === opts!.authoringUserId ? 'allow' : 'forbid-draft';
}

/**
 * True only when authoring opts are FULLY specified (mode + owner id).
 * authoringMode without an authoringUserId is deliberately treated as a
 * non-authoring (default, governed-only) execution.
 */
export function isAuthoringExecution(opts: AuthoringOpts | undefined): boolean {
  return !!opts?.authoringMode && !!opts?.authoringUserId;
}

/**
 * Whether a result should be stamped "Draft — not governed": true iff this is
 * an authoring execution that referenced at least one non-governed (draft or
 * candidate) definition. The default (governed-consumption) path is NEVER a
 * draft, so a non-authoring execution is always false.
 */
export function deriveIsDraft(referencedStatuses: string[], authoring: boolean): boolean {
  return authoring && referencedStatuses.some((status) => status !== 'governed');
}
