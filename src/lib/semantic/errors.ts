/**
 * src/lib/semantic/errors.ts
 *
 * Error classes for the semantic execution layer.
 * Kept in a separate file so they can be imported from Node.js scripts
 * (verify, seed) without pulling in server-only dependencies.
 */

export class SemanticValidationFailureError extends Error {
  constructor(
    public readonly errors: { field: string; location: string; reason: string }[],
  ) {
    super(
      `SemanticQuery validation failed:\n${errors.map((e) => `  ${e.location}: ${e.reason}`).join('\n')}`,
    );
    this.name = 'SemanticValidationFailureError';
  }
}

export class SemanticModelNotGovernedError extends Error {
  constructor(
    public readonly modelId: string,
    public readonly currentStatus: string,
  ) {
    super(
      `Semantic model '${modelId}' has status '${currentStatus}' — only governed models are queryable.`,
    );
    this.name = 'SemanticModelNotGovernedError';
  }
}

/**
 * Thrown (3.5A) when a query executed in authoring mode references a `draft`
 * definition owned by someone other than the authoring user. Drafts are
 * strictly owner-only: a user may preview their OWN drafts in authoring mode,
 * but never another user's. This is the authoring-mode security boundary.
 */
export class SemanticDraftAccessError extends Error {
  constructor(
    public readonly tableKind: 'entity' | 'dimension' | 'measure',
    public readonly rowId: string,
  ) {
    super(
      `Draft ${tableKind} '${rowId}' is owned by another user — drafts are only executable by their owner in authoring mode.`,
    );
    this.name = 'SemanticDraftAccessError';
  }
}
