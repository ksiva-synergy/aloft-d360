import { classifyCapability, type CapabilityDefinition, type PolicyContext } from './types';

// The single call path for every capability invocation. Policy lives here, in code, and runs on
// every call after refs are resolved; nothing a model writes or a document contains can skip it.

/** A deliberate refusal. `retryable = false` tells the flow runner not to retry it. */
export class PolicyDeniedError extends Error {
  readonly retryable = false;
  constructor(
    public readonly code: 'permission' | 'invalid_input' | 'egress' | 'budget' | 'not_enabled',
    message: string,
  ) {
    super(message);
    this.name = 'PolicyDeniedError';
  }
}

/** Tracks spend for one run and refuses calls that would exceed the limit. */
export class BudgetMeter {
  private spent = 0;
  constructor(public readonly limitUsd: number | undefined) {}
  get spentUsd(): number {
    return this.spent;
  }
  charge(usd: number, what: string): void {
    if (this.limitUsd !== undefined && this.spent + usd > this.limitUsd + 1e-9) {
      throw new PolicyDeniedError(
        'budget',
        `${what} would raise run cost to $${(this.spent + usd).toFixed(4)}, over the $${this.limitUsd.toFixed(2)} budget`,
      );
    }
    this.spent += usd;
  }
}

export type LiveHandler = (input: Record<string, unknown>, opts: { idempotencyKey: string; signal: AbortSignal }) => Promise<unknown>;

export type InvokeOptions = {
  def: CapabilityDefinition;
  /** Input with every ref resolved. */
  input: Record<string, unknown>;
  /** Input as saved in the definition, used to classify the call (e.g. HTTP method). */
  literalInput: Record<string, unknown>;
  policy: PolicyContext;
  mode: 'simulate' | 'live';
  idempotencyKey: string;
  budget: BudgetMeter;
  signal: AbortSignal;
  /** Live handlers by capability id. Absent in simulation. */
  handlers?: Record<string, LiveHandler>;
};

export type InvokeResult = { output: unknown; summary: string; mocked: boolean; costUsd: number };

function emailDomainAllowed(address: string, allowed: readonly string[]): boolean {
  const domain = address.slice(address.lastIndexOf('@') + 1).toLowerCase();
  return allowed.some((d) => {
    const a = d.toLowerCase().replace(/^\.+/, '');
    return domain === a || domain.endsWith(`.${a}`);
  });
}

/** Relative path only: no scheme, no protocol-relative `//host`, no `..` segments, no backslashes or whitespace. */
export function isSafeRelativePath(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//')) return false;
  if (/[\s\\]/.test(path) || path.includes('://')) return false;
  const pathOnly = path.split(/[?#]/)[0]!;
  return !pathOnly.split('/').some((seg) => seg === '..' || seg === '.' || /%2e%2e|%2f|%5c/i.test(seg));
}

function checkEgress(def: CapabilityDefinition, input: Record<string, unknown>, policy: PolicyContext): void {
  for (const [field, spec] of Object.entries(def.fields)) {
    const value = input[field];
    if (value === undefined || !spec.egress) continue;
    if (spec.egress === 'email') {
      const addresses = Array.isArray(value) ? value : [value];
      const refused = addresses.filter((a) => typeof a !== 'string' || !emailDomainAllowed(a, policy.egress.emailDomains));
      if (refused.length) {
        throw new PolicyDeniedError('egress', `recipient ${refused.map(String).join(', ')} is outside the allowed email domains`);
      }
    }
    if (spec.egress === 'http_path' && (typeof value !== 'string' || !isSafeRelativePath(value))) {
      throw new PolicyDeniedError('egress', `"${String(value)}" is not a safe relative path for this connection`);
    }
  }
}

export async function invokeCapability(opts: InvokeOptions): Promise<InvokeResult> {
  const { def, policy, mode } = opts;
  const cls = classifyCapability(def, opts.literalInput);

  // Static permission findings already block publishing. Live calls re-check here so a revoked
  // permission stops a scheduled run. Simulation touches no real system, so it reports instead.
  if (mode === 'live' && !policy.permissions.has(cls.requiredPermission)) {
    throw new PolicyDeniedError('permission', `${def.id} requires permission "${cls.requiredPermission}"`);
  }

  const parsed = def.input.safeParse(opts.input);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
    throw new PolicyDeniedError('invalid_input', `${def.id} input rejected: ${detail}`);
  }
  const input = parsed.data;
  checkEgress(def, input, policy);
  opts.budget.charge(def.estimatedCostUsd, def.id);

  const summary = def.describe(input);
  if (mode === 'simulate') return { output: def.simulate(input), summary, mocked: true, costUsd: def.estimatedCostUsd };

  const handler = opts.handlers?.[def.id];
  if (!handler) throw new PolicyDeniedError('not_enabled', `live execution of ${def.id} is not enabled in this environment`);
  const output = await handler(input, { idempotencyKey: opts.idempotencyKey, signal: opts.signal });
  return { output, summary, mocked: false, costUsd: def.estimatedCostUsd };
}
