import type { ConstructionState } from './constructionState';
import { applyAssumption, applyConstructionPatch } from './apply-patch';
import { coerceConstructionState } from './load-state';
import { deriveReadiness } from './readiness';
import { userLockFor } from './user-edits';
import type { AvailableWorkbenchTool } from './prompts';

/** Tool result telling the model a field is user-owned; it must ask before changing it. */
function lockedResult(field: string, lock: string): string {
  return JSON.stringify({
    ok: false,
    error: 'USER_LOCKED',
    field,
    lockedBy: lock,
    note: 'The user edited this field directly in the Config panel. Do not change it on your own. If the user explicitly asks you to change it in chat, call update_agent_draft again with source "user".',
  });
}

export type BuilderEmit = (event: Record<string, unknown>) => void;

export type BuilderToolContext = {
  getState: () => ConstructionState;
  setState: (next: ConstructionState) => void;
  emit: BuilderEmit;
  sessionId?: string | null;
  agentLoop?: number;
  model?: string;
  availableTools?: AvailableWorkbenchTool[];
};

export async function executeBuilderTool(
  toolName: string,
  input: Record<string, unknown>,
  ctx: BuilderToolContext,
): Promise<string> {
  const state = ctx.getState();

  if (toolName === 'update_agent_draft') {
    const field = String(input.field ?? '');
    if (!field) return JSON.stringify({ ok: false, error: 'field required' });
    const source = (input.source as 'ai' | 'user' | 'template') ?? 'ai';
    const lock = source === 'user' ? null : userLockFor(state, field);
    if (lock) return lockedResult(field, lock);
    let next = coerceConstructionState(applyConstructionPatch(state, field, input.value, source));
    next = { ...next, readiness: deriveReadiness(next) };
    ctx.setState(next);
    ctx.emit({ type: 'agent_construction_patch', field, value: input.value, source });
    ctx.emit({ type: 'readiness', value: next.readiness === 'validate' ? 'build' : next.readiness });
    return JSON.stringify({ ok: true, readiness: next.readiness });
  }

  if (toolName === 'add_assumption') {
    const field = String(input.field ?? '');
    const confidence = Number(input.confidence ?? 0.5);
    const rationale = String(input.rationale ?? '');
    const next = applyAssumption(state, {
      field,
      value: input.value,
      confidence: Math.min(1, Math.max(0, confidence)),
      rationale,
    });
    ctx.setState(next);
    ctx.emit({
      type: 'agent_construction_patch',
      field: 'assumptionLedger',
      value: next.assumptionLedger,
      source: 'ai',
    });
    return JSON.stringify({ ok: true, ledgerSize: next.assumptionLedger.length });
  }

  if (toolName === 'add_datasource') {
    const lock = userLockFor(state, 'tools.datasources');
    if (lock) return lockedResult('tools.datasources', lock);
    const kind = input.kind as ConstructionState['tools']['datasources'][number]['kind'];
    const ref = String(input.ref ?? '');
    const scope = input.scope != null ? String(input.scope) : null;
    const datasources = [...state.tools.datasources];
    if (!datasources.some((d) => d.kind === kind && d.ref === ref)) {
      datasources.push({ kind, ref, scope });
    }
    let next = applyConstructionPatch(state, 'tools.datasources', datasources, 'ai');
    next = { ...next, readiness: deriveReadiness(next) };
    ctx.setState(next);
    ctx.emit({ type: 'agent_construction_patch', field: 'tools.datasources', value: datasources, source: 'ai' });
    return JSON.stringify({ ok: true, count: datasources.length });
  }

  if (toolName === 'select_agent_class') {
    const classId = String(input.classId ?? '');
    const confidence = Number(input.confidence ?? 0);
    const rationale = String(input.rationale ?? '').trim();
    const supportedClasses = new Set(['feynman', 'fermi', 'grossmann', 'rama']);
    if (!supportedClasses.has(classId) || !Number.isFinite(confidence) || confidence < 0 || confidence > 1 || !rationale) {
      return JSON.stringify({ ok: false, error: 'Choose a supported class with confidence between 0 and 1 and a rationale.' });
    }
    const lock = userLockFor(state, 'class.id');
    if (lock) return lockedResult('class.id', lock);
    const next = {
      ...state,
      class: { id: classId, source: 'inferred' as const, confidence, skillRef: null },
      provenance: { ...state.provenance, 'class.id': 'ai' as const },
    };
    const ready = coerceConstructionState({ ...next, readiness: deriveReadiness(next) });
    ctx.setState(ready);
    ctx.emit({ type: 'agent_construction_patch', field: 'class', value: ready.class, source: 'ai' });
    ctx.emit({ type: 'readiness', value: ready.readiness === 'validate' ? 'build' : ready.readiness });
    return JSON.stringify({ ok: true, classId, confidence, rationale });
  }

  if (toolName === 'select_agent_tools') {
    const lock = userLockFor(state, 'tools.actions');
    if (lock) return lockedResult('tools.actions', lock);
    if (!Array.isArray(input.toolIds) || !input.toolIds.every((id) => typeof id === 'string')) {
      return JSON.stringify({ ok: false, error: 'toolIds must be an array of active tool IDs.' });
    }
    if (input.toolIds.length > 50) {
      return JSON.stringify({ ok: false, error: 'Select no more than 50 active tools.' });
    }
    const availableTools = ctx.availableTools ?? [];
    const uniqueIds = [...new Set(input.toolIds as string[])];
    const unknownIds = uniqueIds.filter((id) => !availableTools.some((tool) => tool.id === id));
    if (unknownIds.length > 0) {
      return JSON.stringify({ ok: false, error: 'Unknown or inactive tool IDs.', unknownIds });
    }
    const actions = uniqueIds.map((toolId) => {
      const tool = availableTools.find((item) => item.id === toolId)!;
      const tier: ConstructionState['tools']['actions'][number]['tier'] = tool.type === 'mcp'
        ? 'mcp'
        : tool.type === 'skill'
          ? 'skill'
          : tool.type === 'db_query' || tool.type === 'api'
            ? 'governed'
            : 'local';
      return { toolId, tier };
    });
    const next = coerceConstructionState({
      ...applyConstructionPatch(state, 'tools.actions', actions, 'ai'),
      readiness: deriveReadiness(state),
    });
    ctx.setState(next);
    ctx.emit({ type: 'agent_construction_patch', field: 'tools.actions', value: actions, source: 'ai' });
    return JSON.stringify({ ok: true, count: actions.length, toolIds: uniqueIds });
  }

  return JSON.stringify({ ok: false, error: `Unknown tool: ${toolName}` });
}

/** Lightweight class inference for the suggestion chip (no LLM). */
export function inferAgentClass(text: string): { classId: string; confidence: number; rationale: string } | null {
  const t = text.toLowerCase();
  if (/verify|validation|validate|evidence|fact.check|claims against/.test(t)) {
    return { classId: 'rama', confidence: 0.74, rationale: 'Evidence checking and validation work maps to Rama class.' };
  }
  if (/forecast|demand|sku|planning|predict/.test(t)) {
    return { classId: 'fermi', confidence: 0.72, rationale: 'Forecasting / planning workload maps to Fermi class.' };
  }
  if (/vendor|onboard|kyc|invoice|stripe|pipeline|multi.step|orchestrat/.test(t)) {
    return { classId: 'grossmann', confidence: 0.7, rationale: 'Multi-step operational pipeline maps to Grossmann class.' };
  }
  if (/compliance|audit|imo|certificate|maritime|bill of lading|bol|regulat/.test(t)) {
    return { classId: 'feynman', confidence: 0.74, rationale: 'Compliance / audit agent maps to Feynman class.' };
  }
  return null;
}
