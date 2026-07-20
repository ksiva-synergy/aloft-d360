/**
 * How an authoring surface (MyDraftsSection, WhatIveTaughtSection) sources its
 * data — the seam that lets one component render in two places (W1):
 *
 *   - 'model': in-session, scoped to the session's candidate model
 *     (SemanticGovernancePanel inside InspectorShell).
 *   - 'org':   the standalone /agent-lab/metrics route, aggregating the caller's
 *     drafts/contributions across every model in the org — no session required.
 */
export type AuthoringScope =
  | { kind: 'model'; modelId: string }
  | { kind: 'org' };
