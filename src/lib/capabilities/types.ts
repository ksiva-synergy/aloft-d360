import type { ZodType } from 'zod';

// Capability contracts: one provider-neutral description per operation a flow or agent may invoke.
// A connector (provider adapter) can expose many operations; each is registered separately so a
// connection never makes every provider operation available at once.
// This module is framework-free: no Next.js, Prisma or network imports.

export type SideEffect = 'none' | 'read' | 'write' | 'external';
export type RiskTier = 'low' | 'medium' | 'high';
/** `required` blocks publish unless an approval step runs before the call; `recommended` only warns. */
export type ApprovalRule = 'required' | 'recommended' | 'none';

export type CapabilityField = {
  /**
   * `literal`: must be fixed in the saved definition (no `{{refs}}`), so runtime data can never pick
   * the connection, method, channel or other control values. `data`: may be bound to step outputs.
   */
  binding: 'literal' | 'data';
  required?: boolean;
  /** Runtime egress check applied by the gateway after refs are resolved. */
  egress?: 'email' | 'http_path';
  description: string;
};

export type CapabilityClass = { sideEffect: SideEffect; risk: RiskTier; approval: ApprovalRule; requiredPermission: string };

export interface CapabilityDefinition {
  id: string;
  /** Semver. Published flows pin the exact version they were validated against. */
  version: string;
  title: string;
  description: string;
  provider: string;
  tags: string[];
  /** Default classification. `classify` may refine it from literal input (e.g. GET vs POST). */
  sideEffect: SideEffect;
  risk: RiskTier;
  approval: ApprovalRule;
  requiredPermission: string;
  classify?: (literalInput: Record<string, unknown>) => Partial<CapabilityClass>;
  fields: Record<string, CapabilityField>;
  /** Validates the fully resolved input at call time. */
  input: ZodType<Record<string, unknown>>;
  /**
   * Checks the saved (unresolved) input when the flow is validated, so a bad literal value is
   * reported while editing rather than only when a run calls it. Returns problems; empty when fine.
   */
  checkLiteral?: (literalInput: Record<string, unknown>) => string[];
  /** List-price estimate per call, used for budgets before anything runs. */
  estimatedCostUsd: number;
  /** `key`: the handler receives an idempotency key and must use it so a retried call has one effect. */
  idempotency: 'natural' | 'key';
  /** Plain-language summary of one call, used in explanations and run timelines. */
  describe: (input: Record<string, unknown>) => string;
  /** Deterministic mock used by simulation. Must not perform I/O. */
  simulate: (input: Record<string, unknown>) => unknown;
}

/** L0 catalog entry: what discovery and the UI see. No schemas, handlers or mocks. */
export type CapabilitySummary = Pick<
  CapabilityDefinition,
  'id' | 'version' | 'title' | 'description' | 'provider' | 'tags' | 'sideEffect' | 'risk' | 'approval' | 'requiredPermission'
>;

export function classifyCapability(def: CapabilityDefinition, literalInput: Record<string, unknown>): CapabilityClass {
  const base: CapabilityClass = {
    sideEffect: def.sideEffect,
    risk: def.risk,
    approval: def.approval,
    requiredPermission: def.requiredPermission,
  };
  return { ...base, ...(def.classify?.(literalInput) ?? {}) };
}

/** Who is acting and what the tenant allows. Built by the API layer from the session, never from the definition. */
export interface PolicyContext {
  actorId: string;
  tenantId: string;
  permissions: ReadonlySet<string>;
  egress: {
    /** Recipient domains allowed for outbound email; subdomains of an entry are allowed too. */
    emailDomains: readonly string[];
  };
  /**
   * Saved agents by slug, with their catalog status, when the caller loaded them. Lets the policy
   * check flag an unknown agent, or one that is not ready to run in a published flow. Absent: not checked.
   */
  agents?: ReadonlyMap<string, { name: string; status: string | null; hasInstructions?: boolean }>;
}
