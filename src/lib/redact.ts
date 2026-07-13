/**
 * Redacts sensitive keys from a payload before it is persisted to llm_calls.
 * Pass the result into traceLlmCall's requestPayload/responsePayload — never
 * the raw object. Extend DENY as you discover new sensitive field names.
 *
 * NOTE: This is the baseline defense. For payloads that must be retained in
 * full, envelope-encrypt with Azure Key Vault before write (see
 * MIGRATION_RUNBOOK Phase 5a) — that layer is intentionally NOT implemented yet.
 */
const DENY = [
  /api[-_]?key/i,
  /authorization/i,
  /password/i,
  /secret/i,
  /token/i,
  /ssn/i,
  /credit[-_]?card/i,
  /\bcvv\b/i,
];

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) =>
        DENY.some((re) => re.test(k)) ? [k, '[REDACTED]'] : [k, redact(v)],
      ),
    );
  }
  return value;
}
