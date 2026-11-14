import 'server-only';

import { z } from 'zod';

import { harvestLlmComplete } from '@/lib/context/harvest-llm';
import { getPbiTranslateLlmRouting } from '@/lib/powerbi/translate-llm';
import { extractJsonObject } from '@/lib/powerbi/translate-llm-validate';
import {
  buildRuleSet,
  validateTemplate,
  type RuleResultKind,
  type RuleSet,
  type TranslationRule,
} from '@/lib/powerbi/rule-registry';
import type { ArgSpec, DiffTestResult } from '@/lib/powerbi/rule-difftest';
import { runDifferentialTest, type DiffTestTarget } from '@/lib/powerbi/rule-difftest-run';
import { saveRule } from '@/lib/powerbi/rule-store';

export const RULE_SYNTH_PROMPT_VERSION = 'pbi-rule-synth-v1';
const MAX_ATTEMPTS = 3;

const SYSTEM_PROMPT = `You translate ONE Power BI DAX scalar function into a Databricks (Spark SQL) expression template.
Output strict JSON only: {"sql_template":"...","result_kind":"number|string|date|bool","arg_specs":[{"kind":"number|int|date|string|bool","literals":["..."]}],"notes":"..."}
Rules:
- sql_template is ONE scalar Spark SQL expression using {0}, {1}, … for the arguments in order. No SELECT, FROM, subqueries, semicolons or comments.
- Arguments arrive as SQL expressions; any of them may be NULL, which is DAX BLANK. Reproduce DAX semantics exactly, including how this function treats BLANK (often as 0 or "" — not NULL propagation), rounding modes, case-insensitive text comparison, and date boundaries.
- Dates arrive as TIMESTAMP. Use only built-in Spark SQL functions.
- arg_specs: one entry per argument giving its kind, so a test harness can generate edge-case inputs. When an argument is a constant in practice (format string, mode, unit, separator), give 2-5 representative raw DAX constant tokens in "literals" (e.g. ["1","2"] or ["\\"YYYY\\""]).
- If previous failures are given, fix the template so every listed case matches Power BI.`;

const SynthSchema = z.object({
  sql_template: z.string(),
  result_kind: z.enum(['number', 'string', 'date', 'bool']).catch('number'),
  arg_specs: z.array(
    z.object({
      kind: z.enum(['number', 'int', 'date', 'string', 'bool']),
      literals: z.array(z.string()).optional(),
    }),
  ),
  notes: z.string().nullish(),
});

export type SynthesisOutcome = {
  name: string;
  arity: number;
  status: 'verified' | 'rejected';
  attempts: number;
  sqlTemplate: string | null;
  lastResult: DiffTestResult | null;
  error?: string;
};

export async function synthesizeDaxRule(input: {
  orgId: string;
  name: string;
  arity: number;
  usageExamples: string[];
  target: DiffTestTarget;
  existingRules?: RuleSet;
}): Promise<SynthesisOutcome> {
  const routing = getPbiTranslateLlmRouting();
  const name = input.name.toUpperCase();
  const history: { template: string; failures: unknown[]; error?: string }[] = [];
  let lastResult: DiffTestResult | null = null;
  let template: string | null = null;
  let argSpecs: ArgSpec[] = [];
  let resultKind: RuleResultKind = 'number';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const user = JSON.stringify(
      {
        function: name,
        arity: input.arity,
        usage_examples_from_reports: input.usageExamples.slice(0, 5),
        previous_attempts: history,
      },
      null,
      2,
    );
    let parsed: z.infer<typeof SynthSchema>;
    try {
      const resp = await harvestLlmComplete(
        { system: SYSTEM_PROMPT, messages: [{ role: 'user', content: user }], maxTokens: 1500, temperature: 0.1 },
        routing,
      );
      parsed = SynthSchema.parse(JSON.parse(extractJsonObject(resp.text)));
    } catch (e) {
      history.push({ template: '', failures: [], error: `invalid LLM response: ${(e as Error).message.slice(0, 200)}` });
      continue;
    }
    template = parsed.sql_template.trim();
    argSpecs = parsed.arg_specs;
    resultKind = parsed.result_kind;
    if (argSpecs.length !== input.arity) {
      history.push({ template, failures: [], error: `arg_specs has ${argSpecs.length} entries, expected ${input.arity}` });
      continue;
    }
    const invalid = validateTemplate(template, input.arity);
    if (invalid) {
      history.push({ template, failures: [], error: invalid });
      continue;
    }
    const candidate: TranslationRule = {
      kind: 'dax_fn',
      name,
      arity: input.arity,
      sqlTemplate: template,
      resultKind,
      status: 'verified', // provisional, so the compiler applies it during the test only
    };
    const rules = new Map(input.existingRules ?? []);
    for (const [k, v] of buildRuleSet([candidate])) rules.set(k, v);
    lastResult = await runDifferentialTest({ target: input.target, spec: { name, args: argSpecs }, rules });
    if (lastResult.pass) {
      await saveRule({
        orgId: input.orgId,
        rule: candidate,
        source: 'llm',
        argSpecs,
        evidence: { compared: lastResult.compared, mismatches: 0, history },
        modelUsed: routing.modelId ?? null,
        promptVersion: RULE_SYNTH_PROMPT_VERSION,
        attempts: attempt,
      });
      return { name, arity: input.arity, status: 'verified', attempts: attempt, sqlTemplate: template, lastResult };
    }
    history.push({
      template,
      failures: lastResult.mismatches.slice(0, 12),
      error: lastResult.error,
    });
  }

  if (template) {
    await saveRule({
      orgId: input.orgId,
      rule: { kind: 'dax_fn', name, arity: input.arity, sqlTemplate: template, resultKind, status: 'rejected' },
      source: 'llm',
      argSpecs,
      evidence: { history, last: lastResult },
      modelUsed: routing.modelId ?? null,
      promptVersion: RULE_SYNTH_PROMPT_VERSION,
      attempts: MAX_ATTEMPTS,
    });
  }
  return {
    name,
    arity: input.arity,
    status: 'rejected',
    attempts: MAX_ATTEMPTS,
    sqlTemplate: template,
    lastResult,
    error: history[history.length - 1]?.error,
  };
}
