import { DEFAULT_LLM_LITE_GATEWAY_MODEL_ID } from './default-model';
import { toLlmLiteModelKey } from './keys';

/**
 * Every platform surface / background job that calls an LLM.
 * Centralized here so both runtime callers and the Models admin UI share a single source of truth.
 */
export type ModelFeatureId =
  | 'inspector_chat'
  | 'workbench_chat'
  | 'commissioned_agents'
  | 'automate_copilot'
  | 'harvest_semantic'
  | 'teach_reflect'
  | 'foer_synthesis'
  | 'session_titles'
  | 'boost_scorers';

export interface ModelFeatureSpec {
  id: ModelFeatureId;
  label: string;
  category: 'Interactive Chat' | 'Agent & Flow Authoring' | 'Data Estate & Memory' | 'Background & Evaluation';
  description: string;
  codeLocations: string[];
  defaultGatewayModelId: string;
  supportsUserPicker: boolean;
}

export const MODEL_FEATURES: readonly ModelFeatureSpec[] = [
  {
    id: 'inspector_chat',
    label: 'Inspector (Explore Data)',
    category: 'Interactive Chat',
    description: 'Interactive SQL & warehouse analysis chat, chart generation, and governed semantic queries.',
    codeLocations: ['src/app/api/inspector/chat/route.ts', 'src/hooks/useInspectorChat.ts'],
    defaultGatewayModelId: DEFAULT_LLM_LITE_GATEWAY_MODEL_ID,
    supportsUserPicker: true,
  },
  {
    id: 'commissioned_agents',
    label: 'Commissioned Agents & Automate Agent Steps',
    category: 'Interactive Chat',
    description: 'Live chat with published catalog agents and "Ask an agent" steps inside Automate flows.',
    codeLocations: ['src/app/api/agent-lab/agents/chat/route.ts', 'src/lib/agents/run-catalog-agent.ts'],
    defaultGatewayModelId: DEFAULT_LLM_LITE_GATEWAY_MODEL_ID,
    supportsUserPicker: true,
  },
  {
    id: 'workbench_chat',
    label: 'Agent Workbench & Test Runs',
    category: 'Agent & Flow Authoring',
    description: 'Conversational agent construction in Workbench and draft validation test runs.',
    codeLocations: [
      'src/app/api/agent-lab/workbench/chat/route.ts',
      'src/app/api/agent-lab/workbench/test-run/route.ts',
      'src/lib/construction/workbench-model.ts',
    ],
    defaultGatewayModelId: DEFAULT_LLM_LITE_GATEWAY_MODEL_ID,
    supportsUserPicker: true,
  },
  {
    id: 'automate_copilot',
    label: 'Automate Flow Copilot',
    category: 'Agent & Flow Authoring',
    description: 'Natural-language workflow builder that proposes and repairs Automate step graphs.',
    codeLocations: ['src/lib/flows-copilot/propose.ts', 'src/app/api/agent-lab/flows/copilot/route.ts'],
    defaultGatewayModelId: DEFAULT_LLM_LITE_GATEWAY_MODEL_ID,
    supportsUserPicker: false,
  },
  {
    id: 'harvest_semantic',
    label: 'Data Estate Harvest (T2 Semantic & T3 Usage)',
    category: 'Data Estate & Memory',
    description: 'Table/column semantic enrichment, usage narratives, and cross-silo relationship adjudication.',
    codeLocations: ['src/lib/context/harvest-llm.ts', 'src/lib/context/harvester-llm.ts'],
    defaultGatewayModelId: DEFAULT_LLM_LITE_GATEWAY_MODEL_ID,
    supportsUserPicker: false,
  },
  {
    id: 'teach_reflect',
    label: 'Teach & Marcus Reflection',
    category: 'Data Estate & Memory',
    description: 'Interactive domain-rule teaching sessions and automated trajectory reflection.',
    codeLocations: ['src/app/api/inspector/teach/route.ts', 'src/lib/marcus/reflect.ts'],
    defaultGatewayModelId: DEFAULT_LLM_LITE_GATEWAY_MODEL_ID,
    supportsUserPicker: false,
  },
  {
    id: 'foer_synthesis',
    label: 'FOER Memory Synthesis',
    category: 'Data Estate & Memory',
    description: 'Distills session trajectories into reusable operating-memory rules.',
    codeLocations: ['src/lib/memory/synthesis/reflect.ts'],
    defaultGatewayModelId: DEFAULT_LLM_LITE_GATEWAY_MODEL_ID,
    supportsUserPicker: false,
  },
  {
    id: 'session_titles',
    label: 'Session Titles & Recaps',
    category: 'Background & Evaluation',
    description: 'Generates concise conversation titles and factual session knowledge summaries.',
    codeLocations: [
      'src/app/api/agent-lab/workbench/generate-title/route.ts',
      'src/lib/inspector/session-knowledge-llm.ts',
    ],
    defaultGatewayModelId: DEFAULT_LLM_LITE_GATEWAY_MODEL_ID,
    supportsUserPicker: false,
  },
  {
    id: 'boost_scorers',
    label: 'Boost & Eval LLM Judges',
    category: 'Background & Evaluation',
    description: 'LLM-as-a-judge scorers for groundedness and semantic accuracy in evaluations.',
    codeLocations: ['src/lib/boost/scorers/llm-client.ts'],
    defaultGatewayModelId: DEFAULT_LLM_LITE_GATEWAY_MODEL_ID,
    supportsUserPicker: false,
  },
] as const;

