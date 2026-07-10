import { z } from 'zod';

// ── Discriminant enums ────────────────────────────────────────────────────────

export const NodeTypeValues = ['ACTION', 'OUTCOME', 'CORRECTION', 'SOURCE', 'DEAD_END'] as const;
export type NodeType = typeof NodeTypeValues[number];

export const EdgeTypeValues = ['LED_TO', 'CORRECTED_BY', 'DERIVED_FROM', 'CONTRADICTS'] as const;
export type EdgeType = typeof EdgeTypeValues[number];

// ── TracePayload ──────────────────────────────────────────────────────────────
// All fields are optional so each NodeType uses only the subset it needs.

export const TracePayloadSchema = z.object({
  toolName:        z.string().optional(),
  toolParams:      z.unknown().optional(),
  responseSummary: z.string().optional(),
  errorMessage:    z.string().optional(),
  sourceRef:       z.string().optional(),
  notes:           z.string().optional(),
  // Set by truncatePayload when the payload was shortened.
  _truncated:      z.boolean().optional(),
}).passthrough();

export type TracePayload = z.infer<typeof TracePayloadSchema>;

// ── Size guard ────────────────────────────────────────────────────────────────
// Truncates the longest string fields first until JSON representation fits
// within maxBytes. Sets _truncated = true when any trimming occurs.

export function truncatePayload(
  payload: TracePayload,
  maxBytes = 4096,
): TracePayload & { _truncated?: boolean } {
  const serialised = JSON.stringify(payload);
  if (serialised.length <= maxBytes) return payload;

  const mutable: Record<string, unknown> = { ...payload };

  // Gather string fields sorted longest-first (excluding _truncated itself).
  const stringFields = Object.entries(mutable)
    .filter((e): e is [string, string] => typeof e[1] === 'string' && e[0] !== '_truncated')
    .sort((a, b) => b[1].length - a[1].length);

  for (const [key] of stringFields) {
    const current = mutable[key] as string;
    // Halve the field iteratively until it fits or the field is empty.
    let shortened = current.slice(0, Math.floor(current.length / 2));
    mutable[key] = shortened;
    if (JSON.stringify(mutable).length <= maxBytes) break;
    // Still too large — continue to next field.
    while (JSON.stringify(mutable).length > maxBytes && shortened.length > 0) {
      shortened = shortened.slice(0, Math.floor(shortened.length / 2));
      mutable[key] = shortened;
    }
    if (JSON.stringify(mutable).length <= maxBytes) break;
  }

  mutable._truncated = true;
  return mutable as TracePayload & { _truncated: boolean };
}
