import type { CapabilityDefinition, CapabilitySummary } from './types';
import { BUILTIN_CAPABILITIES } from './builtin';

export interface CapabilityRegistry {
  /** Exact version when given, otherwise the highest registered version. */
  get(id: string, version?: string): CapabilityDefinition | undefined;
  /** L0 catalog: one summary per capability id (latest version). */
  list(): CapabilitySummary[];
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

export function createCapabilityRegistry(defs: readonly CapabilityDefinition[]): CapabilityRegistry {
  const byId = new Map<string, CapabilityDefinition[]>();
  for (const def of defs) {
    const versions = byId.get(def.id) ?? [];
    if (versions.some((v) => v.version === def.version)) throw new Error(`capability ${def.id}@${def.version} registered twice`);
    versions.push(def);
    versions.sort((a, b) => compareSemver(b.version, a.version));
    byId.set(def.id, versions);
  }
  return {
    get: (id, version) => {
      const versions = byId.get(id);
      return version ? versions?.find((v) => v.version === version) : versions?.[0];
    },
    list: () =>
      [...byId.values()].map(([d]) => ({
        id: d!.id,
        version: d!.version,
        title: d!.title,
        description: d!.description,
        provider: d!.provider,
        tags: d!.tags,
        sideEffect: d!.sideEffect,
        risk: d!.risk,
        approval: d!.approval,
        requiredPermission: d!.requiredPermission,
      })),
  };
}

export const builtinCapabilityRegistry = createCapabilityRegistry(BUILTIN_CAPABILITIES);
