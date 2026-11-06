import { z } from 'zod';

// Flow definition: the versioned JSON an LLM builder composes and the runner executes.
// Only typed, declarative steps exist; there is no step that evaluates code.

export const STEP_ID_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

const stepId = z.string().regex(STEP_ID_PATTERN, 'lowercase letters, digits and _; must start with a letter');

/** Strings may embed `{{steps.<id>.<path>}}` refs to earlier step outputs, or `{{inputs.<name>}}`. */
const text = z.string().min(1).max(8000);

export const TRANSFORM_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains'] as const;

const comparable = z.union([z.string(), z.number(), z.boolean()]);

/** Run the step only when the comparison holds; otherwise it and every step that reads it are skipped. */
const stepCondition = z.object({
  /** Exactly one ref, e.g. `{{steps.late.rowCount}}`. */
  ref: z.string().min(1).max(300),
  operator: z.enum(TRANSFORM_OPERATORS),
  value: comparable,
});

/** Steps that may repeat for each item of a list (validateFlow enforces it). */
export const FOR_EACH_STEP_TYPES = ['agent', 'tool'] as const;
export const FOR_EACH_MAX_ITEMS = 1000;

/**
 * Run the step once per item of a list. Inside the step, `{{item}}` / `{{item.<field>}}` is the
 * current item. Retries and the timeout apply per item. More items than `maxItems` fails the step
 * rather than silently skipping some.
 */
const stepForEach = z.object({
  /** Exactly one ref to a list, e.g. `{{steps.list_docs.objects}}`. */
  items: z.string().min(1).max(300),
  maxItems: z.number().int().min(1).max(FOR_EACH_MAX_ITEMS),
  concurrency: z.number().int().min(1).max(10).default(4),
});

const base = {
  id: stepId,
  name: z.string().max(120).optional(),
  dependsOn: z.array(stepId).default([]),
  retries: z.number().int().min(0).max(5).default(0),
  timeoutMs: z.number().int().min(1000).max(300_000).default(60_000),
  when: stepCondition.optional(),
  forEach: stepForEach.optional(),
};

/** Mirrors `SemanticQuery` in src/lib/semantic/types.ts so an executor can pass it to executeSemanticQuery unchanged. */
const semanticQuery = z.object({
  modelId: z.string().min(1),
  entityId: z.string().min(1),
  dimensions: z.array(z.object({ dimensionId: z.string().min(1), timeGrain: z.enum(['day', 'week', 'month', 'quarter', 'year']).optional() })).default([]),
  measures: z.array(z.object({ measureId: z.string().min(1) })).default([]),
  filters: z
    .array(
      z.object({
        fieldId: z.string().min(1),
        fieldKind: z.enum(['dimension', 'measure']),
        op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in', 'between', 'is_null', 'is_not_null']),
        value: z.unknown(),
      }),
    )
    .default([]),
  sorts: z.array(z.object({ fieldId: z.string().min(1), fieldKind: z.enum(['dimension', 'measure']), direction: z.enum(['asc', 'desc']) })).default([]),
  limit: z.number().int().min(1).max(10_000).optional(),
});

const queryStep = z.object({
  ...base,
  type: z.literal('query'),
  // Exactly one of `semantic` (governed, the default the builder should use) or `sql` (raw, read-only).
  config: z
    .object({
      semantic: semanticQuery.optional(),
      sql: text.optional(),
      connection: z.string().optional(),
      maxRows: z.number().int().min(1).max(10_000).default(1000),
    })
    .refine((c) => (c.semantic ? 1 : 0) + (c.sql ? 1 : 0) === 1, { message: 'set exactly one of "semantic" or "sql"' }),
});

const retrieveStep = z.object({
  ...base,
  type: z.literal('retrieve'),
  config: z.object({
    query: text,
    /** Knowledge bases to search (ids from /api/knowledge). The policy check requires at least one. */
    knowledgeBaseIds: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
    /** Older drafts only; not used. */
    namespace: z.string().optional(),
    topK: z.number().int().min(1).max(50).default(5),
  }),
});

