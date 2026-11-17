import 'server-only';

import { resolveDiffTestTarget, type DiffTestTarget } from '@/lib/powerbi/rule-difftest-run';
import { ruleKey, type RuleSet } from '@/lib/powerbi/rule-registry';
import { loadRuleSet } from '@/lib/powerbi/rule-store';
import { synthesizeDaxRule, type SynthesisOutcome } from '@/lib/powerbi/rule-synthesize';

export type GapFillResult = {
  filled: boolean;
  name: string;
  arity: number;
  /** `verified` includes a rule that was already in the set (no new LLM call). */
  status: 'verified' | 'rejected' | 'error';
  detail: string;
};

type Synthesize = (args: Parameters<typeof synthesizeDaxRule>[0]) => Promise<SynthesisOutcome>;

/**
 * Ask the LLM for one scalar DAX function, keep the template only when differential tests match
 * Power BI, and install that verified rule into `rules` so the compiler can use it immediately.
 */
export async function fillDaxFunctionGap(input: {
  orgId: string;
  name: string;
  arity: number;
  usageExample: string;
  rules: RuleSet;
  synthesize?: Synthesize;
  loadRules?: (orgId: string) => Promise<RuleSet>;
  resolveTarget?: (orgId: string) => Promise<DiffTestTarget>;
}): Promise<GapFillResult> {
  const name = input.name.toUpperCase();
  const key = ruleKey('dax_fn', name, input.arity);
  if (input.rules.has(key)) {
    return { filled: true, name, arity: input.arity, status: 'verified', detail: 'already in the registry' };
  }
  try {
    const target = await (input.resolveTarget ?? resolveDiffTestTarget)(input.orgId);
    const synth = await (input.synthesize ?? synthesizeDaxRule)({
      orgId: input.orgId,
      name,
      arity: input.arity,
      usageExamples: input.usageExample ? [input.usageExample] : [],
      target,
      existingRules: input.rules,
    });
    if (synth.status !== 'verified' || !synth.sqlTemplate) {
      return {
        filled: false,
        name,
        arity: input.arity,
        status: 'rejected',
        detail: synth.error ?? `rejected after ${synth.attempts} attempt(s)`,
      };
    }
    const fresh = await (input.loadRules ?? loadRuleSet)(input.orgId);
    const rule = fresh.get(key);
    if (!rule) {
      return { filled: false, name, arity: input.arity, status: 'error', detail: 'verified rule was not saved' };
    }
    input.rules.set(key, rule);
    return { filled: true, name, arity: input.arity, status: 'verified', detail: rule.sqlTemplate };
  } catch (e) {
    return {
      filled: false,
      name,
      arity: input.arity,
      status: 'error',
      detail: (e instanceof Error ? e.message : String(e)).slice(0, 300),
    };
  }
}

/** One synthesis per function per translate run, shared by every measure that hits the same gap. */
export function createDaxGapFiller(deps: {
  orgId: string;
  synthesize?: Synthesize;
  loadRules?: (orgId: string) => Promise<RuleSet>;
  resolveTarget?: (orgId: string) => Promise<DiffTestTarget>;
}) {
  const pending = new Map<string, Promise<GapFillResult>>();
  let synthesized = 0;
  let failed = 0;
  return {
    counts: () => ({ synthesized, failed }),
    request(input: { name: string; arity: number; usageExample: string; rules: RuleSet }) {
      const key = ruleKey('dax_fn', input.name, input.arity);
      let task = pending.get(key);
      if (!task) {
        task = fillDaxFunctionGap({ ...deps, ...input }).then((result) => {
          if (result.filled && result.detail !== 'already in the registry') synthesized += 1;
          else if (!result.filled) failed += 1;
          return result;
        });
        pending.set(key, task);
      }
      return task;
    },
  };
}
