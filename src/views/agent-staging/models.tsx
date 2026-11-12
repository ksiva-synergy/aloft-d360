'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSectionLevel } from '@/lib/sections/useSectionLevels';
import {
  Activity,
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Code2,
  Cpu,
  Database,
  Eye,
  EyeOff,
  FileCode2,
  KeyRound,
  Layers,
  Loader2,
  Lock,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Wand2,
  Workflow,
  XCircle,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Chip, Segmented, btn, fieldInput, fieldShell } from '@/views/agent-lab/flows/ui';
import type {
  ModelFeatureId,
  ModelFeatureSpec,
  PlatformModelSettings,
  RoleModelPolicy,
} from '@/lib/llmlite/model-registry';
import type { LlmLiteCatalogEntry } from '@/lib/llmlite/fetch-models';
import type { EmbeddingConfigSummary } from '@/app/api/model-config/route';
import { EmbeddingsPanel } from './embeddings-panel';

interface GatewayDiagnostic {
  configured: boolean;
  baseUrl: string | null;
  reachable: boolean;
  latencyMs: number | null;
  error: string | null;
  entries: LlmLiteCatalogEntry[];
}

interface UsageRow {
  model: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  errors: number;
}

interface ModelConfigPayload {
  settings: PlatformModelSettings;
  features: ModelFeatureSpec[];
  gateway: GatewayDiagnostic;
  usage30d: UsageRow[];
  embeddings?: EmbeddingConfigSummary;
}

interface ProbeResult {
  ok: boolean;
  modelId: string;
  status?: number;
  resolvedModel?: string;
  latencyMs?: number;
  reply?: string;
  error?: string;
}

const ALL_ROLES = [
  {
    id: 'platform_admin',
    label: 'Platform Admin',
    desc: 'Full platform & governance control',
  },
  {
    id: 'admin',
    label: 'Admin',
    desc: 'Workspace & team administration',
  },
  {
    id: 'member',
    label: 'Member',
    desc: 'Standard builders & analysts',
  },
  {
    id: 'readonly',
    label: 'Read Only',
    desc: 'View-only consumers',
  },
] as const;

const CATEGORY_META: Record<
  ModelFeatureSpec['category'],
  {
    icon: typeof Sparkles;
    blurb: string;
    badgeTone: 'brand' | 'ok' | 'warn' | 'neutral';
  }
> = {
  'Interactive Chat': {
    icon: Bot,
    blurb: 'User-facing conversational surfaces with live streaming and optional model switching.',
    badgeTone: 'brand',
  },
  'Agent & Flow Authoring': {
    icon: Workflow,
    blurb: 'Studio and copilot surfaces that design agents, SQL pipelines, and governed workflows.',
    badgeTone: 'ok',
  },
  'Data Estate & Memory': {
    icon: Database,
    blurb: 'Semantic harvesting, schema enrichment, and long-term knowledge synthesis jobs.',
    badgeTone: 'warn',
  },
  'Background & Evaluation': {
    icon: Activity,
    blurb: 'Background quality scorers, title generators, and session summarization helpers.',
    badgeTone: 'neutral',
  },
};

