/**
 * Rule registry: DAX / Power Query function translations stored as data (SQL templates with
 * positional placeholders), synthesized or seeded and proven by differential testing against
 * Power BI before the compiler may use them. Pure — no DB access.
 */

export type RuleKind = 'dax_fn' | 'm_fn';
export type RuleStatus = 'candidate' | 'verified' | 'promoted' | 'rejected';
export type RuleResultKind = 'number' | 'string' | 'date' | 'bool' | 'unknown';

export type TranslationRule = {
  kind: RuleKind;
  name: string;
  arity: number;
  sqlTemplate: string;
  resultKind: RuleResultKind;
  status: RuleStatus;
};

/** Rules the compiler may apply. */
export type RuleSet = Map<string, TranslationRule>;

export function ruleKey(kind: RuleKind, name: string, arity: number): string {
  const n = kind === 'dax_fn' ? name.toUpperCase() : name.toLowerCase();
  return `${kind}:${n}/${arity}`;
}

export function buildRuleSet(rules: TranslationRule[]): RuleSet {
  const set: RuleSet = new Map();
  for (const r of rules) {
    if (r.status !== 'verified' && r.status !== 'promoted') continue;
    set.set(ruleKey(r.kind, r.name, r.arity), r);
  }
  return set;
}

const FORBIDDEN = /;|--|\/\*|\b(select|from|insert|update|delete|drop|create|alter|merge|grant|union)\b/i;

/**
 * A template must be one scalar Spark SQL expression over its placeholders {0}…{n-1}:
 * no statements, subqueries or comments, and every placeholder in range.
 */
export function validateTemplate(template: string, arity: number): string | null {
  const t = template.trim();
  if (!t) return 'empty template';
  if (FORBIDDEN.test(t.replace(/'(?:[^'\\]|\\.)*'/g, "''"))) {
    return 'template must be a single scalar expression (no statements, subqueries or comments)';
  }
  const used = [...t.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]));
  if (used.some((i) => i >= arity)) return `placeholder out of range for arity ${arity}`;
  let depth = 0;
  for (const c of t.replace(/'(?:[^'\\]|\\.)*'/g, "''")) {
    if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    if (depth < 0) return 'unbalanced parentheses';
  }
  if (depth !== 0) return 'unbalanced parentheses';
  return null;
}

/** Substitute compiled argument SQL; each argument is parenthesized to keep precedence. */
export function renderTemplate(template: string, args: string[]): string {
  return `(${template.replace(/\{(\d+)\}/g, (_m, i: string) => `(${args[Number(i)] ?? 'NULL'})`)})`;
}

/** Missing-capability record, the unit the estate backlog is ranked by. */
export type CapabilityGap = {
  kind: 'dax_fn' | 'm_fn' | 'm_step' | 'table_expr' | 'semantic';
  name: string;
  arity?: number;
};
