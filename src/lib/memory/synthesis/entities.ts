/**
 * Shared entity-keyword extraction for the memory synthesis pipeline.
 *
 * Used by:
 *   - reflect.ts  — to compute the entity-keyword segment of a taskSignature
 *   - validate.ts — to check HEURISTIC / SOURCE_PREF candidates against trace payloads
 *
 * Extracts dot-separated identifiers (catalog.schema.table variants) from
 * arbitrary text or structured JSON, filtering out SQL reserved words and
 * short/numeric tokens.
 */

// ── SQL keyword filter ────────────────────────────────────────────────────────
// Keep in sync with reflect.ts if you add new keywords.
export const SQL_KEYWORD_RE =
  /^(select|from|where|join|on|and|or|not|in|as|by|group|order|limit|with|having|case|when|then|else|end|null|true|false|asc|desc|show|describe|catalogs|schemas|tables|information_schema|left|right|inner|outer|count|sum|avg|max|min|distinct|all|union|insert|update|delete|create|drop|alter|set|into|values|is|like|between|exists|cast|try_cast|coalesce|ifnull|if|iif|date|timestamp|string|int|bigint|double|float|boolean|varchar|char|array|map|struct)$/i;

// ── extractEntityKeywords ─────────────────────────────────────────────────────

/**
 * Pull entity keywords from an array of nodes that expose a `payload` field.
 * Each payload's `toolParams` is JSON-stringified and scanned for dotted
 * identifier paths (catalog.schema.table variants).
 *
 * Returns a sorted, comma-joined string (for use in taskSignature hashing)
 * and the raw Set<string> (for validation overlap checks).
 */
export function extractEntityKeywordsFromNodes(
  actionNodes: Array<{ payload: unknown }>,
): { joined: string; keywords: Set<string> } {
  const keywords = new Set<string>();

  for (const node of actionNodes) {
    const params = (node.payload as Record<string, unknown>)?.toolParams;
    if (!params) continue;
    extractFromText(JSON.stringify(params), keywords);
  }

  return { joined: [...keywords].sort().join(','), keywords };
}

/**
 * Pull entity keywords from a raw text string (e.g. ruleText or a payload
 * field serialised to string). Used by validate.ts for rule-text scanning.
 */
export function extractEntityKeywordsFromText(text: string): Set<string> {
  const keywords = new Set<string>();
  extractFromText(text, keywords);
  return keywords;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function extractFromText(raw: string, out: Set<string>): void {
  const tokenRe = /\b([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*){0,3})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(raw)) !== null) {
    const parts = m[1].split('.');
    for (const part of parts) {
      if (
        part.length >= 3 &&
        part.length <= 64 &&
        !SQL_KEYWORD_RE.test(part) &&
        !/^\d+$/.test(part)
      ) {
        out.add(part.toLowerCase());
      }
    }
  }
}
