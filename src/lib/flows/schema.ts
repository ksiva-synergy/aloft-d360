import { z } from 'zod';

// Flow definition: the versioned JSON an LLM builder composes and the runner executes.
// Only typed, declarative steps exist; there is no step that evaluates code.

export const STEP_ID_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

const stepId = z.string().regex(STEP_ID_PATTERN, 'lowercase letters, digits and _; must start with a letter');

/** Strings may embed `{{steps.<id>.<path>}}` refs to earlier step outputs, or `{{inputs.<name>}}`. */
const text = z.string().min(1).max(8000);

const base = {
  id: stepId,
  name: z.string().max(120).optional(),
  dependsOn: z.array(stepId).default([]),
  retries: z.number().int().min(0).max(5).default(0),
  timeoutMs: z.number().int().min(1000).max(300_000).default(60_000),
};

const queryStep = z.object({
  ...base,
  type: z.literal('query'),
  config: z.object({
    sql: text,
    connection: z.string().optional(),
    maxRows: z.number().int().min(1).max(10_000).default(1000),
  }),
});

const retrieveStep = z.object({
  ...base,
  type: z.literal('retrieve'),
  config: z.object({
    query: text,
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
  }),
});

export const TRANSFORM_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains'] as const;

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
      value: z.union([z.string(), z.number(), z.boolean()]),
    }),
    z.object({ op: z.literal('limit'), input: text, count: z.number().int().min(1).max(10_000) }),
    z.object({ op: z.literal('count'), input: text }),
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

export const flowStepSchema = z.discriminatedUnion('type', [
  queryStep,
  retrieveStep,
  agentStep,
  transformStep,
  approvalStep,
  outputStep,
]);

export const flowTriggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('manual') }),
  z.object({
    type: z.literal('schedule'),
    /** Standard 5-field cron, evaluated in UTC. */
    cron: z.string().min(1).max(100),
  }),
  z.object({ type: z.literal('event'), name: z.string().min(1).max(100) }),
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
  steps: z.array(flowStepSchema).min(1).max(40),
});

export type FlowStep = z.infer<typeof flowStepSchema>;
export type FlowStepType = FlowStep['type'];
export type FlowTrigger = z.infer<typeof flowTriggerSchema>;
export type FlowDefinition = z.infer<typeof flowDefinitionSchema>;

export const RUN_STATUSES = ['queued', 'running', 'waiting_approval', 'succeeded', 'failed', 'cancelled'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const STEP_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'skipped', 'waiting_approval'] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];