export interface RoleModelPolicy {
  /**
   * 'all_enabled' -> Role can choose any admin-enabled LLM Lite model.
   * 'custom_list' -> Role can choose only from `allowedModelIds`.
   * 'locked_default' -> Role is locked to `defaultModelId` (no model switching).
   */
  mode: 'all_enabled' | 'custom_list' | 'locked_default';
  /** Default gateway model ID for this role. */
  defaultModelId: string;
  /** Allowed gateway model IDs when `mode === 'custom_list'`. */
  allowedModelIds: string[];
}

export interface RoleModelAccessConfig {
  /** Which roles see the full model picker in interactive chat surfaces. */
  fullPickerRoles: string[];
  /** Default gateway model forced for roles that do not have full picker access. */
  standardUserDefaultModelId: string;
  /** Per-role fine-grained model access policies (which models each role can use and its default). */
  rolePolicies?: Record<string, RoleModelPolicy>;
}

export interface PlatformModelSettings {
  /** Default gateway model ID (`aws_bedrock/xAI-Grok-4.7`) used across interactive surfaces. */
  defaultGatewayModelId: string;
  /** Per-feature gateway model ID overrides. */
  featureModels: Record<ModelFeatureId, string>;
  /** Gateway model IDs explicitly hidden from interactive UI pickers by an admin. */
  disabledGatewayModelIds: string[];
  /** Role access configuration for interactive model pickers. */
  roleAccess: RoleModelAccessConfig;
  updatedAt?: string;
  updatedBy?: string;
}

export function createDefaultModelSettings(): PlatformModelSettings {
  const featureModels = {} as Record<ModelFeatureId, string>;
  for (const f of MODEL_FEATURES) {
    featureModels[f.id] = f.defaultGatewayModelId;
  }
  return {
    defaultGatewayModelId: DEFAULT_LLM_LITE_GATEWAY_MODEL_ID,
    featureModels,
    disabledGatewayModelIds: [],
    roleAccess: {
      fullPickerRoles: ['platform_admin'],
      standardUserDefaultModelId: DEFAULT_LLM_LITE_GATEWAY_MODEL_ID,
      rolePolicies: {
        platform_admin: {
          mode: 'all_enabled',
          defaultModelId: DEFAULT_LLM_LITE_GATEWAY_MODEL_ID,
          allowedModelIds: [DEFAULT_LLM_LITE_GATEWAY_MODEL_ID],
        },
        admin: {
          mode: 'locked_default',
          defaultModelId: DEFAULT_LLM_LITE_GATEWAY_MODEL_ID,
          allowedModelIds: [DEFAULT_LLM_LITE_GATEWAY_MODEL_ID],
        },
        member: {
          mode: 'locked_default',
          defaultModelId: DEFAULT_LLM_LITE_GATEWAY_MODEL_ID,
          allowedModelIds: [DEFAULT_LLM_LITE_GATEWAY_MODEL_ID],
        },
        readonly: {
          mode: 'locked_default',
          defaultModelId: DEFAULT_LLM_LITE_GATEWAY_MODEL_ID,
          allowedModelIds: [DEFAULT_LLM_LITE_GATEWAY_MODEL_ID],
        },
      },
    },
  };
}

