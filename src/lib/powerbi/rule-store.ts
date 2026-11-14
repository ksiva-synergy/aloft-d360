import 'server-only';

import prisma from '@/lib/db';
import {
  buildRuleSet,
  type RuleKind,
  type RuleResultKind,
  type RuleSet,
  type RuleStatus,
  type TranslationRule,
} from '@/lib/powerbi/rule-registry';

/** Verified / promoted rules of an org, as the compiler consumes them. */
export async function loadRuleSet(orgId: string): Promise<RuleSet> {
  const rows = await prisma.pbiTranslationRule.findMany({
    where: { org_id: orgId, status: { in: ['verified', 'promoted'] } },
    select: { kind: true, name: true, arity: true, sql_template: true, result_kind: true, status: true },
  });
  return buildRuleSet(
    rows.map(
      (r): TranslationRule => ({
        kind: r.kind as RuleKind,
        name: r.name,
        arity: r.arity,
        sqlTemplate: r.sql_template,
        resultKind: r.result_kind as RuleResultKind,
        status: r.status as RuleStatus,
      }),
    ),
  );
}

export async function saveRule(input: {
  orgId: string;
  rule: TranslationRule;
  source: 'llm' | 'seed' | 'human';
  argSpecs: unknown;
  evidence: unknown;
  modelUsed?: string | null;
  promptVersion?: string | null;
  attempts: number;
}): Promise<void> {
  const { orgId, rule } = input;
  const data = {
    sql_template: rule.sqlTemplate,
    result_kind: rule.resultKind,
    status: rule.status,
    source: input.source,
    arg_specs: input.argSpecs as object,
    evidence: input.evidence as object,
    model_used: input.modelUsed ?? null,
    prompt_version: input.promptVersion ?? null,
    attempts: input.attempts,
    verified_at: rule.status === 'verified' || rule.status === 'promoted' ? new Date() : null,
  };
  await prisma.pbiTranslationRule.upsert({
    where: {
      org_id_kind_name_arity: { org_id: orgId, kind: rule.kind, name: rule.name, arity: rule.arity },
    },
    create: { org_id: orgId, kind: rule.kind, name: rule.name, arity: rule.arity, ...data },
    update: data,
  });
}
