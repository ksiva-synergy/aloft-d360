import type { ConstructionState } from './constructionState';

export type CatalogSyncSource = {
  name: string;
  slug: string | null;
  description: string | null;
  tags: string[];
  config: unknown;
};

export type CatalogSyncPatch = {
  name: string;
  description: string;
  tags: string[];
  tools: string[];
  config: Record<string, unknown>;
  agentClass: string | null;
  platformAgentId: string | null;
  runtimeSlug: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function workbenchSessionIdFromConfig(config: unknown): string | null {
  const source = asRecord(asRecord(config).source);
  return typeof source.workbenchSessionId === 'string' && source.workbenchSessionId
    ? source.workbenchSessionId
    : null;
}

export function agentClassFromConfig(config: unknown): string | null {
  const value = asRecord(config).agent_class;
  return typeof value === 'string' && value ? value : null;
}

/** Fields to write back onto the catalog (and platform) agent after a commissioned edit. Slug stays put. */
export function catalogSyncFromState(state: ConstructionState, catalog: CatalogSyncSource): CatalogSyncPatch {
  const prev = asRecord(catalog.config);
  const previousClass = typeof prev.agent_class === 'string' ? prev.agent_class : null;
  const agentClass = state.class?.id ?? null;
  const instructions = state.prompt.instructions.trim();
  const firstSentence = instructions.split(/(?<=[.!?])\s/)[0]?.slice(0, 280);
  const tags = [
    ...catalog.tags.filter((tag) => tag !== 'workbench' && tag !== previousClass && tag !== agentClass),
    ...(agentClass ? [agentClass] : []),
    'workbench',
  ];

  return {
    name: state.name?.trim() || catalog.name,
    description: state.prompt.persona?.trim() || firstSentence || catalog.description || catalog.name,
    tags,
    tools: state.tools.actions.map((action) => action.toolId),
    agentClass,
    platformAgentId: typeof prev.platformAgentId === 'string' ? prev.platformAgentId : null,
    runtimeSlug: catalog.slug ? `${catalog.slug}-runtime` : null,
    config: {
      ...prev,
      systemPrompt: state.prompt.instructions,
      persona: state.prompt.persona,
      agent_class: agentClass,
      datasources: state.tools.datasources,
      output: state.tools.output,
      validation: state.validation.lastTestRun,
      provenance: state.provenance,
    },
  };
}

export type RuntimeDatasource = { kind: string; ref: string; scope: string | null };

/** Instructions and sources stored on a commissioned catalog row, ready for a live chat. */
export function runtimeBriefFromCatalog(agent: { name: string; config: unknown }): {
  name: string;
  persona: string | null;
  instructions: string;
  datasources: RuntimeDatasource[];
} | null {
  const config = asRecord(agent.config);
  const instructions = typeof config.systemPrompt === 'string' ? config.systemPrompt.trim() : '';
  if (instructions.length < 20) return null;
  const datasources = Array.isArray(config.datasources)
    ? config.datasources.flatMap((item): RuntimeDatasource[] => {
        const row = asRecord(item);
        if (typeof row.kind !== 'string' || typeof row.ref !== 'string') return [];
        return [{ kind: row.kind, ref: row.ref, scope: typeof row.scope === 'string' ? row.scope : null }];
      })
    : [];
  return {
    name: agent.name,
    persona: typeof config.persona === 'string' ? config.persona : null,
    instructions,
    datasources,
  };
}
