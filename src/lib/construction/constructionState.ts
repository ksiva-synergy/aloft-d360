import { z } from 'zod';

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const classSchema = z.object({
  id: z.string().nullable().default(null),
  source: z.enum(['inferred', 'chosen']).nullable().default(null),
  confidence: z.number().min(0).max(1).nullable().default(null),
  skillRef: z.string().nullable().default(null),
}).nullable().default(null);

const promptSchema = z.object({
  useCaseTag: z.string().nullable().default(null),
  templateRef: z.string().nullable().default(null),
  instructions: z.string().default(''),
  persona: z.string().nullable().default(null),
  techniques: z.array(z.string()).default([]),
  coachScore: z.number().nullable().default(null),
  lint: z.array(z.object({
    rule: z.string(),
    severity: z.string(),
    passed: z.boolean(),
  })).default([]),
}).default({});

const toolsSchema = z.object({
  datasources: z.array(z.object({
    kind: z.enum(['kb', 'databricks', 'mcp', 'api']),
    ref: z.string(),
    scope: z.string().nullable().default(null),
  })).default([]),
  actions: z.array(z.object({
    toolId: z.string(),
    tier: z.enum(['local', 'mcp', 'governed', 'skill']),
  })).default([]),
  output: z.object({
    schemaRef: z.string().nullable().default(null),
    examples: z.array(z.any()).default([]),
  }).default({}),
}).default({});

const memorySchema = z.object({
  buildContext: z.object({
    userRole: z.string().nullable().default(null),
    orgId: z.string(),               // required — always getDefaultOrg().id
    projectId: z.string().nullable().default(null),
    accessibleDatasources: z.array(z.string()).default([]),
    dataAccessScope: z.string().nullable().default(null),
    operatingEnvironment: z.string().nullable().default(null),
  }),
  runtimeProvision: z.object({      // null until derived at commission (R3)
    kbNamespace: z.string().nullable().default(null),
    exemplarSet: z.string().nullable().default(null),
    threadPolicy: z.string().nullable().default(null),
    retrievalScope: z.string().nullable().default(null),
  }).nullable().default(null),
});

// ─── Root schema ─────────────────────────────────────────────────────────────

export const constructionStateSchema = z.object({
  modality: z.enum(['nl', 'guided']).nullable().default(null),
  name: z.string().nullable().default(null),  // set by build assistant (R5 NL flow); null until named
  class: classSchema,
  prompt: promptSchema,
  tools: toolsSchema,
  memory: memorySchema,
  readiness: z.enum(['interview', 'plan', 'build', 'validate', 'commission']).default('interview'),
  assumptionLedger: z.array(z.object({
    field: z.string(),
    value: z.any(),
    confidence: z.number().min(0).max(1),
    status: z.enum(['assumed', 'confirmed', 'corrected']),
    rationale: z.string(),
  })).default([]),
  provenance: z.record(z.enum(['ai', 'user', 'template'])).default({}),
});

export type ConstructionState = z.infer<typeof constructionStateSchema>;
