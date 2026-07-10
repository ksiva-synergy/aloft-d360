export type CatalogStatus = 'draft' | 'in_review' | 'published' | 'deprecated';

export interface LineageFields {
  parent_id: string | null;
  is_head: boolean;
  draft_of_id: string | null;
  owner_id: string | null;
  reviewers: string[];
  policy_ids: string[];
}

export interface AgentCatalogEntry extends Partial<LineageFields> {
  id: string;
  name: string;
  slug: string;
  type: string;
  description: string | null;
  version: string;
  config: Record<string, any>;
  tools: string[];
  input_schema: string | null;
  output_schema: string | null;
  bus_subscriptions: string[];
  bus_publications: string[];
  tags: string[];
  status: CatalogStatus;
  author: string | null;
  created_at: string;
  updated_at: string;
}

export type ToolType =
  | 'api_call'
  | 'db_query'
  | 'file_op'
  | 'transform'
  | 'validation'
  | 'custom'
  | 'output'
  | 'input'
  | 'routing'
  | 'control';

export interface ToolCatalogEntry {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  version: string;
  type: ToolType;
  config: Record<string, any>;
  input_schema: Record<string, any> | null;
  output_schema: Record<string, any> | null;
  tags: string[];
  status: CatalogStatus;
  author: string | null;
  created_at: string;
  updated_at: string;
}

export interface SchemaCatalogEntry {
  id: string;
  name: string;
  slug: string;
  version: string;
  description: string | null;
  schema: Record<string, any>;
  examples: Record<string, any> | null;
  tags: string[];
  status: CatalogStatus;
  author: string | null;
  created_at: string;
  updated_at: string;
}

export interface SchemaCatalogSummary {
  id: string;
  name: string;
  description: string | null;
  owner: string | null;
  status: string | null;
  tags: string[];
  slug: string | null;
  latestVersion: string | null;
  latestUpdatedAt: string | null;
  producerCount: number;
  consumerCount: number;
}

export type BusModuleType = 'pub_sub' | 'request_reply' | 'broadcast' | 'dead_letter';

export interface BusModuleCatalogEntry {
  id: string;
  name: string;
  slug: string;
  version: string;
  description: string | null;
  topic_pattern: string;
  message_schema: string | null;
  config: Record<string, any>;
  type: BusModuleType;
  tags: string[];
  status: CatalogStatus;
  author: string | null;
  created_at: string;
  updated_at: string;
}

export interface PromptCatalogEntry {
  id: string;
  name: string;
  slug: string | null;
  template: string;
  variables: string[];
  few_shot_examples: Record<string, any>[];
  eval_criteria: string[];
  version: string;
  parent_version_id: string | null;
  linked_agent_ids: string[];
  author: string | null;
  status: CatalogStatus;
  tags: string[];
  token_estimate: number | null;
  source?: string | null;
  category?: string | null;
  created_at: string;
  updated_at: string;
}

export type CatalogEntry =
  | AgentCatalogEntry
  | ToolCatalogEntry
  | SchemaCatalogEntry
  | BusModuleCatalogEntry
  | PromptCatalogEntry;