const agentStep = z.object({
  ...base,
  type: z.literal('agent'),
  config: z.object({
    /** Slug of a commissioned agent; omitted means a single prompt step with no persona. */
    agentSlug: z.string().optional(),
    prompt: text,
    model: z.string().optional(),
    /**
     * Fields the answer must come back in: [{ key, label?, type: text|date|number, description }].
     * Later steps read them as {{steps.<id>.values.<key>}}. Checked by the policy check.
     */
    answer: z.array(z.record(z.unknown())).max(30).optional(),
  }),
});

const transformStep = z.object({
  ...base,
  type: z.literal('transform'),
  config: z.discriminatedUnion('op', [
    z.object({
      op: z.literal('filter'),
      /** Ref to an array of rows, e.g. `{{steps.find_overspend.rows}}`. */
      input: text,
      field: z.string().min(1).max(120),
      operator: z.enum(TRANSFORM_OPERATORS),
      value: comparable,
    }),
    z.object({ op: z.literal('limit'), input: text, count: z.number().int().min(1).max(10_000) }),
    z.object({ op: z.literal('count'), input: text }),
    z.object({
      /** Rows of `input` whose `key` has no match in `other` (by `otherKey`, default `key`). Reconciliation. */
      op: z.literal('anti_join'),
      input: text,
      other: text,
      key: z.string().min(1).max(120),
      otherKey: z.string().min(1).max(120).optional(),
    }),
  ]),
});

const approvalStep = z.object({
  ...base,
  type: z.literal('approval'),
  config: z.object({
    message: text,
    /** Email of the approver; omitted means the flow owner. */
    assignee: z.string().email().optional(),
  }),
});

// Phase 1 ships `save` only. `notify` (email/Slack) is Phase 3 and will be a new `kind`.
const outputStep = z.object({
  ...base,
  type: z.literal('output'),
  config: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('save'),
      title: z.string().min(1).max(200),
      content: text,
    }),
  ]),
});

/** Calls one operation from the capability registry (src/lib/capabilities) through the policy gateway. */
const toolStep = z.object({
  ...base,
  type: z.literal('tool'),
  config: z.object({
    capability: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, 'capability id such as "http.request"'),
    /** Exact version; omitted means the registry's current one, which publishing pins. */
    version: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
    input: z.record(z.unknown()),
  }),
});

export const flowStepSchema = z.discriminatedUnion('type', [
  queryStep,
  retrieveStep,
  agentStep,
  transformStep,
  approvalStep,
  outputStep,
  toolStep,
]);

export const flowTriggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('manual') }),
  z.object({
    type: z.literal('schedule'),
    /** Standard 5-field cron, evaluated in UTC. */
    cron: z.string().min(1).max(100),
  }),
  z.object({ type: z.literal('event'), name: z.string().min(1).max(100) }),
  /** External HTTP callback. Its payload is untrusted and is accepted only as the declared, typed inputs. */
  z.object({ type: z.literal('webhook'), name: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/) }),
]);

export const flowInputSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  type: z.enum(['string', 'number', 'boolean']),
  required: z.boolean().default(true),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  description: z.string().max(300).optional(),
});

export const flowDefinitionSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  trigger: flowTriggerSchema.default({ type: 'manual' }),
  inputs: z.array(flowInputSchema).max(20).default([]),
  /** Per-run spend limit, enforced before each paid call. */
  budget: z.object({ maxCostUsd: z.number().positive().max(1000) }).optional(),
  steps: z.array(flowStepSchema).min(1).max(40),
});

export type FlowStep = z.infer<typeof flowStepSchema>;
export type FlowStepType = FlowStep['type'];
export type FlowTrigger = z.infer<typeof flowTriggerSchema>;
export type StepCondition = z.infer<typeof stepCondition>;
export type StepForEach = z.infer<typeof stepForEach>;
export type TransformOperator = (typeof TRANSFORM_OPERATORS)[number];
export type FlowDefinition = z.infer<typeof flowDefinitionSchema>;

export const RUN_STATUSES = ['queued', 'running', 'waiting_approval', 'succeeded', 'failed', 'cancelled'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const STEP_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'skipped', 'waiting_approval'] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];
