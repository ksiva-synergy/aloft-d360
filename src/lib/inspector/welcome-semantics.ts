/** Parsed fields from a T2 `platform_context_semantics.card` object row. */

export interface ParsedObjectSemantic {
  entity?: string;
  summary?: string;
  intents: string[];
}

export function parseObjectSemanticCard(card: unknown): ParsedObjectSemantic {
  if (!card || typeof card !== 'object') return { intents: [] };
  const root = card as Record<string, unknown>;
  // Some writers nest under `card`; enrich stores the object card at the top level.
  const inner =
    root.card && typeof root.card === 'object' ? (root.card as Record<string, unknown>) : root;

  const summary = typeof inner.summary === 'string' ? inner.summary.trim() : undefined;
  const entity = typeof inner.entity === 'string' ? inner.entity.trim() : undefined;
  const intents: string[] = [];
  const patterns = inner.usage_patterns;
  if (Array.isArray(patterns)) {
    for (const p of patterns) {
      if (!p || typeof p !== 'object') continue;
      const intent = (p as { intent?: string }).intent;
      if (typeof intent === 'string' && intent.trim()) intents.push(intent.trim());
    }
  }
  return { summary, entity, intents };
}
