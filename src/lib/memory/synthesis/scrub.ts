/**
 * Bullet text PII / credential scrubber — deterministic, regex-based, no LLM.
 *
 * Called by curate() BEFORE embedQuery() and DB writes so that no sensitive
 * data ever reaches platform_agent_memory.rule_text or embed_text.
 *
 * COMPLIANCE: This is the single point of PII enforcement for the memory
 * synthesis pipeline (C4-lite invariant). Adding new pattern categories here
 * propagates automatically to both INSERT and SUPERSEDE write paths.
 *
 * Patterns scrubbed (ordered by specificity — most specific first):
 *   1. AWS access key IDs  (AKIA…)
 *   2. Bearer tokens
 *   3. Connection strings  (postgres://, mysql://, mongodb://, redis://)
 *   4. Email addresses
 *   5. IPv4 addresses
 *   6. IPv6 addresses      (must contain ≥ 2 colons to avoid false positives)
 *   7. Credit card numbers (13–19 digits, Luhn-validated)
 *   8. Long hex secrets    (≥ 32 contiguous hex chars — API keys, hashes)
 *
 * Patterns deliberately NOT scrubbed:
 *   - Short numeric IDs (schema OIDs, port numbers, row counts)
 *   - SQL identifiers and schema paths
 *   - Any text that does not match a credential / contact-data pattern
 */

// ── Luhn checksum validator ───────────────────────────────────────────────────

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i], 10);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

// ── Pattern table ─────────────────────────────────────────────────────────────

interface ScrubPattern {
  name:        string;
  pattern:     RegExp;
  replacement: string;
  // Optional post-match validator — if provided, skip redaction when it returns false
  validate?:   (match: string) => boolean;
}

const PATTERNS: ScrubPattern[] = [
  {
    name:        'aws_access_key',
    // AKIA followed by exactly 16 uppercase alphanumeric chars
    pattern:     /\bAKIA[0-9A-Z]{16}\b/g,
    replacement: '[REDACTED_KEY]',
  },
  {
    name:        'bearer_token',
    pattern:     /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
    replacement: 'Bearer [REDACTED_TOKEN]',
  },
  {
    name:        'connection_string',
    pattern:     /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"'`,]+/gi,
    replacement: '[REDACTED_CONN]',
  },
  {
    name:        'email',
    pattern:     /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    replacement: '[REDACTED_EMAIL]',
  },
  {
    name:        'ipv4',
    // Four decimal octets separated by dots — word-boundary anchored
    pattern:     /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: '[REDACTED_IP]',
    validate:    (m) => {
      // Reject if any octet > 255
      return m.split('.').every(o => parseInt(o, 10) <= 255);
    },
  },
  {
    name:        'ipv6',
    // Hex groups separated by colons; must contain at least 2 colons to avoid
    // false positives on short hex substrings used in schema identifiers.
    pattern:     /\b[0-9a-fA-F]{0,4}(?::[0-9a-fA-F]{0,4}){2,7}\b/g,
    replacement: '[REDACTED_IP]',
    validate:    (m) => (m.match(/:/g) ?? []).length >= 2,
  },
  {
    name:        'credit_card',
    // 13–19 consecutive digits, word-boundary anchored, Luhn-validated
    pattern:     /\b\d{13,19}\b/g,
    replacement: '[REDACTED_CC]',
    validate:    luhnValid,
  },
  {
    name:        'hex_secret',
    // 32+ contiguous lowercase or uppercase hex characters (API keys, SHA hashes, UUIDs without dashes)
    // UUID with dashes is excluded because word boundaries break on '-'
    pattern:     /\b[0-9a-fA-F]{32,}\b/g,
    replacement: '[REDACTED_HEX]',
  },
];

// ── Public API ────────────────────────────────────────────────────────────────

export interface ScrubResult {
  scrubbed:   string;
  redactions: number;
  categories: string[];   // which pattern names fired (deduplicated, for logging)
}

/**
 * Scrub PII and credential patterns from a memory bullet's rule text.
 *
 * Returns the cleaned text plus a count of redactions and the list of
 * pattern categories that fired — callers should log a warning when
 * redactions > 0 so that upstream prompt leakage is visible in logs.
 *
 * The function is pure and synchronous — safe to call in hot loops.
 */
export function scrubBulletText(text: string): ScrubResult {
  let result = text;
  let redactions = 0;
  const fired = new Set<string>();

  for (const { name, pattern, replacement, validate } of PATTERNS) {
    // Reset lastIndex because we reuse the regex object across calls
    pattern.lastIndex = 0;

    result = result.replace(pattern, (match) => {
      if (validate && !validate(match)) return match;
      redactions++;
      fired.add(name);
      return replacement;
    });

    // Always reset after replace() to avoid stateful lastIndex issues
    pattern.lastIndex = 0;
  }

  return { scrubbed: result, redactions, categories: Array.from(fired) };
}
