/**
 * src/lib/dashboards/blueprint-propose.ts
 *
 * Guided Stage 2 — the LLM proposal layer (the model-facing half). Node-safe and
 * pure: it is ONLY the tool schema, the system prompt, and a parser from the raw
 * tool call to `RawBlueprintItem[]`. It performs NO grounding — that is
 * blueprint-ground.ts, which runs over the model's output and enforces the
 * "no fabricated ID" guarantee structurally. The route glues the two together.
 *
 * The single forced tool `propose_blueprint` is how we get one structured
 * proposal from one turn (open-question #4: request/response for v1, not SSE).
 */

import type { Tool, ToolConfiguration } from '@aws-sdk/client-bedrock-runtime';
import type { RawBlueprintItem, GroundingCatalog } from './blueprint-ground';
import { BLUEPRINT_MIN_ITEMS, BLUEPRINT_MAX_ITEMS } from './blueprint-ground';
import type { ChartBlueprint, ResolvedIntent } from './guided-types';

export const PROPOSE_BLUEPRINT_TOOL_NAME = 'propose_blueprint';

/**
 * The one tool the blueprint loop is granted. Forcing this tool (and nothing
 * else) means the model can only respond by proposing a structured blueprint —
 * it cannot execute, render, or write anything.
 */
export const PROPOSE_BLUEPRINT_TOOL: Tool = {
  toolSpec: {
    name: PROPOSE_BLUEPRINT_TOOL_NAME,
    description:
      `Propose a coherent dashboard outline of ${BLUEPRINT_MIN_ITEMS}–${BLUEPRINT_MAX_ITEMS} charts for the user's intent. ` +
      'This ONLY proposes specs — nothing is executed or rendered. Reference measures and dimensions ' +
      'STRICTLY by the IDs given in the catalog. NEVER invent an id. If the intent needs a metric that ' +
      'is not in the catalog, add an item with `undefinedTerm` set to the human name of that metric and ' +
      'leave `measureIds` empty — it becomes a "define it" row, not a fabricated chart.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          charts: {
            type: 'array',
            description: `${BLUEPRINT_MIN_ITEMS}–${BLUEPRINT_MAX_ITEMS} proposed chart specs.`,
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Short human title, e.g. "Accidents by root cause".' },
                measureIds: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Catalog measure IDs ONLY. Omit / leave empty for a define-it item.',
                },
                dimensionIds: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Catalog dimension IDs ONLY (the breakdown / x-axis).',
                },
                filters: {
                  type: 'array',
                  description: 'Optional inferred filters. fieldId must be a catalog id.',
                  items: {
                    type: 'object',
                    properties: {
                      fieldId: { type: 'string' },
                      fieldKind: { type: 'string', enum: ['dimension', 'measure'] },
                      op: { type: 'string' },
                      value: {},
                    },
                    required: ['fieldId', 'fieldKind', 'op'],
                  },
                },
                rationale: { type: 'string', description: 'One line: why this chart answers the intent.' },
                undefinedTerm: {
                  type: 'string',
                  description:
                    'Set ONLY when the chart needs a metric not in the catalog — the raw human term. Never invent an id instead.',
                },
              },
              required: ['title'],
            },
          },
        },
        required: ['charts'],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    },
  },
};

export function buildBlueprintToolConfig(): ToolConfiguration {
  return {
    tools: [PROPOSE_BLUEPRINT_TOOL],
    // Force the single tool so the turn yields exactly one structured proposal.
    toolChoice: { tool: { name: PROPOSE_BLUEPRINT_TOOL_NAME } },
  };
}

/** Render the governed catalog as a compact, id-labelled block for the prompt. */
function renderCatalog(catalog: GroundingCatalog): string {
  const measures = catalog.measures
    .map((m) => `  - ${m.id}  "${m.label}"`)
    .join('\n');
  const dims = catalog.dimensions
    .map((d) => `  - ${d.id}  "${d.label}"${d.type ? ` [${d.type}]` : ''}`)
    .join('\n');
  return `MEASURES (id  label):\n${measures || '  (none governed)'}\n\nDIMENSIONS (id  label [type]):\n${dims || '  (none governed)'}`;
}

/**
 * The blueprint system prompt. Grounds the model in the governed catalog and the
 * resolved intent, and states the refuse-rather-than-guess rule. The rule is
 * ENFORCED downstream regardless — this is persuasion; blueprint-ground.ts is the
 * guardrail.
 */
export function buildBlueprintSystemPrompt(
  intent: ResolvedIntent,
  catalog: GroundingCatalog,
): string {
  return [
    'You are proposing a dashboard BLUEPRINT — a reviewable outline of charts, not live charts.',
    'Nothing you propose is executed or rendered; the user curates this list before anything is built.',
    '',
    `The user's decision to answer:\n"${intent.topic}"`,
    '',
    'You may ONLY use these governed definitions. Reference them by id, exactly:',
    '',
    renderCatalog(catalog),
    '',
    'RULES:',
    `- Propose ${BLUEPRINT_MIN_ITEMS}–${BLUEPRINT_MAX_ITEMS} charts that together answer the decision.`,
    '- Use ONLY the ids above. Never invent an id or a metric.',
    '- If the decision needs a metric that is NOT above, add ONE item with `undefinedTerm` set to its',
    '  human name and empty measureIds — a "define it" row. Do not approximate it with a different metric.',
    '- Give each item a short title and a one-line rationale.',
    '- Prefer variety (a KPI, a trend, a breakdown) over near-duplicates.',
    '- Call propose_blueprint exactly once with all charts.',
  ].join('\n');
}

