/**
 * src/lib/dashboards/intent-resolve.ts
 *
 * Pure term-resolution logic for guided Stage 1 (Intent). No I/O, no React, no
 * Prisma — the server route feeds it the candidate field set and it classifies
 * each term into one of the four IntentResolution states. Kept pure so the
 * four-state classification and the top-K-cap distinction are unit-testable
 * without live embeddings or DB.
 *
 * The authoritative input is the *uncapped* governed+candidate field list from
 * the definitions endpoint. Because that list is uncapped, a governed field is
 * never dropped past a top-K cap on this path — so 'unrecognized' from the
 * deterministic pass is a true absence. The top-K cap only bites the optional
 * embedding assist (matchIntents), which is cap-aware: when it hits its limit
 * and the deterministic pass found nothing, we mark `cappedByTopK` instead of
 * asserting absence (Pin-2 trap).
 */
import type {
  IntentResolution,
  IntentCandidate,
  IntentDisambiguation,
} from './guided-types';

/** A field the resolver can match a term against. */
export interface ResolvableField {
  id: string;
  label: string;
  description?: string | null;
  /** Live governance status of the source definition. */
  status: string; // 'governed' | 'candidate' | 'draft' | ...
  kind: 'measure' | 'dimension';
  /** Optional governed synonyms (aliases) for the field. */
  synonyms?: string[];
}

/** Case/whitespace-insensitive normalization for matching. */
export function normalizeTerm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Does `field` match `term`? Exact label/synonym match, or a whole-term
 * containment either direction (so "accidents" matches "Accident count" and
 * "accident count" matches "accidents"). Deliberately conservative — fuzzy
 * ranking is the embedding assist's job, not this deterministic pass.
 */
export function fieldMatchesTerm(field: ResolvableField, term: string): boolean {
  const t = normalizeTerm(term);
  if (!t) return false;
  const haystacks = [field.label, ...(field.synonyms ?? [])].map(normalizeTerm);
  for (const h of haystacks) {
    if (!h) continue;
    if (h === t) return true;
    if (h.includes(t) || t.includes(h)) return true;
  }
  return false;
}

const GOVERNED = 'governed';

function toCandidate(f: ResolvableField): IntentCandidate {
  return { id: f.id, label: f.label, description: f.description ?? undefined };
}

/**
 * Classify one term given the fields that matched it (from the uncapped
 * definitions set) plus an optional signal that the embedding assist was
 * truncated at its top-K cap.
 *
 * Ordering of the four states is deliberate:
 *   1 governed match      → matched
 *   >1 governed matches    → ambiguous
 *   0 governed, ≥1 non-gov → not_governed  (real field, just not promoted)
 *   0 anywhere             → unrecognized   (+ cappedByTopK when absence unproven)
 */
export function classifyTerm(
  term: string,
  matches: ResolvableField[],
  opts: { embeddingTruncated?: boolean } = {},
): IntentDisambiguation {
  const governed = matches.filter((m) => m.status === GOVERNED);
  // A candidate (or any non-governed, non-draft) def that exists but isn't
  // promoted. Draft defs never reach the resolver (definitions endpoint excludes
  // them — owner-only), so anything here that isn't governed is "real but not
  // governed yet".
  const ungoverned = matches.filter((m) => m.status !== GOVERNED);

  if (governed.length === 1) {
    return {
      term,
      resolution: 'matched',
      candidates: [toCandidate(governed[0])],
      chosenId: governed[0].id,
    };
  }
  if (governed.length > 1) {
    return {
      term,
      resolution: 'ambiguous',
      candidates: governed.map(toCandidate),
    };
  }
  if (ungoverned.length >= 1) {
    return {
      term,
      resolution: 'not_governed',
      candidates: ungoverned.map(toCandidate),
    };
  }
  // Nothing matched anywhere. Only a TRUE absence if the embedding assist wasn't
  // truncated — otherwise a real match may live past the top-K cap.
  const disambig: IntentDisambiguation = {
    term,
    resolution: 'unrecognized',
    candidates: [],
  };
  if (opts.embeddingTruncated) disambig.cappedByTopK = true;
  return disambig;
}

/**
 * Extract candidate terms from a free-text topic. Naive but deterministic:
 * split on connective stopwords and punctuation, keep multi-word phrases. The
 * server may refine this, but keeping it here makes it testable and keeps the
 * client dumb.
 */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'by', 'in', 'on', 'with',
  'how', 'what', 'why', 'which', 'is', 'are', 'do', 'does', 'should', 'this',
  'that', 'help', 'me', 'us', 'understand', 'decide', 'see', 'show', 'my',
  'our', 'over', 'per', 'across', 'dashboard',
]);

export function extractTerms(topic: string): string[] {
  const cleaned = normalizeTerm(topic).replace(/[?.,!;:()"']/g, ' ');
  const words = cleaned.split(' ').filter(Boolean);
  const terms: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) {
      terms.push(buf.join(' '));
      buf = [];
    }
  };
  for (const w of words) {
    if (STOPWORDS.has(w)) {
      flush();
    } else {
      buf.push(w);
    }
  }
  flush();
  // Dedup, keep order.
  const seen = new Set<string>();
  return terms.filter((t) => {
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  });
}

/** Convenience re-export for consumers that only need the union. */
export type { IntentResolution };
