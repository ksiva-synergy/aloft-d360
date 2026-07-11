import { z } from 'zod';

export type ArtifactType = 'agent' | 'tool' | 'schema' | 'prompt' | 'bus_contract';

const catalogStatusEnum = z.enum(['draft', 'in_review', 'published', 'deprecated']);

// ─── Agent Draft (preserved from agentDraftSchema.ts) ───

export const agentDraftSchema = z.object({
  name: z.string().min(1, 'Agent name is required').max(120, 'Name must be 120 characters or fewer'),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase alphanumeric with dashes').optional(),
  type: z.string().min(1, 'Agent type is required'),
  description: z.string().nullable().default(null),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must follow semver').default('1.0.0'),
  config: z.object({
    model: z.string().nullable().optional(),
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().int().positive().optional(),
    systemPrompt: z.string().optional(),
  }).catchall(z.unknown()).default({}),
  tools: z.array(z.string()).default([]),
  // Real knowledge source bindings (UUIDs from knowledge_sources table, not tags).
  knowledge_source_ids: z.array(z.string()).default([]),
  input_schema: z.string().nullable().default(null),
  output_schema: z.string().nullable().default(null),
  bus_subscriptions: z.array(z.string()).default([]),
  bus_publications: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  status: catalogStatusEnum.default('draft'),
  author: z.string().nullable().default(null),
});

// ─── Tool Draft ───

export const toolDraftSchema = z.object({
  name: z.string().min(1, 'Tool name is required'),
  slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
  description: z.string().nullable().default(null),
  version: z.string().default('1.0.0'),
  language: z.enum(['typescript', 'python']).default('typescript'),
  code: z.string().default(''),
  input_schema: z.object({}).passthrough().nullable().default(null),
  output_schema: z.object({}).passthrough().nullable().default(null),
  dependencies: z.array(z.string()).default([]),
  timeout_ms: z.number().default(15000),
  tags: z.array(z.string()).default([]),
  status: catalogStatusEnum.default('draft'),
  author: z.string().nullable().default(null),
  test_cases: z.array(z.object({
    name: z.string(),
    input: z.unknown(),
    expected_output: z.unknown().optional(),
  })).default([]),
});

// ─── Schema Draft ───

export const schemaDraftSchema = z.object({
  schema_ref: z.string().regex(/^[A-Za-z]+@\d+\.\d+$/, 'Must be Name@Major.Minor').default(''),
  json_schema: z.object({}).passthrough().default({}),
  description: z.string().nullable().default(null),
  breaking_change: z.boolean().default(false),
  migration_fn: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  status: catalogStatusEnum.default('draft'),
  author: z.string().nullable().default(null),
});

// ─── Prompt Draft ───

export const promptDraftSchema = z.object({
  name: z.string().min(1, 'Prompt name is required'),
  slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
  template: z.string().min(1, 'Template is required').default(''),
  variables: z.array(z.object({
    name: z.string(),
    type: z.enum(['string', 'number', 'boolean', 'json']),
    default: z.unknown().optional(),
    description: z.string().optional(),
  })).default([]),
  few_shot_examples: z.array(z.object({
    input: z.unknown(),
    expected_output: z.unknown(),
    tags: z.array(z.string()).optional(),
  })).default([]),
  eval_criteria: z.array(z.object({
    criterion: z.string(),
    weight: z.number().min(0).max(1),
    threshold: z.number().min(0).max(1),
  })).default([]),
  version: z.string().default('1.0.0'),
  linked_agent_ids: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  status: catalogStatusEnum.default('draft'),
  author: z.string().nullable().default(null),
});

// ─── Bus Contract Draft ───

export const busContractDraftSchema = z.object({
  name: z.string().min(1, 'Contract name is required'),
  slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
  schema_ref: z.string().regex(/^[A-Za-z]+@\d+\.\d+$/, 'Must be Name@Major.Minor').default(''),
  message_type: z.enum(['REQUEST', 'RESPONSE', 'ERROR', 'BROADCAST', 'PATCH_REQUEST', 'HEARTBEAT']).default('REQUEST'),
  sender_agent_type: z.string().nullable().default(null),
  receiver_agent_type: z.string().nullable().default(null),
  priority: z.enum(['NORMAL', 'HIGH', 'CRITICAL']).default('NORMAL'),
  ttl_ms: z.number().positive().optional(),
  payload_schema_id: z.string().nullable().default(null),
  version: z.string().default('1.0.0'),
  description: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  status: catalogStatusEnum.default('draft'),
  author: z.string().nullable().default(null),
});

// ─── Registry ───

export type AgentDraft = z.infer<typeof agentDraftSchema>;
export type ToolDraft = z.infer<typeof toolDraftSchema>;
export type SchemaDraft = z.infer<typeof schemaDraftSchema>;
export type PromptDraft = z.infer<typeof promptDraftSchema>;
export type BusContractDraft = z.infer<typeof busContractDraftSchema>;

export type ArtifactDraft = AgentDraft | ToolDraft | SchemaDraft | PromptDraft | BusContractDraft;

export const ARTIFACT_DRAFT_SCHEMAS: Record<ArtifactType, z.ZodSchema> = {
  agent: agentDraftSchema,
  tool: toolDraftSchema,
  schema: schemaDraftSchema,
  prompt: promptDraftSchema,
  bus_contract: busContractDraftSchema,
};

export interface DraftValidationError {
  field: string;
  message: string;
  severity: 'error' | 'warn';
}

export function validateArtifactDraft(type: ArtifactType, data: unknown) {
  return ARTIFACT_DRAFT_SCHEMAS[type].safeParse(data);
}

export function partialValidateArtifactDraft(type: ArtifactType, data: unknown) {
  const schema = ARTIFACT_DRAFT_SCHEMAS[type] as z.ZodObject<z.ZodRawShape>;
  return schema.partial().safeParse(data);
}

export function createEmptyDraft(type: ArtifactType): ArtifactDraft {
  switch (type) {
    case 'agent':
      return {
        name: '', type: '', description: null, version: '1.0.0',
        config: {}, tools: [], knowledge_source_ids: [], input_schema: null, output_schema: null,
        bus_subscriptions: [], bus_publications: [], tags: [], status: 'draft', author: null,
      };
    case 'tool':
      return {
        name: '', description: null, version: '1.0.0', language: 'typescript',
        code: '', input_schema: null, output_schema: null, dependencies: [],
        timeout_ms: 15000, tags: [], status: 'draft', author: null, test_cases: [],
      };
    case 'schema':
      return {
        schema_ref: '', json_schema: {}, description: null, breaking_change: false,
        migration_fn: null, tags: [], status: 'draft', author: null,
      };
    case 'prompt':
      return {
        name: '', template: '', variables: [], few_shot_examples: [],
        eval_criteria: [], version: '1.0.0', linked_agent_ids: [],
        tags: [], status: 'draft', author: null,
      };
    case 'bus_contract':
      return {
        name: '', schema_ref: '', message_type: 'REQUEST',
        sender_agent_type: null, receiver_agent_type: null,
        priority: 'NORMAL', version: '1.0.0', description: null,
        payload_schema_id: null, tags: [], status: 'draft', author: null,
      };
  }
}