/** Compact one-line description of the existing item, for the refine prompt. */
function renderExistingItem(item: ChartBlueprint): string {
  const measures = item.measureLabels.length ? item.measureLabels.join(', ') : '(none)';
  const dims = item.dimensionLabels.length ? item.dimensionLabels.join(', ') : '(none)';
  const lines = [
    `  title:       "${item.title}"`,
    `  measures:    ${measures}`,
    `  breakdown:   ${dims}`,
    `  chart kind:  ${item.chartKindGuess}`,
  ];
  if (item.rationale) lines.push(`  rationale:   ${item.rationale}`);
  if (item.grounding === 'undefined' && item.undefinedTerm) {
    lines.push(`  status:      UNDEFINED — needs "${item.undefinedTerm}" which isn't in the catalog yet`);
  }
  return lines.join('\n');
}

/**
 * System prompt for REGENERATING a SINGLE blueprint item from user feedback
 * (Guided Stage 2, per-card "refine"). Same catalog + refuse-rather-than-guess
 * rule as {@link buildBlueprintSystemPrompt}, but the task is one chart, not a
 * whole dashboard. Two behaviours the caller depends on are stated explicitly:
 *   - keep the existing title unless the feedback asks to change it (so a user
 *     rename is never silently clobbered);
 *   - if the feedback needs a metric/breakdown NOT in the catalog, return it as
 *     an `undefinedTerm` item (empty ids) instead of mis-picking a nearby field —
 *     the grounder turns that into a define-it row, which is the intended
 *     classifier outcome (refine OR fall through to define).
 * Pure / node-safe → unit-testable.
 */
export function buildRefineItemSystemPrompt(
  intent: ResolvedIntent,
  catalog: GroundingCatalog,
  existingItem: ChartBlueprint,
  feedback: string,
): string {
  return [
    'You are REFINING ONE chart in a dashboard blueprint — a reviewable spec, not a live chart.',
    'Nothing you propose is executed or rendered; the user is curating this one card.',
    '',
    `The dashboard's overall decision to answer:\n"${intent.topic}"`,
    '',
    'The chart being refined, as it stands now:',
    renderExistingItem(existingItem),
    '',
    `The user's feedback on THIS chart:\n"${feedback}"`,
    '',
    'You may ONLY use these governed definitions. Reference them by id, exactly:',
    '',
    renderCatalog(catalog),
    '',
    'RULES:',
    '- Re-propose EXACTLY ONE chart that applies the feedback. Call propose_blueprint once, with a',
    '  single-element `charts` array.',
    '- Use ONLY the ids above. Never invent an id or a metric.',
    '- Keep the existing title UNLESS the feedback asks to rename it.',
    '- If the feedback needs a metric or breakdown that is NOT in the catalog, return the chart with',
    '  `undefinedTerm` set to that human name and empty measureIds — a "define it" row. Do NOT',
    '  approximate it with a different governed field.',
    '- Give the chart a one-line rationale reflecting the change.',
  ].join('\n');
}

/**
 * Parse the raw `propose_blueprint` tool input into RawBlueprintItem[]. Lenient
 * and defensive — malformed entries are coerced/skipped, never trusted. Does NOT
 * ground (that's the next step); only shapes the model output.
 */
export function parseProposedItems(toolInput: unknown): RawBlueprintItem[] {
  const charts = (toolInput as { charts?: unknown })?.charts;
  if (!Array.isArray(charts)) return [];
  const items: RawBlueprintItem[] = [];
  for (const c of charts) {
    if (!c || typeof c !== 'object') continue;
    const raw = c as Record<string, unknown>;
    const item: RawBlueprintItem = {
      title: typeof raw.title === 'string' ? raw.title : undefined,
      measureIds: Array.isArray(raw.measureIds) ? raw.measureIds.filter((x): x is string => typeof x === 'string') : undefined,
      dimensionIds: Array.isArray(raw.dimensionIds) ? raw.dimensionIds.filter((x): x is string => typeof x === 'string') : undefined,
      rationale: typeof raw.rationale === 'string' ? raw.rationale : undefined,
      undefinedTerm: typeof raw.undefinedTerm === 'string' ? raw.undefinedTerm : undefined,
      filters: Array.isArray(raw.filters)
        ? // Grounding re-validates every filter's fieldId; here we only shape it.
          (raw.filters.filter((f) => f && typeof f === 'object') as RawBlueprintItem['filters'])
        : undefined,
    };
    items.push(item);
  }
  return items;
}