function providerShortBadge(id: string): { vendor: string; route: string } {
  if (id.startsWith('aws_bedrock/')) {
    return { vendor: 'AWS Bedrock', route: id.replace(/^aws_bedrock\//, '') };
  }
  if (id.startsWith('azure_ai/')) {
    return { vendor: 'Azure Foundry', route: id.replace(/^azure_ai\//, '') };
  }
  return { vendor: 'Gateway Alias', route: id };
}

function cleanLabel(label: string): string {
  return label.replace(/\s*\(LLM Lite\)\s*/gi, '').trim();
}

function ModelSettingsSaveActions({
  canEdit,
  hasUnsavedChanges,
  saving,
  changedCount,
  onSave,
  onDiscard,
  showDiscard,
}: {
  canEdit: boolean;
  hasUnsavedChanges: boolean;
  saving: boolean;
  changedCount: number;
  onSave: () => void;
  onDiscard: () => void;
  showDiscard: boolean;
}) {
  if (!canEdit) {
    return (
      <Chip tone="warn">
        <Lock className="h-3 w-3" />
        View only — cannot save
      </Chip>
    );
  }
  return (
    <>
      {showDiscard && hasUnsavedChanges && (
        <button
          type="button"
          onClick={onDiscard}
          disabled={saving}
          className={cn(btn.ghost, 'active:scale-[0.97] transition-transform duration-150')}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Discard
        </button>
      )}
      <button
        type="button"
        onClick={onSave}
        disabled={saving || !hasUnsavedChanges}
        className={cn(
          btn.primary,
          'active:scale-[0.97] transition-transform duration-150 shadow-sm',
          hasUnsavedChanges &&
            'ring-2 ring-[var(--brand-a)] ring-offset-2 ring-offset-[var(--main-bg)]',
        )}
      >
        {saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Save className="h-3.5 w-3.5" />
        )}
        {saving
          ? 'Saving…'
          : hasUnsavedChanges
            ? `Save changes (${changedCount})`
            : 'Save changes'}
      </button>
    </>
  );
}

interface ModelPickerDropdownProps {
  value: string;
  models: LlmLiteCatalogEntry[];
  disabled?: boolean;
  onChange: (modelId: string) => void;
  align?: 'left' | 'right';
  size?: 'sm' | 'md';
}

function ModelPickerDropdown({
  value,
  models,
  disabled,
  onChange,
  align = 'right',
  size = 'md',
}: ModelPickerDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = models.find((m) => m.id === value);
  const displayName = current ? cleanLabel(current.label) : cleanLabel(value);
  const { vendor, route } = providerShortBadge(value);

  return (
    <div ref={rootRef} className="relative inline-block text-left">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'group inline-flex items-center justify-between gap-2.5 rounded-xl border border-[var(--line-2)] bg-[var(--surface-1)] text-left transition-[border-color,box-shadow,transform] duration-150 ease-out active:scale-[0.98] disabled:opacity-60',
          size === 'md' ? 'h-10 min-w-[260px] px-3.5' : 'h-9 min-w-[235px] px-3',
          open
            ? 'border-[var(--brand-a)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand-a)_14%,transparent)]'
            : 'hover:border-[var(--ink-3)]',
        )}
      >
        <div className="min-w-0 flex items-center gap-2.5">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--brand-a-soft)] text-[var(--brand-a-ink)]">
            <Cpu className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-size-ui font-semibold text-[var(--ink-1)]">
                {displayName}
              </span>
              <span className="shrink-0 rounded bg-[var(--surface-2)] px-1.5 py-0.2 text-caption font-medium text-[var(--ink-2)]">
                {vendor}
              </span>
            </div>
            <div className="truncate font-mono text-caption text-[var(--ink-3)]">
              {route}
            </div>
          </div>
        </div>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-[var(--ink-3)] transition-transform duration-150 ease-out',
            open && 'rotate-180 text-[var(--ink-1)]',
          )}
        />
      </button>

      {open && (
        <div
          style={{
            transformOrigin: align === 'right' ? 'top right' : 'top left',
          }}
          className={cn(
            'absolute z-50 mt-1.5 w-[330px] rounded-xl border border-[var(--line-2)] bg-[var(--surface-1)] p-1.5 shadow-xl',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          <div className="px-2.5 py-1.5 text-caption font-semibold uppercase tracking-wider text-[var(--ink-3)]">
            Authorized LLM Lite Chat Models ({models.length})
          </div>
          <div className="max-h-[280px] overflow-y-auto space-y-0.5">
            {models.map((m) => {
              const selected = m.id === value;
              const info = providerShortBadge(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    onChange(m.id);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-colors duration-100',
                    selected
                      ? 'bg-[var(--brand-a-soft)] text-[var(--brand-a-ink)]'
                      : 'hover:bg-[var(--surface-2)] text-[var(--ink-1)]',
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-size-ui font-medium">
                        {cleanLabel(m.label)}
                      </span>
                      <span className="shrink-0 rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-caption font-medium text-[var(--ink-2)]">
                        {info.vendor}
                      </span>
                    </div>
                    <div className="truncate font-mono text-caption opacity-75">
                      {m.id}
                    </div>
                  </div>
                  {selected && <Check className="h-4 w-4 shrink-0 text-[var(--brand-a-ink)]" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ModelsConfigPage() {
  // Section access: Manage on Models (admins by default, or a bundle). The API checks the same rule.
  const canEdit = useSectionLevel('govern.models') === 'manage';

  const [data, setData] = useState<ModelConfigPayload | null>(null);
  const [draft, setDraft] = useState<PlatformModelSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveBanner, setSaveBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [probes, setProbes] = useState<Record<string, { running: boolean; result?: ProbeResult }>>({});
  const [activeTab, setActiveTab] = useState<'features' | 'catalog' | 'embeddings' | 'access'>('features');
  const [catalogFilter, setCatalogFilter] = useState<'all' | 'selectable' | 'filtered'>('all');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [openCodeFeatureId, setOpenCodeFeatureId] = useState<string | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string>('platform_admin');

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/model-config', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ModelConfigPayload;
      setData(json);
      setDraft(json.settings);
      setSaveBanner(null);
    } catch (err) {
      setSaveBanner({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Failed to load model configuration',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const selectableGatewayModels = useMemo(() => {
    const entries = data?.gateway.entries ?? [];
    const allowedChat = entries.filter((e) => e.isChatCapable && e.keyAllowed);
    if (allowedChat.length > 0) return allowedChat;
    const defId = draft?.defaultGatewayModelId ?? 'aws_bedrock/xAI-Grok-4.7';
    return [
      {
        id: defId,
        key: `llm-lite:${defId.replace(/\//g, '--')}`,
        label: defId,
        mode: 'chat',
        upstreamProvider: 'Synergy LLM Lite',
        isRouterAlias: false,
        isChatCapable: true,
        keyAllowed: true,
        adminEnabled: true,
        selectableInPicker: true,
        filterReason: null,
      },
    ];
  }, [data?.gateway.entries, draft?.defaultGatewayModelId]);

  const hasUnsavedChanges = useMemo(() => {
    if (!data?.settings || !draft) return false;
    return JSON.stringify(data.settings) !== JSON.stringify(draft);
  }, [data?.settings, draft]);

  const changedCount = useMemo(() => {
    if (!data?.settings || !draft) return 0;
    let diff = 0;
    if (data.settings.defaultGatewayModelId !== draft.defaultGatewayModelId) diff++;
    for (const f of data.features) {
      if (data.settings.featureModels[f.id] !== draft.featureModels[f.id]) diff++;
    }
    if (
      JSON.stringify(data.settings.disabledGatewayModelIds) !==
      JSON.stringify(draft.disabledGatewayModelIds)
    ) {
      diff++;
    }
    if (JSON.stringify(data.settings.roleAccess) !== JSON.stringify(draft.roleAccess)) {
      diff++;
    }
    return diff;
  }, [data, draft]);

  const handleSave = useCallback(async () => {
    if (!draft || !canEdit) return;
    setSaving(true);
    setSaveBanner(null);
    try {
      const res = await fetch('/api/model-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const json = (await res.json()) as { settings?: PlatformModelSettings; error?: string };
      if (!res.ok || !json.settings) {
        throw new Error(json.error ?? `Save failed (${res.status})`);
      }
      setData((prev) => (prev ? { ...prev, settings: json.settings! } : prev));
      setDraft(json.settings);
      setSaveBanner({
        kind: 'ok',
        text: 'Model routing configuration saved and immediately active across all platform services.',
      });
      void loadConfig();
    } catch (err) {
      setSaveBanner({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Could not save model configuration',
      });
    } finally {
      setSaving(false);
    }
  }, [draft, canEdit, loadConfig]);

  const runModelProbe = useCallback(async (modelId: string) => {
    setProbes((prev) => ({ ...prev, [modelId]: { running: true } }));
    try {
      const res = await fetch('/api/model-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId }),
      });
      const result = (await res.json()) as ProbeResult;
      setProbes((prev) => ({ ...prev, [modelId]: { running: false, result } }));
    } catch (err) {
      setProbes((prev) => ({
        ...prev,
        [modelId]: {
          running: false,
          result: {
            ok: false,
            modelId,
            error: err instanceof Error ? err.message : 'Probe request failed',
          },
        },
      }));
    }
  }, []);

  const setFeatureModel = (featureId: ModelFeatureId, modelId: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      featureModels: {
        ...draft.featureModels,
        [featureId]: modelId,
      },
    });
  };

  const applyDefaultToAllFeatures = (modelId: string) => {
    if (!draft || !data) return;
    const nextFeatures = { ...draft.featureModels };
    for (const f of data.features) {
      nextFeatures[f.id] = modelId;
    }
    setDraft({
      ...draft,
      defaultGatewayModelId: modelId,
      featureModels: nextFeatures,
      roleAccess: {
        ...draft.roleAccess,
        standardUserDefaultModelId: modelId,
      },
    });
  };

  const toggleModelDisabled = (modelId: string) => {
    if (!draft) return;
    const set = new Set(draft.disabledGatewayModelIds);
    if (set.has(modelId)) set.delete(modelId);
    else set.add(modelId);
    setDraft({
      ...draft,
      disabledGatewayModelIds: Array.from(set),
    });
  };

  const getRolePolicy = useCallback(
    (roleId: string): RoleModelPolicy => {
      const defModel = draft?.defaultGatewayModelId ?? 'aws_bedrock/xAI-Grok-4.7';
      const stdModel = draft?.roleAccess.standardUserDefaultModelId ?? defModel;
      const existing = draft?.roleAccess.rolePolicies?.[roleId];
      if (existing) return existing;
      const isFull = draft?.roleAccess.fullPickerRoles.includes(roleId) ?? roleId === 'platform_admin';
      return {
        mode: isFull ? 'all_enabled' : 'locked_default',
        defaultModelId: isFull ? defModel : stdModel,
        allowedModelIds: isFull
          ? selectableGatewayModels.map((m) => m.id)
          : [stdModel],
      };
    },
    [draft, selectableGatewayModels],
  );

  const updateRolePolicy = (roleId: string, patch: Partial<RoleModelPolicy>) => {
    if (!draft) return;
    const currentPolicies: Record<string, RoleModelPolicy> = {};
    for (const r of ALL_ROLES) {
      currentPolicies[r.id] = getRolePolicy(r.id);
    }
    const prev = currentPolicies[roleId];
    const nextMode = patch.mode ?? prev.mode;
    const nextDefault = patch.defaultModelId ?? prev.defaultModelId;
    let nextAllowed = patch.allowedModelIds ?? prev.allowedModelIds;

    // When switching from locked_default -> custom_list, seed with default model if empty
    if (nextAllowed.length === 0) {
      nextAllowed = [nextDefault];
    }
    if (!nextAllowed.includes(nextDefault)) {
      nextAllowed = [nextDefault, ...nextAllowed];
    }

    currentPolicies[roleId] = {
      mode: nextMode,
      defaultModelId: nextDefault,
      allowedModelIds: nextAllowed,
    };

    const fullPickerRoles = ALL_ROLES.map((r) => r.id).filter(
      (id) => currentPolicies[id].mode === 'all_enabled',
    );
    const standardUserDefaultModelId =
      currentPolicies.member?.defaultModelId ?? draft.roleAccess.standardUserDefaultModelId;

    setDraft({
      ...draft,
      roleAccess: {
        ...draft.roleAccess,
        fullPickerRoles: fullPickerRoles.length > 0 ? fullPickerRoles : ['platform_admin'],
        standardUserDefaultModelId,
        rolePolicies: currentPolicies,
      },
    });
  };

  const toggleRoleAllowedModel = (roleId: string, modelId: string) => {
    const policy = getRolePolicy(roleId);
    const currentIds =
      policy.mode === 'all_enabled'
        ? selectableGatewayModels.map((m) => m.id)
        : policy.allowedModelIds;
    const set = new Set(currentIds);
    if (set.has(modelId)) {
      if (set.size <= 1) return; // keep at least 1 allowed model
      set.delete(modelId);
    } else {
      set.add(modelId);
    }
    const nextAllowed = Array.from(set);
    const nextDefault = set.has(policy.defaultModelId)
      ? policy.defaultModelId
      : nextAllowed[0];
    updateRolePolicy(roleId, {
      mode: 'custom_list',
      allowedModelIds: nextAllowed,
      defaultModelId: nextDefault,
    });
  };

  const featuresByCategory = useMemo(() => {
    const groups = new Map<ModelFeatureSpec['category'], ModelFeatureSpec[]>();
    for (const f of data?.features ?? []) {
      const list = groups.get(f.category) ?? [];
      list.push(f);
      groups.set(f.category, list);
    }
    return Array.from(groups.entries());
  }, [data?.features]);

  const gateway = data?.gateway;
  const totalCatalog = gateway?.entries.length ?? 0;
  const activePickerCount = useMemo(() => {
    if (!gateway) return 0;
    const disabled = new Set(draft?.disabledGatewayModelIds ?? []);
    return gateway.entries.filter(
      (e) => e.isChatCapable && e.keyAllowed && !disabled.has(e.id),
    ).length;
  }, [gateway, draft?.disabledGatewayModelIds]);
  const blockedByKeyCount =
    gateway?.entries.filter((e) => e.isChatCapable && !e.keyAllowed).length ?? 0;
  const routerFilteredCount =
    gateway?.entries.filter((e) => e.isRouterAlias || !e.isChatCapable).length ?? 0;

  const filteredCatalogEntries = useMemo(() => {
    const list = gateway?.entries ?? [];
    const disabled = new Set(draft?.disabledGatewayModelIds ?? []);
    return list.filter((e) => {
      const isSelectable = e.isChatCapable && e.keyAllowed && !disabled.has(e.id);
      if (catalogFilter === 'selectable' && !isSelectable) return false;
      if (catalogFilter === 'filtered' && isSelectable) return false;
      if (catalogSearch.trim()) {
        const q = catalogSearch.toLowerCase();
        return (
          e.id.toLowerCase().includes(q) ||
          e.label.toLowerCase().includes(q) ||
          e.upstreamProvider.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [gateway?.entries, draft?.disabledGatewayModelIds, catalogFilter, catalogSearch]);

  const defaultModelEntry = selectableGatewayModels.find(
    (m) => m.id === (draft?.defaultGatewayModelId ?? 'aws_bedrock/xAI-Grok-4.7'),
  );
  const defaultModelLabel = defaultModelEntry
    ? cleanLabel(defaultModelEntry.label)
    : cleanLabel(draft?.defaultGatewayModelId ?? 'Grok 4.7');

  const discardDraft = useCallback(() => {
    if (data) setDraft(data.settings);
  }, [data]);

  return (
    <div
      className={cn(
        'mx-auto max-w-6xl px-6 py-6 space-y-6',
        canEdit && hasUnsavedChanges && 'pb-28',
      )}
    >
      {/* Top Hero & Gateway Health Strip */}
      <div className="rounded-2xl border border-[var(--line-1)] bg-[var(--surface-1)] p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--brand-a-soft)] text-[var(--brand-a-ink)]">
                <Cpu className="h-5 w-5" />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-size-title-section font-semibold tracking-tight text-[var(--ink-1)]">
                    Models & AI Gateway
                  </h1>
                  <Chip tone={gateway?.reachable ? 'ok' : 'bad'}>
                    <span
                      className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        gateway?.reachable ? 'bg-[var(--ok)]' : 'bg-[var(--bad)]',
                      )}
                    />
                    {loading
                      ? 'Checking Gateway…'
                      : gateway?.reachable
                        ? `Connected · ${gateway.latencyMs ?? '—'} ms`
                        : 'Gateway Unreachable'}
                  </Chip>
                </div>
                <p className="text-size-ui text-[var(--ink-2)] mt-0.5">
                  Control which Synergy LLM Lite deployment powers each platform surface, inspect virtual key permissions, and test live latency.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => void loadConfig()}
              disabled={loading}
              className={cn(btn.secondary, 'active:scale-[0.97] transition-transform duration-150')}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              Refresh
            </button>

            <ModelSettingsSaveActions
              canEdit={canEdit}
              hasUnsavedChanges={hasUnsavedChanges}
              saving={saving}
              changedCount={changedCount}
              onSave={() => void handleSave()}
              onDiscard={discardDraft}
              showDiscard
            />
          </div>
        </div>

        {!canEdit && (
          <p
            role="note"
            className="mt-4 rounded-xl border border-[var(--line-1)] bg-[var(--surface-2)]/50 px-4 py-3 text-size-ui text-[var(--ink-2)]"
          >
            You can inspect gateway and role settings here, but saving requires{' '}
            <strong className="text-[var(--ink-1)]">Platform Admin</strong> or a bundle that includes{' '}
            <strong className="text-[var(--ink-1)]">Manage</strong> on Models. Org{' '}
            <strong className="text-[var(--ink-1)]">Admin</strong> is view-only on this page by default.
          </p>
        )}

        {/* Integrated 4-Metric Bar */}
        <div className="mt-5 grid grid-cols-1 gap-3 border-t border-[var(--line-1)] pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex items-center justify-between rounded-xl bg-[var(--surface-2)]/60 px-3.5 py-2.5">
            <div className="min-w-0">
              <div className="text-caption font-semibold uppercase tracking-wider text-[var(--ink-3)]">
                Gateway Endpoint
              </div>
              <div
                title={gateway?.baseUrl ?? undefined}
                className="mt-0.5 truncate font-mono text-size-ui font-medium text-[var(--ink-1)]"
              >
                {gateway?.baseUrl?.replace(/^https?:\/\//, '') ?? 'Not configured'}
              </div>
              <div className="text-caption text-[var(--ink-3)]">
                100% unified OpenAI-compatible proxy
              </div>
            </div>
            <Server className="h-4 w-4 shrink-0 text-[var(--ink-3)]" />
          </div>

          <div className="flex items-center justify-between rounded-xl bg-[var(--surface-2)]/60 px-3.5 py-2.5">
            <div className="min-w-0">
              <div className="text-caption font-semibold uppercase tracking-wider text-[var(--ink-3)]">
                Primary Platform Model
              </div>
              <div className="mt-0.5 truncate text-size-ui font-semibold text-[var(--ink-1)]">
                {defaultModelLabel}
              </div>
              <div className="truncate font-mono text-caption text-[var(--ink-3)]">
                {draft?.defaultGatewayModelId ?? 'aws_bedrock/xAI-Grok-4.7'}
              </div>
            </div>
            <Sparkles className="h-4 w-4 shrink-0 text-[var(--brand-a-ink)]" />
          </div>

          <div className="flex items-center justify-between rounded-xl bg-[var(--surface-2)]/60 px-3.5 py-2.5">
            <div>
              <div className="text-caption font-semibold uppercase tracking-wider text-[var(--ink-3)]">
                Picker-Ready Models
              </div>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="text-size-body font-semibold tabular-nums text-[var(--ink-1)]">
                  {activePickerCount}
                </span>
                <span className="text-caption text-[var(--ink-3)]">
                  of {totalCatalog} gateway IDs
                </span>
              </div>
              <div className="text-caption text-[var(--ink-3)]">
                {routerFilteredCount} non-chat/routers · {blockedByKeyCount} key-blocked
              </div>
            </div>
            <Layers className="h-4 w-4 shrink-0 text-[var(--ink-3)]" />
          </div>

          <div className="flex items-center justify-between rounded-xl bg-[var(--surface-2)]/60 px-3.5 py-2.5">
            <div>
              <div className="text-caption font-semibold uppercase tracking-wider text-[var(--ink-3)]">
                Governed Surfaces
              </div>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="text-size-body font-semibold tabular-nums text-[var(--ink-1)]">
                  {data?.features.length ?? 9}
                </span>
                <span className="text-caption text-[var(--ok)] font-medium">
                  All mapped
                </span>
              </div>
              <div className="text-caption text-[var(--ink-3)]">
                Zero legacy direct-Bedrock calls
              </div>
            </div>
            <ShieldCheck className="h-4 w-4 shrink-0 text-[var(--ok)]" />
          </div>
        </div>
      </div>

      {/* Banners */}
      {saveBanner && (
        <div
          className={cn(
            'flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-size-ui',
            saveBanner.kind === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
          )}
        >
          <div className="flex items-center gap-2">
            {saveBanner.kind === 'ok' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0" />
            )}
            <span>{saveBanner.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaveBanner(null)}
            className="text-caption font-medium underline opacity-80 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {gateway?.error && (
        <div className="flex items-center gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-size-ui text-amber-800 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            <strong>Gateway Diagnostic:</strong> {gateway.error}
          </span>
        </div>
      )}

      {/* Stays visible while scrolling (esp. Role Access tab) */}
      <div className="sticky top-0 z-30 -mx-6 space-y-3 border-b border-[var(--line-1)] bg-[var(--main-bg)]/95 px-6 py-3 backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Segmented
            label="Model configuration view"
            value={activeTab}
            onChange={setActiveTab}
            options={[
            {
              value: 'features',
              label: (
                <span className="inline-flex items-center gap-1.5 px-1 py-0.5">
                  <Layers className="h-3.5 w-3.5" />
                  Where Models Are Used
                  <span className="rounded-full bg-[var(--surface-2)] px-1.5 text-caption tabular-nums">
                    {data?.features.length ?? 9}
                  </span>
                </span>
              ),
            },
            {
              value: 'catalog',
              label: (
                <span className="inline-flex items-center gap-1.5 px-1 py-0.5">
                  <Server className="h-3.5 w-3.5" />
                  LLM Lite Gateway Catalog
                  <span className="rounded-full bg-[var(--surface-2)] px-1.5 text-caption tabular-nums">
                    {totalCatalog}
                  </span>
                </span>
              ),
            },
            {
              value: 'embeddings',
              label: (
                <span className="inline-flex items-center gap-1.5 px-1 py-0.5">
                  <Database className="h-3.5 w-3.5" />
                  Embeddings & Vector Stores
                </span>
              ),
            },
            {
              value: 'access',
              label: (
                <span className="inline-flex items-center gap-1.5 px-1 py-0.5">
                  <KeyRound className="h-3.5 w-3.5" />
                  Role Access & 30-Day Usage
                </span>
              ),
            },
            ]}
          />

          <div className="flex flex-wrap items-center justify-end gap-2">
            {canEdit && hasUnsavedChanges && (
              <span className="rounded-full bg-[var(--brand-a-soft)] px-2.5 py-1 text-caption font-semibold text-[var(--brand-a-ink)]">
                Unsaved — save to apply
              </span>
            )}
            <ModelSettingsSaveActions
              canEdit={canEdit}
              hasUnsavedChanges={hasUnsavedChanges}
              saving={saving}
              changedCount={changedCount}
              onSave={() => void handleSave()}
              onDiscard={discardDraft}
              showDiscard={false}
            />
          </div>
        </div>

        {activeTab === 'features' && draft && (
          <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-[var(--line-1)] bg-[var(--surface-1)] px-3.5 py-2">
            <div className="flex items-center gap-1.5 text-size-caption font-medium text-[var(--ink-2)]">
              <Wand2 className="h-3.5 w-3.5 text-[var(--brand-a-ink)]" />
              <span>Set all surfaces to:</span>
            </div>
            <ModelPickerDropdown
              size="sm"
              value={draft.defaultGatewayModelId}
              models={selectableGatewayModels}
              disabled={!canEdit}
              onChange={(modelId) => applyDefaultToAllFeatures(modelId)}
            />
          </div>
        )}
      </div>

      {/* TAB 1: FEATURE -> MODEL MAPPING (GROUPED BY ARCHITECTURAL LAYER) */}
      {activeTab === 'features' && draft && data && (
        <div className="space-y-6">
          {featuresByCategory.map(([category, features]) => {
            const meta = CATEGORY_META[category];
            const CategoryIcon = meta.icon;
            return (
              <section
                key={category}
                className="rounded-2xl border border-[var(--line-1)] bg-[var(--surface-1)] shadow-sm"
              >
                {/* Section Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line-1)] bg-[var(--surface-2)]/40 px-5 py-3.5 rounded-t-2xl">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--surface-1)] border border-[var(--line-1)] text-[var(--ink-1)] shadow-2xs">
                      <CategoryIcon className="h-4 w-4 text-[var(--brand-a-ink)]" />
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-size-body font-semibold text-[var(--ink-1)]">
                          {category}
                        </h2>
                        <Chip tone={meta.badgeTone}>{features.length} surfaces</Chip>
                      </div>
                      <p className="text-caption text-[var(--ink-3)]">{meta.blurb}</p>
                    </div>
                  </div>
                </div>

                {/* Feature Rows */}
                <div className="divide-y divide-[var(--line-1)]">
                  {features.map((feat) => {
                    const currentModelId =
                      draft.featureModels[feat.id] || draft.defaultGatewayModelId;
                    const isOverridden = currentModelId !== draft.defaultGatewayModelId;
                    const probe = probes[currentModelId];
                    const codeOpen = openCodeFeatureId === feat.id;

                    return (
                      <div
                        key={feat.id}
                        className="px-5 py-4 transition-colors hover:bg-[var(--surface-2)]/25"
                      >
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                          {/* Left: Feature Identity & Code Locations */}
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-size-body font-semibold text-[var(--ink-1)]">
                                {feat.label}
                              </span>
                              {feat.supportsUserPicker ? (
                                <Chip tone="brand">
                                  <Sparkles className="h-3 w-3" />
                                  Interactive Picker
                                </Chip>
                              ) : (
                                <Chip tone="neutral">Background / Fixed</Chip>
                              )}
                              {isOverridden && (
                                <Chip tone="warn">Custom Override</Chip>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  setOpenCodeFeatureId(codeOpen ? null : feat.id)
                                }
                                className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-caption font-mono text-[var(--ink-3)] hover:bg-[var(--surface-2)] hover:text-[var(--ink-1)] transition-colors"
                              >
                                <Code2 className="h-3 w-3" />
                                {feat.codeLocations.length}{' '}
                                {feat.codeLocations.length === 1 ? 'file' : 'files'}
                              </button>
                            </div>

                            <p className="text-size-ui text-[var(--ink-2)] max-w-2xl">
                              {feat.description}
                            </p>

                            {codeOpen && (
                              <div className="mt-2 flex flex-wrap gap-1.5 pt-1">
                                {feat.codeLocations.map((loc) => (
                                  <span
                                    key={loc}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line-1)] bg-[var(--surface-2)] px-2.5 py-1 font-mono text-caption text-[var(--ink-2)]"
                                  >
                                    <FileCode2 className="h-3 w-3 text-[var(--brand-a-ink)]" />
                                    {loc}
                                  </span>
                                ))}
                              </div>
                            )}

                            {/* Inline Probe Output */}
                            {probe?.result && (
                              <div
                                className={cn(
                                  'mt-2 inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-caption font-mono',
                                  probe.result.ok
                                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                    : 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300',
                                )}
                              >
                                {probe.result.ok ? (
                                  <>
                                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                                    <span>
                                      {probe.result.resolvedModel} responded{' '}
                                      <strong>&ldquo;{probe.result.reply}&rdquo;</strong> in{' '}
                                      {probe.result.latencyMs} ms
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <XCircle className="h-3.5 w-3.5 shrink-0" />
                                    <span>
                                      Failed ({probe.result.status ?? 'ERR'}):{' '}
                                      {probe.result.error}
                                    </span>
                                  </>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Right: Model Picker + Live Test Button */}
                          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                            <ModelPickerDropdown
                              value={currentModelId}
                              models={selectableGatewayModels}
                              disabled={!canEdit}
                              onChange={(modelId) => setFeatureModel(feat.id, modelId)}
                            />

                            <button
                              type="button"
                              disabled={probe?.running}
                              onClick={() => void runModelProbe(currentModelId)}
                              title={`Send a live test prompt to ${currentModelId}`}
                              className={cn(
                                btn.secondary,
                                'h-10 px-3 active:scale-[0.97] transition-transform duration-150',
                              )}
                            >
                              {probe?.running ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--brand-a-ink)]" />
                              ) : (
                                <Play className="h-3.5 w-3.5 text-[var(--brand-a-ink)]" />
                              )}
                              <span>{probe?.running ? 'Testing…' : 'Test'}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* TAB 2: LIVE LLM LITE GATEWAY CATALOG */}
      {activeTab === 'catalog' && draft && gateway && (
        <div className="space-y-4">
          {/* Search & Filter Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--line-1)] bg-[var(--surface-1)] p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <div className={cn(fieldShell, 'h-9 w-64')}>
                <Search className="h-3.5 w-3.5 shrink-0 text-[var(--ink-3)]" />
                <input
                  type="text"
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  placeholder="Filter models or provider…"
                  className={cn(fieldInput, 'text-size-ui')}
                />
              </div>

              <Segmented
                label="Filter catalog models"
                value={catalogFilter}
                onChange={setCatalogFilter}
                options={[
                  { value: 'all', label: `All (${totalCatalog})` },
                  { value: 'selectable', label: `Picker Enabled (${activePickerCount})` },
                  {
                    value: 'filtered',
                    label: `Filtered / Blocked (${totalCatalog - activePickerCount})`,
                  },
                ]}
              />
            </div>

            <div className="text-caption text-[var(--ink-3)]">
              Router aliases (<code className="font-mono">model-router</code>,{' '}
              <code className="font-mono">quick</code>) and key-restricted models are automatically excluded.
            </div>
          </div>

          {/* Model Cards Grid */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {filteredCatalogEntries.map((entry) => {
              const isDisabledByAdmin = draft.disabledGatewayModelIds.includes(entry.id);
              const isActiveInPicker =
                entry.isChatCapable && entry.keyAllowed && !isDisabledByAdmin;
              const probe = probes[entry.id];
              const info = providerShortBadge(entry.id);
              const usedByCount = Object.values(draft.featureModels).filter(
                (m) => m === entry.id,
              ).length;

              return (
                <div
                  key={entry.id}
                  className={cn(
                    'flex flex-col justify-between rounded-2xl border p-4 transition-colors',
                    isActiveInPicker
                      ? 'border-[var(--line-1)] bg-[var(--surface-1)] shadow-2xs'
                      : 'border-[var(--line-1)] bg-[var(--surface-2)]/40 opacity-85',
                  )}
                >
                  <div className="space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-size-body font-semibold text-[var(--ink-1)]">
                            {cleanLabel(entry.label)}
                          </span>
                          <Chip tone="neutral">{info.vendor}</Chip>
                          {usedByCount > 0 && (
                            <Chip tone="brand">
                              Used in {usedByCount} {usedByCount === 1 ? 'surface' : 'surfaces'}
                            </Chip>
                          )}
                        </div>
                        <div className="mt-0.5 truncate font-mono text-caption text-[var(--ink-3)]">
                          {entry.id}
                        </div>
                      </div>

                      {isActiveInPicker ? (
                        <Chip tone="ok">
                          <CheckCircle2 className="h-3 w-3" />
                          Active
                        </Chip>
                      ) : !entry.keyAllowed && entry.isChatCapable ? (
                        <Chip tone="bad">
                          <Lock className="h-3 w-3" />
                          Key 403
                        </Chip>
                      ) : (
                        <Chip tone="warn">
                          {isDisabledByAdmin ? 'Hidden by Admin' : entry.filterReason ?? 'Filtered'}
                        </Chip>
                      )}
                    </div>

                    {probe?.result && (
                      <div
                        className={cn(
                          'rounded-lg border px-2.5 py-1.5 font-mono text-caption',
                          probe.result.ok
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300',
                        )}
                      >
                        {probe.result.ok
                          ? `✓ ${probe.result.latencyMs} ms — "${probe.result.reply}"`
                          : `✕ HTTP ${probe.result.status ?? 'ERR'} — ${probe.result.error}`}
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-[var(--line-1)] pt-3">
                    <span className="font-mono text-caption text-[var(--ink-3)]">
                      Mode: {entry.mode}
                    </span>

                    <div className="flex items-center gap-2">
                      {entry.isChatCapable && entry.keyAllowed && canEdit && (
                        <button
                          type="button"
                          onClick={() => toggleModelDisabled(entry.id)}
                          className={cn(
                            btn.ghost,
                            'h-7 px-2.5 text-caption active:scale-[0.97] transition-transform duration-150',
                          )}
                        >
                          {isDisabledByAdmin ? (
                            <>
                              <Eye className="h-3.5 w-3.5" />
                              Show in Picker
                            </>
                          ) : (
                            <>
                              <EyeOff className="h-3.5 w-3.5" />
                              Hide from Picker
                            </>
                          )}
                        </button>
                      )}

                      {entry.isChatCapable && (
                        <button
                          type="button"
                          disabled={probe?.running}
                          onClick={() => void runModelProbe(entry.id)}
                          className={cn(
                            btn.secondary,
                            'h-7 px-2.5 text-caption active:scale-[0.97] transition-transform duration-150',
                          )}
                        >
                          {probe?.running ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Zap className="h-3 w-3 text-[var(--brand-a-ink)]" />
                          )}
                          {probe?.running ? 'Pinging…' : 'Ping'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 4: EMBEDDING MODELS & VECTOR STORES */}
      {activeTab === 'embeddings' && data?.embeddings && (
        <EmbeddingsPanel embeddings={data.embeddings} />
      )}

      {/* TAB 3: ROLE ACCESS & 30-DAY USAGE */}
      {activeTab === 'access' && draft && data && (
        <div className="space-y-6">
          {/* Top Split: Role Selector + Per-Role Allowed Models Editor */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Left (4 cols): Role Selector Cards */}
            <div className="lg:col-span-4 rounded-2xl border border-[var(--line-1)] bg-[var(--surface-1)] p-5 shadow-sm space-y-4">
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-a-soft)] text-[var(--brand-a-ink)]">
                  <ShieldCheck className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="text-size-body font-semibold text-[var(--ink-1)]">
                    RBAC Roles
                  </h2>
                  <p className="text-caption text-[var(--ink-3)] mt-0.5">
                    Select a role to configure which LLM Lite models its users can access and switch between.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                {ALL_ROLES.map((r) => {
                  const pol = getRolePolicy(r.id);
                  const isSelected = selectedRoleId === r.id;
                  const defLabel = cleanLabel(
                    selectableGatewayModels.find((m) => m.id === pol.defaultModelId)?.label ??
                      pol.defaultModelId,
                  );

                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setSelectedRoleId(r.id)}
                      className={cn(
                        'flex w-full flex-col gap-2 rounded-xl border p-3.5 text-left transition duration-150 active:scale-[0.99]',
                        isSelected
                          ? 'border-[var(--brand-a)] bg-[var(--brand-a-soft)]/45 shadow-2xs'
                          : 'border-[var(--line-1)] bg-[var(--surface-2)]/35 hover:bg-[var(--surface-2)]',
                      )}
                    >
                      <div className="flex w-full items-center justify-between gap-2">
                        <span className="text-size-ui font-semibold text-[var(--ink-1)]">
                          {r.label}
                        </span>
                        {pol.mode === 'all_enabled' ? (
                          <Chip tone="ok">All {selectableGatewayModels.length} Models</Chip>
                        ) : pol.mode === 'custom_list' ? (
                          <Chip tone="brand">
                            {pol.allowedModelIds.length}{' '}
                            {pol.allowedModelIds.length === 1 ? 'Model' : 'Models'} Allowed
                          </Chip>
                        ) : (
                          <Chip tone="neutral">Locked to Default</Chip>
                        )}
                      </div>
                      <div className="text-caption text-[var(--ink-3)]">{r.desc}</div>
                      <div className="flex items-center gap-1.5 border-t border-[var(--line-1)]/70 pt-2 text-caption text-[var(--ink-2)]">
                        <KeyRound className="h-3 w-3 text-[var(--brand-a-ink)]" />
                        <span>Default:</span>
                        <span className="font-semibold text-[var(--ink-1)] truncate">
                          {defLabel}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right (8 cols): Active Role Policy & Allowed Model Matrix */}
            {(() => {
              const activeRole =
                ALL_ROLES.find((r) => r.id === selectedRoleId) ?? ALL_ROLES[0];
              const policy = getRolePolicy(activeRole.id);
              const allowedSet = new Set(
                policy.mode === 'all_enabled'
                  ? selectableGatewayModels.map((m) => m.id)
                  : policy.allowedModelIds,
              );

              return (
                <div className="lg:col-span-8 rounded-2xl border border-[var(--line-1)] bg-[var(--surface-1)] p-5 shadow-sm space-y-5">
                  {/* Role Header + Access Mode Switcher */}
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--line-1)] pb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-size-body font-semibold text-[var(--ink-1)]">
                          {activeRole.label} — Model Access Policy
                        </h2>
                        <Chip tone="brand">{activeRole.id}</Chip>
                      </div>
                      <p className="text-caption text-[var(--ink-3)] mt-0.5">
                        Configure the default model and exact allowlist of LLM Lite models that{' '}
                        <strong>{activeRole.label}</strong> users can select in Ask Data, Workbench, and Agent Chat.
                      </p>
                    </div>

                    <Segmented
                      label="Role access mode"
                      value={policy.mode}
                      onChange={(mode) => {
                        if (!canEdit) return;
                        if (mode === 'all_enabled') {
                          updateRolePolicy(activeRole.id, {
                            mode: 'all_enabled',
                            allowedModelIds: selectableGatewayModels.map((m) => m.id),
                          });
                        } else if (mode === 'custom_list') {
                          updateRolePolicy(activeRole.id, {
                            mode: 'custom_list',
                            allowedModelIds:
                              policy.allowedModelIds.length > 0
                                ? policy.allowedModelIds
                                : [policy.defaultModelId],
                          });
                        } else {
                          updateRolePolicy(activeRole.id, {
                            mode: 'locked_default',
                            allowedModelIds: [policy.defaultModelId],
                          });
                        }
                      }}
                      options={[
                        { value: 'all_enabled', label: 'All Enabled Models' },
                        { value: 'custom_list', label: 'Custom Allowlist' },
                        { value: 'locked_default', label: 'Locked to Default' },
                      ]}
                    />
                  </div>

                  {/* Role Default Model Selector */}
                  <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--line-1)] bg-[var(--surface-2)]/40 px-4 py-3">
                    <div>
                      <div className="text-size-ui font-semibold text-[var(--ink-1)]">
                        Default Model for {activeRole.label}
                      </div>
                      <p className="text-caption text-[var(--ink-3)]">
                        {policy.mode === 'locked_default'
                          ? `Users in ${activeRole.label} will always run on this model (model switcher hidden).`
                          : `Pre-selected model when ${activeRole.label} users open a new chat session.`}
                      </p>
                    </div>

                    <ModelPickerDropdown
                      value={policy.defaultModelId}
                      models={
                        policy.mode === 'custom_list'
                          ? selectableGatewayModels.filter((m) => allowedSet.has(m.id))
                          : selectableGatewayModels
                      }
                      disabled={!canEdit}
                      onChange={(modelId) =>
                        updateRolePolicy(activeRole.id, {
                          defaultModelId: modelId,
                          allowedModelIds: allowedSet.has(modelId)
                            ? Array.from(allowedSet)
                            : [modelId, ...Array.from(allowedSet)],
                        })
                      }
                    />
                  </div>

                  {/* Allowed Models Checklist Grid */}
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-caption font-semibold uppercase tracking-wider text-[var(--ink-3)]">
                          Models Accessible to {activeRole.label} ({ policy.mode === 'locked_default' ? 1 : allowedSet.size } of {selectableGatewayModels.length})
                        </div>
                        <p className="text-caption text-[var(--ink-3)]">
                          Click any model below to grant or revoke access for {activeRole.label} users.
                        </p>
                      </div>

                      {canEdit && (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              updateRolePolicy(activeRole.id, {
                                mode: 'all_enabled',
                                allowedModelIds: selectableGatewayModels.map((m) => m.id),
                              })
                            }
                            className={cn(btn.ghost, 'h-7 px-2.5 text-caption')}
                          >
                            Grant All ({selectableGatewayModels.length})
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateRolePolicy(activeRole.id, {
                                mode: 'locked_default',
                                allowedModelIds: [policy.defaultModelId],
                              })
                            }
                            className={cn(btn.ghost, 'h-7 px-2.5 text-caption')}
                          >
                            Lock to Default Only
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      {selectableGatewayModels.map((m) => {
                        const isDefault = m.id === policy.defaultModelId;
                        const isAllowed =
                          policy.mode === 'all_enabled'
                            ? true
                            : policy.mode === 'locked_default'
                              ? isDefault
                              : allowedSet.has(m.id);
                        const info = providerShortBadge(m.id);

                        return (
                          <div
                            key={m.id}
                            onClick={() => {
                              if (!canEdit) return;
                              toggleRoleAllowedModel(activeRole.id, m.id);
                            }}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if ((e.key === 'Enter' || e.key === ' ') && canEdit) {
                                e.preventDefault();
                                toggleRoleAllowedModel(activeRole.id, m.id);
                              }
                            }}
                            className={cn(
                              'flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 transition duration-150 select-none active:scale-[0.99]',
                              isAllowed
                                ? 'border-[var(--brand-a)]/60 bg-[var(--brand-a-soft)]/30 cursor-pointer'
                                : 'border-[var(--line-1)] bg-[var(--surface-2)]/30 opacity-65 hover:opacity-100 cursor-pointer',
                            )}
                          >
                            <div className="min-w-0 flex items-center gap-2.5">
                              <span
                                className={cn(
                                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors',
                                  isAllowed
                                    ? 'border-[var(--brand-a)] bg-[var(--brand-a)] text-white'
                                    : 'border-[var(--line-2)] bg-[var(--surface-1)]',
                                )}
                              >
                                {isAllowed && <Check className="h-3.5 w-3.5" />}
                              </span>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate text-size-ui font-semibold text-[var(--ink-1)]">
                                    {cleanLabel(m.label)}
                                  </span>
                                  <span className="shrink-0 rounded bg-[var(--surface-2)] px-1.5 py-0.2 text-caption font-medium text-[var(--ink-2)]">
                                    {info.vendor}
                                  </span>
                                  {isDefault && (
                                    <Chip tone="brand" className="px-1.5 py-0 text-caption">
                                      Default
                                    </Chip>
                                  )}
                                </div>
                                <div className="truncate font-mono text-caption text-[var(--ink-3)]">
                                  {m.id}
                                </div>
                              </div>
                            </div>

                            {canEdit && !isDefault && isAllowed && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateRolePolicy(activeRole.id, {
                                    defaultModelId: m.id,
                                  });
                                }}
                                className="shrink-0 rounded-md border border-[var(--line-2)] bg-[var(--surface-1)] px-2 py-1 text-caption font-medium text-[var(--ink-2)] hover:border-[var(--brand-a)] hover:text-[var(--brand-a-ink)]"
                              >
                                Set Default
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Bottom Full-Width: 30-Day Model Turn Telemetry */}
          <div className="rounded-2xl border border-[var(--line-1)] bg-[var(--surface-1)] p-5 shadow-sm space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-2)] text-[var(--ink-1)]">
                  <Activity className="h-4 w-4 text-[var(--brand-a-ink)]" />
                </span>
                <div>
                  <h2 className="text-size-body font-semibold text-[var(--ink-1)]">
                    30-Day Model Turn Telemetry
                  </h2>
                  <p className="text-caption text-[var(--ink-3)] mt-0.5">
                    Recorded executions from <code className="font-mono">agent_turn_log</code> across Ask Data, Workbench, and Commissioned Agents.
                  </p>
                </div>
              </div>
            </div>

            {data.usage30d.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--line-2)] py-12 text-center">
                <Activity className="h-6 w-6 text-[var(--ink-3)] mb-2" />
                <div className="text-size-ui font-medium text-[var(--ink-2)]">
                  No turn telemetry recorded in the last 30 days
                </div>
                <p className="text-caption text-[var(--ink-3)] mt-0.5">
                  Turns will appear here automatically as users run Ask Data, Workbench, or Agent chats.
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-[var(--line-1)]">
                <table className="w-full text-size-ui">
                  <thead>
                    <tr className="border-b border-[var(--line-1)] bg-[var(--surface-2)]/70">
                      <th className="px-4 py-2.5 text-left text-caption font-semibold uppercase tracking-wider text-[var(--ink-3)]">
                        Model ID
                      </th>
                      <th className="px-4 py-2.5 text-right text-caption font-semibold uppercase tracking-wider text-[var(--ink-3)]">
                        Turns
                      </th>
                      <th className="px-4 py-2.5 text-right text-caption font-semibold uppercase tracking-wider text-[var(--ink-3)]">
                        Tokens (In / Out)
                      </th>
                      <th className="px-4 py-2.5 text-right text-caption font-semibold uppercase tracking-wider text-[var(--ink-3)]">
                        Errors
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line-1)]">
                    {data.usage30d.map((u) => {
                      const maxTurns = Math.max(...data.usage30d.map((r) => r.turns), 1);
                      const pct = Math.max(4, Math.round((u.turns / maxTurns) * 100));
                      return (
                        <tr key={u.model} className="hover:bg-[var(--surface-2)]/40">
                          <td className="px-4 py-3">
                            <div className="font-mono text-caption font-medium text-[var(--ink-1)]">
                              {u.model}
                            </div>
                            <div className="mt-1.5 h-1.5 w-36 overflow-hidden rounded-full bg-[var(--surface-2)]">
                              <div
                                className="h-full rounded-full bg-[var(--brand-a)]"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums text-[var(--ink-1)]">
                            {u.turns.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-caption tabular-nums text-[var(--ink-2)]">
                            {(u.inputTokens / 1000).toFixed(1)}k /{' '}
                            {(u.outputTokens / 1000).toFixed(1)}k
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {u.errors > 0 ? (
                              <Chip tone="bad">{u.errors}</Chip>
                            ) : (
                              <span className="text-caption text-[var(--ink-3)]">0</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {canEdit && hasUnsavedChanges && (
        <div
          role="region"
          aria-label="Unsaved model settings"
          className="fixed inset-x-0 bottom-0 z-[90] border-t border-[var(--line-1)] bg-[var(--surface-1)]/98 px-4 py-3 shadow-[0_-12px_40px_rgba(0,0,0,0.15)] backdrop-blur-md"
        >
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <p className="text-size-ui text-[var(--ink-2)]">
              <span className="font-semibold text-[var(--ink-1)]">You have unsaved model settings</span>
              {' — '}
              {changedCount} {changedCount === 1 ? 'change' : 'changes'}. Save to apply role access and routing.
            </p>
            <ModelSettingsSaveActions
              canEdit={canEdit}
              hasUnsavedChanges={hasUnsavedChanges}
              saving={saving}
              changedCount={changedCount}
              onSave={() => void handleSave()}
              onDiscard={discardDraft}
              showDiscard
            />
          </div>
        </div>
      )}
    </div>
  );
}