export function normalizeModelSettings(raw: unknown): PlatformModelSettings {
  const defaults = createDefaultModelSettings();
  if (!raw || typeof raw !== 'object') return defaults;
  const obj = raw as Record<string, unknown>;

  const defaultGatewayModelId =
    typeof obj.defaultGatewayModelId === 'string' && obj.defaultGatewayModelId.trim()
      ? obj.defaultGatewayModelId.trim()
      : defaults.defaultGatewayModelId;

  const featureModels: Record<ModelFeatureId, string> = { ...defaults.featureModels };
  if (obj.featureModels && typeof obj.featureModels === 'object') {
    const fm = obj.featureModels as Record<string, unknown>;
    for (const f of MODEL_FEATURES) {
      const val = fm[f.id];
      if (typeof val === 'string' && val.trim()) {
        featureModels[f.id] = val.trim();
      } else {
        featureModels[f.id] = defaultGatewayModelId;
      }
    }
  } else {
    for (const f of MODEL_FEATURES) {
      featureModels[f.id] = defaultGatewayModelId;
    }
  }

  const disabledGatewayModelIds = Array.isArray(obj.disabledGatewayModelIds)
    ? obj.disabledGatewayModelIds
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim())
    : [];

  let fullPickerRoles = defaults.roleAccess.fullPickerRoles;
  let standardUserDefaultModelId = defaultGatewayModelId;
  const rolePolicies: Record<string, RoleModelPolicy> = {
    ...(defaults.roleAccess.rolePolicies ?? {}),
  };

  if (obj.roleAccess && typeof obj.roleAccess === 'object') {
    const ra = obj.roleAccess as Record<string, unknown>;
    if (Array.isArray(ra.fullPickerRoles)) {
      const roles = ra.fullPickerRoles
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim());
      if (roles.length > 0) fullPickerRoles = roles;
    }
    if (typeof ra.standardUserDefaultModelId === 'string' && ra.standardUserDefaultModelId.trim()) {
      standardUserDefaultModelId = ra.standardUserDefaultModelId.trim();
    }

    // Sync legacy fields into default rolePolicies before applying explicit rolePolicies
    for (const rId of ['platform_admin', 'admin', 'member', 'readonly']) {
      const isFull = fullPickerRoles.includes(rId);
      rolePolicies[rId] = {
        mode: isFull ? 'all_enabled' : 'locked_default',
        defaultModelId: isFull ? defaultGatewayModelId : standardUserDefaultModelId,
        allowedModelIds: [isFull ? defaultGatewayModelId : standardUserDefaultModelId],
      };
    }

    if (ra.rolePolicies && typeof ra.rolePolicies === 'object') {
      const rp = ra.rolePolicies as Record<string, unknown>;
      for (const [roleId, rawPolicy] of Object.entries(rp)) {
        if (!rawPolicy || typeof rawPolicy !== 'object') continue;
        const p = rawPolicy as Record<string, unknown>;
        const mode: RoleModelPolicy['mode'] =
          p.mode === 'all_enabled' || p.mode === 'custom_list' || p.mode === 'locked_default'
            ? p.mode
            : fullPickerRoles.includes(roleId)
              ? 'all_enabled'
              : 'locked_default';
        const defaultModelId =
          typeof p.defaultModelId === 'string' && p.defaultModelId.trim()
            ? p.defaultModelId.trim()
            : standardUserDefaultModelId;
        const allowedModelIds = Array.isArray(p.allowedModelIds)
          ? p.allowedModelIds
              .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
              .map((x) => x.trim())
          : [defaultModelId];
        if (!allowedModelIds.includes(defaultModelId)) {
          allowedModelIds.unshift(defaultModelId);
        }
        rolePolicies[roleId] = {
          mode,
          defaultModelId,
          allowedModelIds,
        };
      }
    }

    // Keep fullPickerRoles in sync with rolePolicies for backward compatibility
    const derivedFullRoles = Object.entries(rolePolicies)
      .filter(([, pol]) => pol.mode === 'all_enabled')
      .map(([r]) => r);
    if (derivedFullRoles.length > 0) {
      fullPickerRoles = derivedFullRoles;
    }
  }

  return {
    defaultGatewayModelId,
    featureModels,
    disabledGatewayModelIds,
    roleAccess: {
      fullPickerRoles,
      standardUserDefaultModelId,
      rolePolicies,
    },
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : undefined,
    updatedBy: typeof obj.updatedBy === 'string' ? obj.updatedBy : undefined,
  };
}

export function defaultModelKeyFromSettings(settings: PlatformModelSettings): string {
  return toLlmLiteModelKey(settings.defaultGatewayModelId);
}
