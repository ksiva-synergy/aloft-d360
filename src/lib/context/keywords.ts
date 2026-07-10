// INVARIANT: pure function — no I/O, no Prisma, no Bedrock.
// Derives a TEXT[] keyword index from already-stored T2 semantic metadata.
// Called after T2 enrichment and in the backfill script.

// ── Stopwords ─────────────────────────────────────────────────────────────────
// Short, high-frequency tokens that carry no domain signal.

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for',
  'by', 'is', 'it', 'as', 'be', 'do', 'if', 'no', 'up', 'per',
  'one', 'row', 'each', 'this', 'that', 'with', 'from', 'into',
  'id', 'ids', 'ref', 'key', 'code', 'num', 'nr', 'no',
  'date', 'time', 'ts', 'at', 'by', 'via',
  'new', 'old', 'raw', 'tmp', 'temp', 'stg', 'staging',
  'fact', 'dim', 'v', 'vw', 'tbl',
]);

// Column roles whose names carry meaningful domain signal (entity nouns).
const ENTITY_ROLES = new Set(['key', 'dimension', 'fk_ref']);

// ── Tokenizer ─────────────────────────────────────────────────────────────────

/**
 * Split a string on non-alphanumeric boundaries, lowercase, de-dupe.
 * "seafarer_contract" → ["seafarer", "contract"]
 * "one row per contract_id" → ["one", "row", "per", "contract", "id"]  (stopwords removed later)
 */
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && t.length <= 40);
}

/** Remove stopwords and return unique tokens. */
function clean(tokens: string[]): string[] {
  return [...new Set(tokens.filter((t) => !STOPWORDS.has(t)))];
}

// ── Strip trailing noun suffixes from column names ─────────────────────────────
// "vessel_id" → "vessel", "contract_code" → "contract"

const COL_SUFFIXES = ['_id', '_ids', '_ref', '_code', '_key', '_num', '_nr', '_no', '_at', '_ts'];

function stripColSuffix(name: string): string {
  for (const sfx of COL_SUFFIXES) {
    if (name.endsWith(sfx) && name.length > sfx.length + 2) {
      return name.slice(0, name.length - sfx.length);
    }
  }
  return name;
}

// ── Public input type ─────────────────────────────────────────────────────────

export interface KeywordExtractionInput {
  full_path: string;
  card: {
    summary: string;
    grain: string;
    entity?: string;
    key_columns?: string[];
    measures?: string[];
  };
  entity_tags?: { groups?: Array<{ label: string }> } | null;
  columns: Array<{
    name: string;
    semantic?: { role?: string; entity?: string } | null;
  }>;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Derive a deduplicated, stopword-filtered keyword array from stored T2 metadata.
 *
 * Sources (all zero-cost — derived from existing Aurora rows):
 *  1. Path segments  — object_name + schema_name from full_path
 *  2. entity field   — "seafarer_contract" → ["seafarer","contract"]
 *  3. grain text     — tokenized and cleaned
 *  4. entity_tags    — group labels
 *  5. Column names   — only those with ENTITY_ROLES (key/dimension/fk_ref),
 *                       suffix-stripped so "vessel_id" → "vessel"
 *  6. Column entity  — the per-column entity annotation from T2
 *
 * Intentionally excludes summary (too verbose, noisy for exact match) and
 * usage_patterns (intent strings, not domain nouns).
 */
export function extractDomainKeywords(input: KeywordExtractionInput): string[] {
  const accumulated: string[] = [];

  // 1. Path segments: object_name and schema_name
  //    "synergy_dwh.crew.seafarer_certificates" → ["crew", "seafarer", "certificates"]
  const pathParts = input.full_path.split('.');
  for (const part of pathParts.slice(1)) {
    // skip catalog (index 0), include schema + object
    accumulated.push(...tokenize(part));
  }

  // 2. Entity field from semantic card
  if (input.card.entity) {
    accumulated.push(...tokenize(input.card.entity));
  }

  // 3. Grain text — extract nouns from "one row per contract_id" → ["contract"]
  if (input.card.grain) {
    const grainTokens = tokenize(input.card.grain);
    // Strip _id suffix tokens so "contract_id" → "contract"
    for (const t of grainTokens) {
      const stripped = stripColSuffix(t);
      accumulated.push(stripped !== t ? stripped : t);
    }
  }

  // 4. entity_tags group labels
  if (input.entity_tags?.groups) {
    for (const grp of input.entity_tags.groups) {
      if (grp.label) accumulated.push(...tokenize(grp.label));
    }
  }

  // 5. Column names with entity-carrying roles (key / dimension / fk_ref)
  for (const col of input.columns) {
    const role = col.semantic?.role;
    if (role && ENTITY_ROLES.has(role)) {
      const stripped = stripColSuffix(col.name.toLowerCase());
      accumulated.push(...tokenize(stripped));
    }
  }

  // 6. Column-level entity annotations from T2
  for (const col of input.columns) {
    const entity = col.semantic?.entity;
    if (entity) accumulated.push(...tokenize(entity));
  }

  return clean(accumulated);
}

// ── Query tokenizer (used by routePrompt) ─────────────────────────────────────

/**
 * Tokenize a free-text user query into candidate domain keywords.
 * Same pipeline as extractDomainKeywords so tokens are directly comparable.
 *
 * "What crew certificates expire this month?" → ["crew", "certificates", "expire", "month"]
 */
export function tokenizeQuery(query: string): string[] {
  return clean(tokenize(query));
}
