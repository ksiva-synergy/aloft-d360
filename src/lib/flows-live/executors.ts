import { runCatalogAgent, AgentRunError } from '@/lib/agents/run-catalog-agent';
import type { CustomField } from '@/lib/extraction/schemas';
import { searchForUser } from '@/lib/knowledge/service';
import type { KnowledgeActor } from '@/lib/knowledge/access';
import { BudgetMeter, PolicyDeniedError } from '@/lib/capabilities/gateway';
import { applyTransform } from '@/lib/flows/transforms';
import type { StepExecutors } from '@/lib/flows/runner';

// Live step executors for real runs (the simulator has mocked ones). Each uses an existing, governed
// backend. Steps with no live backend yet (raw/semantic `query`, `tool`) fail clearly instead of
// pretending to run; `approval` pauses the run.

export type RunUsage = { tokens: number; costUsd: number };

/** Errors that must not be retried: the same call would fail the same way. */
const permanent = (message: string) => Object.assign(new Error(message), { retryable: false as const });

export function createLiveExecutors(opts: {
  actor: KnowledgeActor;
  meter: BudgetMeter;
  /** Filled in as steps spend; the run service writes it onto the run row. */
  usage: RunUsage;
}): StepExecutors {
  const { actor, meter, usage } = opts;

  return {
    agent: async (step, resolved) => {
      const { agentSlug, prompt, model, answer } = resolved.config;
      if (!agentSlug) throw permanent(`step "${step.id}": pick a saved agent. Single-prompt steps cannot run live yet`);
      // Stop before spending more once the run is at its budget.
      if (meter.limitUsd !== undefined && meter.spentUsd >= meter.limitUsd) {
        throw new PolicyDeniedError('budget', `run budget of $${meter.limitUsd.toFixed(2)} is used up`);
      }
      let result: Awaited<ReturnType<typeof runCatalogAgent>>;
      try {
        result = await runCatalogAgent({
          slug: agentSlug,
          message: prompt,
          role: actor.role,
          model,
          answer: answer as CustomField[] | undefined,
          surface: 'automation',
          person: { userId: actor.userId, role: actor.role },
        });
      } catch (e) {
        // 4xx from the agent runner (missing agent, bad fields) will not change on retry.
        if (e instanceof AgentRunError && e.status < 500) throw permanent(e.message);
        throw e;
      }
      usage.tokens += result.usage.inputTokens + result.usage.outputTokens;
      usage.costUsd += result.costUsd;
      meter.charge(result.costUsd, `agent step "${step.id}"`);
      if (result.outcome !== 'completed') throw new Error(result.errorDetail ?? `the agent did not finish (${result.outcome})`);
      return {
        kind: 'done',
        output: {
          text: result.text,
          ...(result.answer ? { values: result.answer.values, missing: result.answer.missing, issues: result.answer.issues, notes: result.answer.notes } : {}),
          agent: result.agent.slug,
          model: result.model,
          turnId: result.turnId,
        },
      };
    },

    retrieve: async (step, resolved) => {
      const { query, knowledgeBaseIds, topK } = resolved.config;
      const chunks = await searchForUser(actor, { question: query, knowledgeBaseIds, limit: topK, surface: 'automation' });
      return { kind: 'done', output: { chunks } };
    },

    transform: async (_step, resolved) => ({ kind: 'done', output: applyTransform(resolved.config) }),

    // Phase 1 "save": the titled content is stored as this step's output, shown in run history.
    output: async (_step, resolved) => ({
      kind: 'done',
      output: { saved: true, title: resolved.config.title, content: resolved.config.content },
    }),

    approval: async () => ({ kind: 'wait_approval' }),

    query: async (step) => {
      throw permanent(`step "${step.id}": data queries cannot run live yet (the semantic query executor is not built)`);
    },
    tool: async (step) => {
      throw permanent(`step "${step.id}": connector steps cannot run live yet (no live handlers are registered)`);
    },
  };
}
