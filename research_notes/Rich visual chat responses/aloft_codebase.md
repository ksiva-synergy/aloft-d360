# ALOFT codebase: what a rich visual chat response plan must integrate with

All sources are files in `C:/ALOFT/aloft-ui-redesign` (branch `feature/ui-redesign`, 2026-11-01). Line numbers come from the working tree, which has uncommitted changes, so they may move a little.

## 1. Renderer: StreamingMessage / AssistantContent, its limits and every consumer

### Takeaway
All assistant prose goes through one hand-written, regex-based renderer, `AssistantContent` in `src/components/workbench/StreamingMessage.tsx`. It handles only bold, italic and inline code inside a line. It has no links, no nested lists, no syntax highlighting and no raw HTML or SVG. That makes it the single place to add rich blocks: a new fenced-language dispatch in `fencedBlock()` would reach every chat surface at once.

### Cited Findings
- `src/components/chat/AssistantContent.tsx` is only a re-export (`export { AssistantContent } from '@/components/workbench/StreamingMessage'`), described as the "Shared assistant markdown + tabular JSON renderer (Inspector, Workbench, saved agents, etc.)". — [AssistantContent.tsx:1-4](src/components/chat/AssistantContent.tsx)
- The file is `'use client'` and 1461 lines long. It imports framer-motion, lucide icons, `withAlpha`, the `type` typography tokens and the json-table helpers. — [StreamingMessage.tsx:1-36](src/components/workbench/StreamingMessage.tsx)
- Colors are hard-coded constants that point at CSS variables (`GOLD='var(--brand-a-ink)'`, `INK='var(--wb-ink)'`, `SURFACE='var(--wb-surface)'`, `BORDER_SUBTLE='var(--wb-border-subtle)'`) next to raw hex values (`VIOLET '#8b5cf6'`, `GREEN '#22c55e'`, `RED '#ef4444'`). — [StreamingMessage.tsx:37-52](src/components/workbench/StreamingMessage.tsx)
- `AssistantContent({content})`. When the whole reply is JSON with no code fence, it renders `structuredJsonBlock`. Otherwise it splits on the regex ``/```(\w+)?\s*\n([\s\S]*?)```/g``. Prose segments go to `renderProseSection` and fenced segments go to `fencedBlock(lang, code)`, with the language lower-cased and defaulting to `text`. — [StreamingMessage.tsx:1268-1298](src/components/workbench/StreamingMessage.tsx)
  - The fence regex needs a closing ```` ``` ````, so a block that is still streaming renders as prose until it closes. The language must be `\w+`, so tags like `chart-json` or `vega-lite` will not match as written. A newline is required after the language.
- `fencedBlock`. If the code starts with `[` or `{`, it tries `structuredJsonBlock` (a JSON table or record). Otherwise it renders `CodeBlockView`. This is the only dispatch point by fence content, and it does not look at the language. — [StreamingMessage.tsx:1196-1201](src/components/workbench/StreamingMessage.tsx)
- `CodeBlockView` is a plain `<pre>` with a language label and a Copy button. There is no syntax highlighting. — [StreamingMessage.tsx:669-684](src/components/workbench/StreamingMessage.tsx)
- `renderProseSection` / `renderProseBlocks` scan line by line. They detect GFM pipe tables (header row plus `---` separator) and emit `MarkdownTable`. Every other line goes to `MarkdownLine`, and a heuristic, `looksLikeSectionTitle`, turns short unpunctuated lines into headings. — [StreamingMessage.tsx:1203-1266](src/components/workbench/StreamingMessage.tsx), [529-540](src/components/workbench/StreamingMessage.tsx)
- `renderInline` tokenizes only `**bold**`, `*italic*` and `` `code` ``. Markdown links, autolinks, images and strikethrough are not supported. — [StreamingMessage.tsx:348-366](src/components/workbench/StreamingMessage.tsx)
- `MarkdownLine` handles `#`–`####` headings, `-`/`*`/`•`/`▸` bullets, `1.` numbered items, `---` rules and `>` quotes. Each regex is anchored at the start of the line (`/^[-*•]\s+/`), so indented (nested) list items do not match and render as plain lines. Each line is its own `<div>`. Real `<ul>`/`<ol>` elements are never emitted. — [StreamingMessage.tsx:542-613](src/components/workbench/StreamingMessage.tsx)
- `MarkdownTable` takes headers, aligns and rows from a pipe table. `splitTableRow` splits on every `|`, so escaped pipes are not handled. — [StreamingMessage.tsx:370-401](src/components/workbench/StreamingMessage.tsx)
- JSON blocks:
  - `structuredJsonBlock` → `TabularJsonBlock` (`DataTable`, with Table/JSON toggle) or `RecordJsonBlock` (`DetailList`, with Record/JSON toggle). — [StreamingMessage.tsx:686-741](src/components/workbench/StreamingMessage.tsx), [DataTable 1032](src/components/workbench/StreamingMessage.tsx)
  - The helpers live in `src/components/workbench/json-table.ts` (382 lines): `recordsFromJson` (line 264), `recordFromJson` (199), `nestedRecords` (165), `labelForKey` (38), `detailTone` (151), `splitDetailItems` (233). `recordsFromJson` detects arrays of records, unwraps `{rows:[...]}` envelopes, and sorts columns into labels/rows, shared fields and per-row details. — [json-table.ts:1-12](src/components/workbench/json-table.ts)
- `StreamingMessage` props: `activity, companionActive, error, outcome, content, thinking, toolCalls, isStreaming, interrupted, readiness, timestamp, durationMs, tokenCount, modelName`. It renders `ThinkingAccordion`, `ToolCallsSection`, then a motion card containing `CaptainStatus` and `<AssistantContent content={content} />` at line 1392, then a footer with Copy (copies raw `content`). — [StreamingMessage.tsx:1301-1461](src/components/workbench/StreamingMessage.tsx)
- The message model is `WorkbenchMessage {id, role, content: string, toolCalls?, turnOps?, thinking?, activity?, draftPatches?, suggestions?, followUpSuggestions?, timestamp, turnNumber}`. `ToolCall {callId, toolId, toolName, status, input?, output?, error?, retryable?, durationMs?, reason?}`. There is no field for structured parts. — [types.ts:20-48](src/components/agent-lab/workbench/types.ts)
- Consumers found by grep:
  - `PromptCanvas.tsx:496` renders `<StreamingMessage>` per assistant message. PromptCanvas itself is used by `InspectorShell.tsx:414` (surface `inspector`) and `WorkbenchShell.tsx:195` (surface `workbench`). `PromptCanvasSurface = 'workbench' | 'inspector'`. — [PromptCanvas.tsx:36, 470-512](src/components/workbench/PromptCanvas.tsx), [InspectorShell.tsx:414-447](src/components/inspector/InspectorShell.tsx)
  - `src/views/agent-lab/agents/use.tsx:706` renders `<AssistantContent content={message.content} />` for saved-agent chat, followed by `AnswerInspection` and `CaptainStatus`. — [use.tsx:690-715](src/views/agent-lab/agents/use.tsx)
  - `src/views/agent-lab/flows/CopilotPanel.tsx:143` renders `<AssistantContent content={m.text} />`. The message shape there is `{role, text}`. — [CopilotPanel.tsx:54,143](src/views/agent-lab/flows/CopilotPanel.tsx)
  - `src/components/workbench/config/TestRunSection.tsx:255` renders `<AssistantContent content={answer} />`. — [TestRunSection.tsx:255](src/components/workbench/config/TestRunSection.tsx)
  - `web/scratch-type.tsx:44` is a scratch preview page for `StreamingMessage`. — [scratch-type.tsx:44](web/scratch-type.tsx)
  - `src/components/agent-ops/SessionCockpit.tsx` does **not** use AssistantContent. It shows transcript text as `whiteSpace: 'pre-wrap'` plain text. — [SessionCockpit.tsx:37](src/components/agent-ops/SessionCockpit.tsx)
  - The Inspector shows charts **outside** the chat thread, in a right-hand "Results" pane (`SemanticChartCard`, `DisambiguationCard`, `ExportReadyCard`, `QueryProgressCard`, `DashboardPane`). — [InspectorShell.tsx:500-560](src/components/inspector/InspectorShell.tsx)
- Existing renderer tests: `src/components/workbench/__tests__/AssistantContent.json-table.test.tsx` (jsdom, React Testing Library; covers tabular JSON, records, the JSON toggle, and a ```` ```javascript ```` fence that holds JSON) and `json-table.test.ts`. — [AssistantContent.json-table.test.tsx:1-100](src/components/workbench/__tests__/AssistantContent.json-table.test.tsx)
- No `dangerouslySetInnerHTML` appears in chat code. The only uses are `<style>` blocks in `DistillationStage.tsx:495` and `FreshnessDot.tsx:15`. The UI contains no `<iframe>` or `sandbox=` anywhere (grep over `src` and `web/src`).

### Inferences
- The lowest-friction hook is to give `fencedBlock` a language dispatch, for example `chart`/`aloft-chart` (JSON spec), `svg`, `mermaid`, `html`/`artifact`. That change would reach Inspector, Workbench, Agents → Use, the Flows copilot and the Test run at the same time. The fence regex at line 1272 must allow `-` in the language (`[\w-]+`), and the renderer needs a "streaming, fence not closed yet" state with a placeholder skeleton, so half a spec never shows as prose.
- Because `fencedBlock` sends any `{`/`[` payload to JSON tables, a chart spec in a ```` ```json ```` fence would render as a table today. A distinct language tag, or a discriminator key, is required.
- Inline links would also need `renderInline` support. Today the model cannot produce a clickable link, a source citation link, or an "open artifact" link in prose.
- The footer Copy button copies raw markdown, so a visual block would be copied as its source spec. That is acceptable, but worth deciding on deliberately.
- SessionCockpit (Agent Ops transcript) would show raw fence source unless it switches to AssistantContent.

### Gaps
- I did not read every line of `DataTable` / `DetailList` (lines 743-1190). They are table rendering only and not relevant to visuals.
- I did not check whether Automate run output views render assistant text anywhere else (e.g. flows run logs). No other AssistantContent import exists.

## 2. Streaming transport, tool events, client hooks and persistence

### Takeaway
Every chat surface uses hand-rolled SSE: `data: {json}\n\n` frames from `ReadableStream` route handlers, read with `fetch().body.getReader()` on the client. Events are typed by a `type` string, and tool lifecycle events (`tool_call_suggested/running/result/error`) are already a first-class side channel. Messages are saved as JSON blobs in `workbench_sessions.messages` (Prisma `Json?`). The Inspector saves the whole client `WorkbenchMessage[]` without validation. Agent chats are filtered through `parseChatMessages`, which drops unknown fields. Structured parts are therefore possible, but each persistence path needs explicit work.

### Cited Findings
- **Agents → Use route** `POST /api/agent-lab/agents/chat`:
  - Builds a `ReadableStream`. `emit()` enqueues `data: ${JSON.stringify(event)}\n\n`.
  - Events: `stream_start`, `chat` (chatId), `text` (delta), `tool_call_running` (callId, toolName, input), `tool_call_result` (callId, durationMs; **no output**), `tool_call_error`, `inspection`, `error`, `done` (outcome, loops, usage, model). `onToolEvent: emit` also forwards events raised by tools.
  - Headers: `text/event-stream`, `Cache-Control: no-cache, no-transform`.
  - `maxDuration = 300`. — [agents/chat/route.ts:131-223](src/app/api/agent-lab/agents/chat/route.ts)
- In the same route, the reply is saved in `finally`, even when stopped: `appendAgentChatMessages(savedChat.id, [userMessage, newChatMessage('assistant', replyText, inspection)])`. — [agents/chat/route.ts:199-210](src/app/api/agent-lab/agents/chat/route.ts)
- Agent chat storage:
  - One row per conversation in `workbench_sessions` with `surface='agent_use'`.
  - `AgentChatMessage = {id, role, content: string, timestamp?, inspection?}`.
  - `parseChatMessages` rebuilds each message from only `id/role/content/timestamp/inspection`, so any extra field such as `parts` or `visuals` would be dropped on read.
  - `appendAgentChatMessages` appends with `messages = COALESCE(messages,'[]'::jsonb) || $json::jsonb`.
  - History sent to the model is capped by `MODEL_HISTORY_MAX_MESSAGES=30` and `MODEL_HISTORY_MAX_CHARS=60_000`, and uses `content` only.
  - [agent-chats.ts:1-60, 66-80, 220-238](src/lib/agents/agent-chats.ts)
- Precedent for structured side data on a message: the `inspection` note. The model calls a dedicated tool, `record_inspection`. Its tool events are hidden from the stream (`inspectionCallIds`). The parsed note is emitted once as an `inspection` SSE event, stored on the assistant message, parsed back by `parseInspection`, and filtered by role (`messagesForViewer`). — [run-catalog-agent.ts:241, 258-262, 296-303](src/lib/agents/run-catalog-agent.ts), [inspection.ts:7-40](src/lib/agents/inspection.ts), [agents/chat/route.ts:182-185](src/app/api/agent-lab/agents/chat/route.ts)
- Agents → Use client: `src/lib/agents/agent-use-chat-stream.ts` (243 lines).
  - It is a module-level store keyed by slug.
  - `AgentUseChatMessage = {id, role, content, inspection?}`. Tool calls are "live only, never persisted".
  - It fetches `/api/agent-lab/agents/chat` and handles `chat`, `inspection`, `text`, `tool_call_running`, `tool_call_result`/`tool_call_error` and `error`.
  - [agent-use-chat-stream.ts:10-28, 154-225](src/lib/agents/agent-use-chat-stream.ts)
- Saved agents can only use `describe_schema` and `execute_tool` (`AGENT_TOOLS`), with `AGENT_MAX_LOOPS = 10`. `runCatalogAgent` is shared by chat (`surface: 'agent_use'`) and Flows `agent-try` (`surface: 'automation'`). — [run-catalog-agent.ts:34-35](src/lib/agents/run-catalog-agent.ts), [flows/agent-try/route.ts:36-42](src/app/api/agent-lab/flows/agent-try/route.ts)
- **Inspector route** `POST /api/inspector/chat` (786 lines):
  - Emits `stream_start`, `loop_start`, `text`, `thinking`, `tool_call_suggested/running/result` (with `output`), `tool_call_error`, `query_result` (columns, rows, sql, rowCount, truncated), `loop_usage`, `text_replace`, `suggestions`, `loop_limit_reached`, `error`, `done` (usage, qualityScore, toolTrajectory…).
  - Tool-emitted events (`semantic_chart_result`, `semantic_disambiguation`, `export_ready`, `semantic_plan/sql/progress`, `chart_spec`, `chart_error`) go through `emitWithTracking`, which is passed to `executeInspectorTool`.
  - [inspector/chat/route.ts:395-540](src/app/api/inspector/chat/route.ts), [tools.ts:111-260](src/lib/inspector/tools.ts)
- The Inspector history sent to the model maps each `{role, content}` to `[{text: m.content}]` and merges consecutive same-role turns. Only text goes back to the model. — [inspector/chat/route.ts:191-209](src/app/api/inspector/chat/route.ts)
- **Inspector client** `useInspectorChat`:
  - Uses `fetch('/api/inspector/chat')` and a manual `getReader()` loop over `data: ` lines (lines 301-340), with a `switch(event.type)` from 341 to about 690.
  - `text` accumulates `rawContent` and stores `sanitize(rawContent)`. `sanitize` strips HTML comments, `<thinking>`, `<query_result>` and `<agent_config…>` tags.
  - `semantic_chart_result` becomes a `SemanticChartMessage {id, kind:'semantic_chart', chartDsl, semanticQuery, sql, echartsOption, rowCount, executedAt, definitionsUsed, resolvedLabels, recommendation}`. These are stored in a **separate** `semanticChartMessages` state, not on the `WorkbenchMessage`.
  - [useInspectorChat.ts:29-51, 152, 301-370, 630-650, 804-811](src/hooks/useInspectorChat.ts)
- The Inspector client switch has **no `chart_spec` or `chart_error` case**, although `emit_chart` emits `chart_spec` (tools.ts:233). Grep finds no other consumer of `chart_spec` in `src`, so emit_chart output appears to reach no UI except through the tool-call card. Flagged; needs runtime confirmation. — [tools.ts:226-250](src/lib/inspector/tools.ts), [useInspectorChat.ts:341-690](src/hooks/useInspectorChat.ts)
- Inspector persistence:
  - The client autosaves after 2 s with `PATCH /api/agent-lab/workbench/sessions/{id}` and body `{messages: localMessages, last_model}`. That is the full `WorkbenchMessage[]`, including `toolCalls` with outputs.
  - The PATCH route copies `messages` through **unvalidated** and computes only `message_count` and `last_message`.
  - On reload, `messages` is restored and `queryResults` are rehydrated from `/api/studio/results`, but `semanticChartMessages` are **not** rehydrated, so semantic charts vanish on reload.
  - [useInspectorChat.ts:209-270](src/hooks/useInspectorChat.ts), [workbench/sessions/[id]/route.ts:95-175](src/app/api/agent-lab/workbench/sessions/[id]/route.ts)
- DB schema: `workbench_sessions.messages Json? @default("[]")`, along with `progress Json?`, `surface String?` and `context_mode`. Query results persist in `studio_query_results` (profiles, specs, chart_overrides). The ORM is Prisma 5.22 (`prisma/schema.prisma`). — [schema.prisma:170-202](prisma/schema.prisma)
- **Agent loop** (`runAgentLoop`):
  - Uses Bedrock `ConverseStreamCommand` with `inferenceConfig.maxTokens: 4096` and temperature 1 with thinking or 0.3 without. Thinking `budget_tokens: 1024` applies to Anthropic models.
  - Text deltas pass through `stripInspectorMarkup` per delta, which removes `<!--…-->`, `<thinking>` and `<query_result>`, and then go to `onTextChunk`.
  - [agent-loop.ts:103-108, 160-215](src/lib/inspector/agent-loop.ts)
- `ToolCallEvent` union: `tool_call_suggested | tool_call_running | tool_call_result | tool_call_error | query_result`. — [agent-loop.ts:67-72](src/lib/inspector/agent-loop.ts)
- Non-Bedrock models (Foundry, xAI, LLM Lite) go through `dispatchAgentLoop` in `src/lib/inspector/providers/factory.ts` / `foundry-chat.ts`, with the token parameter set by `buildTokenConfig`. — [foundry-chat.ts:83-86](src/lib/inspector/providers/foundry-chat.ts), [inspector/chat/route.ts:536-540](src/app/api/inspector/chat/route.ts)
- **Workbench** uses `useWorkbenchChat` → `POST /api/agent-lab/workbench/chat`. That stream carries `text`, `thinking`, `suggestions`, `class_suggestion`, `readiness`, `agent_construction_patch`, `construction_state`, tool events, `done` and `error`. — [useWorkbenchChat.ts:211-415](src/hooks/useWorkbenchChat.ts), [workbench/chat/route.ts:176-311](src/app/api/agent-lab/workbench/chat/route.ts)
- **Test run** uses `TestRunSection` → `POST /api/agent-lab/workbench/test-run` (SSE). — [TestRunSection.tsx:83](src/components/workbench/config/TestRunSection.tsx), [test-run/route.ts:101,193](src/app/api/agent-lab/workbench/test-run/route.ts)
- **Flows copilot** (`POST /api/agent-lab/flows/copilot`) is **non-streaming** JSON. It uses zod to validate `{definition, message, history[{role,text}]}`, `maxDuration=120`, and returns a typed edit proposal. — [flows/copilot/route.ts:1-60](src/app/api/agent-lab/flows/copilot/route.ts)
- The Vite dev proxy notes "SSE streams (chat, logs) pass through unbuffered". — [web/vite.config.ts proxy comment](web/vite.config.ts)

### Inferences
- Two transport designs fit the existing pattern.
  - (a) **Inline fenced specs in text.** No protocol change is needed. They persist for free as `content`, replay into history, work on every surface including the non-streaming copilot, and are counted in the 60k-char history budget and the 4096 output-token cap.
  - (b) **A `render_visual` tool plus a new SSE event** (`visual` / `artifact`) stored as `parts` on the message, following the `inspection` precedent. This is cleaner for big payloads and validation (zod/ajv on the server), but it needs edits in each route, each client hook, `parseChatMessages`, `AgentChatMessage`, `AgentUseChatMessage` and `WorkbenchMessage`.
  - A hybrid is possible: the tool emits a placeholder token such as `[[visual:id]]` in the text, and the structured payload lives in `parts`.
- `maxTokens: 4096` (agent-loop.ts:174) is a hard ceiling. A full HTML artifact or a large SVG inside a text reply will truncate. The plan should raise the cap for visual turns or keep specs compact (chart JSON rather than raw SVG/HTML).
- `stripInspectorMarkup` and the client `sanitize()` both remove `<!-- -->` comments, which can appear in model-written SVG/HTML. The server version works per delta, so a comment split across chunks survives on the server but is removed by the client's whole-text `sanitize` (Inspector only). Raw SVG/HTML in text should be fenced and treated as code, and these strippers should skip fenced regions.
- The Inspector already has chart SSE events and cards, but they are shown in a side pane, not inline, and are lost on reload. An inline chart part would need persistence that Inspector charts currently lack.
- Agent-use `tool_call_result` drops `output`, so a client cannot build a chart from tool results unless a new event carries the data.

### Gaps
- I did not read the full `useWorkbenchChat` event handler or the workbench chat route's persistence path. I assume, without verifying, that it is similar to the Inspector (PATCH of sessions).
- I did not verify how `dispatchAgentLoop` (Foundry/OpenAI) streams text, or its max-token limit value.
- No dedicated `messages` table exists. All chat messages are JSON arrays in `workbench_sessions`. I found no migration constraints on the JSON shape.

## 3. Chart infrastructure: ChartDSL → ECharts, themes, renderers

### Takeaway
A typed chart DSL already exists (`ChartDSLSpec`, JSON Schema, validator with repair, compiler to an ECharts option). It works over **query-result rows plus column profiles**, not inline data. ECharts 6.1 is tree-shaken through a single chokepoint module that registers `aloft-dark`/`aloft-light`/`inspector-dark`/`inspector-light` themes. `StudioChart` switches theme with `useIsDark()`. A second charting stack, Recharts 2.15, powers `DashboardPane`.

### Cited Findings
- `ChartDSLSpec {id, kind, title, subtitle?, encodings: ChartEncoding[], filters?, sort?, limit?, themeSlot?: 'aloft-dark'|'aloft-light'}`. Kinds: `bar | stacked-bar | line | area | pie | scatter | heatmap | boxplot | histogram`. An encoding is `{columnId, role: x|y|series|value|color|size, aggregate?}`. — [chart-dsl.ts:1-32](src/lib/studio/chart-dsl.ts)
- `src/lib/studio/types.ts`:
  - Re-exports the DSL types.
  - Defines `ChartSpec {id, kind: kpi|bar|line|donut|scatter|heatmap|histogram, title, rationale, x?, y?, series?, value?, echartsOption: object, dsl?, rank, alternatives}`.
  - Defines `ColumnProfile` and `ProfileResult`.
  - [types.ts:1-32](src/lib/studio/types.ts)
- `src/lib/studio/chart-dsl.schema.json` (98 lines) is the JSON Schema used as the `emit_chart` tool input schema and in `chart-emitter`. — [prompts.ts:150-165](src/lib/inspector/prompts.ts), [chart-emitter.ts:8](src/lib/inspector/chart-emitter.ts)
- Pipeline:
  - `validateAndRepair(toolInput, profileResult)` (`src/lib/studio/validator.ts`) → `compileSpecToOption(spec, profile, rows, theme)` (`src/lib/studio/compiler.ts:436-461`).
  - The compiler picks a per-kind function from `KIND_COMPILERS`, applies `limit`, and sets the title structurally. Theme colors come from the registered theme, not the option.
  - [compiler.ts:436-461](src/lib/studio/compiler.ts), [tools.ts:215-250](src/lib/inspector/tools.ts)
- `emit_chart` (Inspector tool) prefers the inline DSL in the tool input and falls back to `chart-emitter` / pipeline repair. `chart-emitter.ts` is a separate non-streaming Bedrock `ConverseCommand` with `toolChoice` forced to `emit_chart`, `maxTokens 1024`, `temperature 0`. — [chart-emitter.ts:47-121](src/lib/inspector/chart-emitter.ts)
- `chart-pipeline.ts` (511 lines) runs the semantic chart pipeline. It calls `runSemanticChartPipeline({query, connectionId, model, sessionId, intent, onProgress})` and returns `{sql, spec, option, rowCount, executedAt, definitionsUsed, resolvedLabels, recommendation}`. It uses `themeSlot ?? 'aloft-dark'`. — [tools.ts:141-185](src/lib/inspector/tools.ts), [chart-pipeline.ts:52,153,284](src/lib/inspector/chart-pipeline.ts)
- **ECharts chokepoint**: `src/lib/studio/echartsCore.ts`. Its comment reads "all Studio code imports echarts from this module only. Never import from the 'echarts' barrel directly — bundle size invariant". It registers Bar/Line/Pie/Scatter/Heatmap charts; Grid/Tooltip/Legend/DataZoom/Toolbox/Title/VisualMap components; Canvas **and SVG** renderers. It registers themes `aloft-dark`, `aloft-light` (from `aloftDarkTheme.ts`), `inspector-dark` and `inspector-light` (Okabe-Ito, `inspectorEchartsTheme.ts`). Histogram is a BarChart. Boxplot is **not** registered, even though the DSL allows it. — [echartsCore.ts:1-50](src/lib/studio/echartsCore.ts)
- `aloftDarkTheme.ts` holds hard-coded hex values and font names because "CSS vars not readable in SSR". The inspector theme says the same: ECharts reads a plain JS theme object, so CSS custom properties cannot be used. — [aloftDarkTheme.ts:2,117](src/lib/studio/aloftDarkTheme.ts), [inspectorEchartsTheme.ts:1-30](src/lib/studio/inspectorEchartsTheme.ts)
- `StudioChart`:
  - Lazy-loads `echarts-for-react` with `React.lazy` "so ECharts stays out of the initial bundle".
  - Picks `chartTheme = isDark ? 'aloft-dark' : 'aloft-light'` with `useIsDark()`. echarts-for-react re-initializes when the theme changes.
  - Overlays theme-aware tooltip styles that use `FONT_MONO` and `CHART_TEXT.tooltip`.
  - Resizes with a ResizeObserver.
  - Still imports the legacy `spinorEchartsTheme`.
  - [StudioChart.tsx:1-80](src/components/studio/StudioChart.tsx)
- `SemanticChartCard` builds a minimal `ChartSpec` around the precompiled `echartsOption` and renders `<StudioChart spec={spec} height={260} />`. — [SemanticChartCard.tsx:5, 90, 290](src/components/inspector/SemanticChartCard.tsx)
- `DashboardPane` (778 lines) renders query results with **Recharts** (`BarChart, LineChart, AreaChart, PieChart, ScatterChart, ResponsiveContainer`), not ECharts. — [DashboardPane.tsx:6-10, 267-397](src/components/inspector/DashboardPane.tsx)
- Server-side PNG rendering exists in `src/lib/studio/ssr-render.ts` (resvg; noted in ARCHITECTURE.md §SSR Rendering, line 647). `/api/inspector/digest` builds specs with `themeSlot: 'aloft-dark'`. — [digest/route.ts:94,154](src/app/api/inspector/digest/route.ts)
- Viz palettes live in `src/lib/dashboards/inspector-viz-tokens.ts`: `OKABE_ITO`, `CATEGORICAL` (cap 6), `PREVIEW_PALETTE` (gold → slate blues), `TWO_SERIES`, `VIRIDIS` sequential, `OKABE_ITO_OTHER`. — [inspector-viz-tokens.ts:40-80](src/lib/dashboards/inspector-viz-tokens.ts)
- Test infrastructure for charts: `vitest.setup.ts` globally mocks `echarts-for-react/lib/core` as a `<div data-testid="echarts-mock" data-echarts-theme=…>`, because jsdom has no canvas. Existing tests: `inspector-echarts-theme.test.ts`, `chart-defaults.test.ts`, `raw-sql-chart.test.ts`, `SamplePreviewChart.test.tsx`, `chart-mapping.test.ts`. — [vitest.setup.ts:1-30](vitest.setup.ts)

### Inferences
- An inline chat chart could reuse `ChartDSLSpec`, but the DSL refers to `columnId`s in a query result. For model-authored inline charts there are two options: (a) extend the DSL with an inline `data: rows[]` (plus profiles computed client-side with `src/lib/studio/profiler.ts`), or (b) reference a `query_result` by id. Option (a) is simpler for Agents → Use, where results never reach the client.
- `compileSpecToOption` and `validateAndRepair` can probably run in the browser (they are imported dynamically in tools.ts). Their imports should be checked for server-only code; `web:check-bundle` will catch Prisma, AWS or pg leaks.
- New chart kinds (boxplot) or components (MarkLine, Dataset, Polar) must be added to `echartsCore.ts`. A raw "ECharts option" spec from the model would need an allowlist, because unregistered series types silently fail.
- The SVG renderer is already registered. It is useful for crisp inline charts and for theme-safe export.

### Gaps
- I did not read `validator.ts` or `compiler.ts` imports in full to confirm they are browser-safe.
- I did not inspect `aloftDarkTheme.ts` palette values in detail.

## 4. Prompts: where system prompts are built and the best shared injection point

### Takeaway
Each surface builds its own system prompt. Two shared constants in `src/lib/inspector/answer-rules.ts` are already concatenated into both the Inspector prompts and the saved-agent runtime prompt, so they are the natural single place for a shared "visual response" guideline. The Inspector has two near-duplicate `## RESPONSE FORMAT` sections. Workbench, Flows copilot and Automate build prompts separately.

### Cited Findings
- `answer-rules.ts` exports `ANSWER_COMPLETENESS_RULES` (`## ANSWER CONTENT`, which includes "The chat shows row lists as tables") and `AGENT_ANSWER_VOICE` (`## HOW TO WRITE THE ANSWER`, which includes "Put records in a markdown table…"). The file header calls it "Answer-content rules shared by Inspector and saved agents". — [answer-rules.ts:1-30](src/lib/inspector/answer-rules.ts)
- Inspector prompts:
  - `INSPECTOR_SYSTEM_PROMPT` (line 16) and `INSPECTOR_WAREHOUSE_ONLY_PROMPT` (line 87) each embed `${ANSWER_COMPLETENESS_RULES}` (lines 77 and 123) and a `## RESPONSE FORMAT` block (lines 79-85 and 125-131). That block says to use `##` headings and GFM tables with right-aligned numbers, prefer bullets, bold key numbers, not narrate tool steps, and end with 2–3 follow-up suggestions.
  - `buildSystemPrompt(contextMode, semanticContext)` appends the semantic section.
  - [prompts.ts:16-131, 446-454](src/lib/inspector/prompts.ts)
- The Inspector route assembles `[basePrompt, insightsContext, sessionKnowledgeContext]`, then memory blocks `p0Block`/`p1aBlock` (feature-flagged), giving `finalSystemPrompt`. — [inspector/chat/route.ts:228-283](src/app/api/inspector/chat/route.ts)
- Inspector tool descriptions already steer charts: `emit_chart` ("Call this whenever the user asks for a chart… themeSlot 'aloft-dark' default") and `EMIT_SEMANTIC_CHART_TOOL` / `EMIT_DISAMBIGUATION_TOOL` (added only when a semantic model exists, via `buildToolConfig`). — [prompts.ts:150-165, 299-380](src/lib/inspector/prompts.ts)
- Saved agents: `runCatalogAgent` builds `[buildRuntimeSystemPrompt({...brief, mode:'live'}), knowledgePrompt(knowledge), INSPECTION_PROMPT?, FINAL ANSWER submit rule?]`. — [run-catalog-agent.ts:226-234](src/lib/agents/run-catalog-agent.ts)
- `buildRuntimeSystemPrompt` (construction/prompts.ts) contains intro, `## YOUR INSTRUCTIONS` (catalog instructions), `## DATA SOURCES`, `## DATA RULES` (including "Use markdown. Put key numbers in bold."), `${ANSWER_COMPLETENESS_RULES}` and `${AGENT_ANSWER_VOICE}`. Test runs reuse it with `mode:'test'` (`buildTestRunSystemPrompt`). — [construction/prompts.ts:76-118](src/lib/construction/prompts.ts)
- Workbench chat uses `buildWorkbenchSystemPrompt(stateRef, …)` (construction/prompts.ts:43) and `buildWorkbenchToolConfig`. — [workbench/chat/route.ts:12-13, 176-182](src/app/api/agent-lab/workbench/chat/route.ts)
- Flows copilot uses `proposeFlowEdit` in `src/lib/flows-copilot/propose.ts`, which returns structured edit operations rather than prose answers. — [flows/copilot/route.ts:9](src/app/api/agent-lab/flows/copilot/route.ts)
- `runCatalogAgent` also serves `surface: 'automation'` (Flows agent-try), whose output is machine-consumed and may be submitted through the `submit_answer` tool. — [flows/agent-try/route.ts:36-42](src/app/api/agent-lab/flows/agent-try/route.ts), [run-catalog-agent.ts:230-232](src/lib/agents/run-catalog-agent.ts)

### Inferences
- Best single injection point: add a new exported constant such as `VISUAL_RESPONSE_RULES` in `src/lib/inspector/answer-rules.ts`, and reference it next to `ANSWER_COMPLETENESS_RULES` in `INSPECTOR_SYSTEM_PROMPT`, `INSPECTOR_WAREHOUSE_ONLY_PROMPT` and `buildRuntimeSystemPrompt`. That reaches Inspector, Agents → Use and Test run with three one-line edits. `buildWorkbenchSystemPrompt` would need it added separately if Workbench should produce visuals.
- `buildRuntimeSystemPrompt` is also used for `surface:'automation'`, where visuals have no viewer. The rule should depend on the surface (e.g. a `visuals: boolean` option, or adding it in `runCatalogAgent` only when `surface==='agent_use'`).
- The rule must be reconciled with `AGENT_ANSWER_VOICE` ("Put records in a markdown table") and the Inspector `RESPONSE FORMAT`. Otherwise the model gets conflicting instructions.
- In the Inspector, the emit_chart / emit_semantic_chart tools already exist for data-bound charts. An inline-visual rule should say when to use a tool-backed chart versus an inline spec, to avoid duplicate charts.

### Gaps
- I did not read `buildWorkbenchSystemPrompt` (construction/prompts.ts:43-75) or `flows-copilot/propose.ts` prompts in full.
- I did not check whether `knowledgePrompt` or memory blocks impose format rules.

## 5. Theming and design system: tokens, typography guard, dark/light

### Takeaway
Theme is a `.dark`/`.light` class on `<html>` (next-themes, `attribute="class"`). Tokens are CSS custom properties: `--brand-a*`, `--surface-1..3`, `--line-1/2`, `--ink-1..3`, `--ok/--warn/--bad(+-bg)` and `--wb-*`. The user can override accent and sidebar colors at runtime. Typography uses `type[...]` tokens from `src/lib/typography/tokens.ts`. A vitest "typography guard" fails CI if hard-coded font sizes, weights 700/800, letter-spacing or font-family literals grow beyond a baseline, or if fonts load from a CDN.

### Cited Findings
- Global tokens:
  - `:root` (light): `--brand-a:#5B3DF5 … --surface-1:#FFFFFF --line-1:#E3E5EE --ink-1:#111322 --ok:#0F7A3D --ok-bg --warn --warn-bg --bad --bad-bg`.
  - Workbench tokens: `--wb-canvas, --wb-surface, --wb-surface2, --wb-muted, --wb-ink, --wb-ink-dim, --wb-border-subtle`.
  - `.dark` overrides start at line 236.
  - A final block at lines 1615-1660 overrides the accent per mode: light `--brand-a:#A8481F` (terracotta), dark `--brand-a:#3B78FF`. It "match[es] buildAppearanceVars() in src/lib/theme/appearance.ts".
  - [globals.css:18-40, 128-140, 236-256, 1615-1660](src/app/globals.css)
- User-customizable appearance: `src/lib/theme/appearance.ts` exports `ACCENT_PRESETS`, `RAIL_PRESETS`, `contrast()`, `buildAppearanceVars`, `loadAppearance`, `applyAppearance` (writes CSS variables at runtime), and `APPEARANCE_KEY='aloft-appearance'`. — [appearance.ts:10-248](src/lib/theme/appearance.ts)
- DESIGN_SYSTEM.md §1:
  - next-themes with `attribute="class"`, `defaultTheme="system"` and `storageKey="theme"`. Tailwind uses `darkMode:'class'`.
  - A blocking boot script prevents flash.
  - Use `useIsDark()` when inline styles branch on theme.
  - Scoped subsystems use `.workbench-frame` / `.agent-graph`.
  - [DESIGN_SYSTEM.md:15-36](docs/DESIGN_SYSTEM.md)
- DESIGN_SYSTEM.md §8 says to prefer `@/components/ui/*` shared primitives (from `packages/aloft-shared`) over hand-rolled Tailwind palette classes. — [DESIGN_SYSTEM.md:464-470](docs/DESIGN_SYSTEM.md)
- `useIsDark()` returns the cookie snapshot before mount, then `resolvedTheme === 'dark'`. — [useIsDark.ts](src/hooks/useIsDark.ts)
- Typography tokens:
  - `FONT_SANS` ('Inter Variable', 'Inter', …) and `FONT_MONO` ('IBM Plex Mono', …).
  - `TYPE_TOKEN_NAMES`: display, title-page, title-section, title-card, body-lg, body, ui-lg, ui, ui-regular, label, caption, eyebrow, kpi-lg/md/sm, code, code-inline.
  - `type[name]` resolves to `var(--type-${name}-size/weight/ls/lh)`.
  - `CHART_TEXT = {axis:11, legend:12, tooltip:13, kpi:28}`.
  - `inkOf(color, amount)`.
  - Values live in `src/styles/typography.css`.
  - [tokens.ts:9-47](src/lib/typography/tokens.ts)
- **Typography guard** (`src/lib/typography/__tests__/typography-guard.test.ts`). It walks `src` and skips `__tests__`, `node_modules` and `api`.
  - (1) Only `Inter Variable`, `Inter`, `IBM Plex Mono` or generic families may be named, in CSS `font-family:` or TS `fontFamily:` literals.
  - (2) No `fonts.googleapis.com` / `fonts.gstatic.com`.
  - (3) No retired Tailwind sizes (`text-xs|sm|base|lg|xl|2xl…`) or `font-serif|display|body`.
  - (4) Counts may only shrink against `typography-baseline.json`: `inlineFontSize 232`, `arbitraryTextSize 0`, `inlineFontFamilyLiteral 52`, `inlineLetterSpacing 296`, `heavyWeights 1`.
  - The most recent CI fix (commit a3b37930) changed `fontWeight 700→600` to pass `heavyWeights`.
  - [typography-guard.test.ts:1-100](src/lib/typography/__tests__/typography-guard.test.ts), [typography-baseline.json](src/lib/typography/__tests__/typography-baseline.json), [CHANGELOG 2026-10-30](docs/CHANGELOG.md)
- The guard regexes match source text, so they also match template strings in `.ts/.tsx`. Example: a `fontSize: 12` inside a JS object used to build iframe HTML or an ECharts option counts toward `inlineFontSize`. — [typography-guard.test.ts:75-82](src/lib/typography/__tests__/typography-guard.test.ts)

### Inferences
- New visual components must use `type[...]` / `var(--type-*)` and `CHART_TEXT` constants, never numeric `fontSize`, `fontWeight: 700` or `letterSpacing` literals, and only Inter or IBM Plex Mono fonts. Model-generated SVG/HTML is data, not source, so the guard does not see it. But any **built-in template** for the sandbox (CSS reset, theme stylesheet) written in `.ts` is scanned. Something like `font-family: Inter` is fine. Something like `font-family: 'Roboto Slab'` would fail.
- A sandboxed iframe (opaque origin) does not inherit the parent's CSS variables or the self-hosted @fontsource fonts. The host must inject resolved token values (read from `getComputedStyle(document.documentElement)`, including user-customized `--brand-a`) and update them when the theme or appearance changes, for example via `postMessage`. Fonts inside the sandbox fall back to system fonts unless they are inlined. A CDN is forbidden by the guard's spirit and by CSP plans.
- ECharts themes are hard-coded hex. The `aloft-dark` palette (gold/navy) predates the current accent tokens (terracotta light / blue dark), so inline charts may not match a customized accent. A runtime theme built from `getComputedStyle` (client only) could fix this.

### Gaps
- I did not read `src/styles/typography.css` values or the full `aloftDarkTheme.ts` palette.
- DESIGN_SYSTEM.md references `src/app/layout.tsx` for the boot script, but that file does not exist (the UI is now Vite, see §6). The boot script lives in `web/vite.config.ts` plus `src/lib/theme/appearance-boot-script.ts`. The documentation is stale.

## 6. Framework, build and security constraints

### Takeaway
The browser UI is **not** a Next.js app. It is a Vite + React Router 7 SPA in `/web`, built to `public/spa`. Next.js 16.4.2 serves only `/api/**`, static files and the SPA `index.html`. React is 18.3.1. Global headers set `X-Frame-Options: DENY` and a minimal CSP (`frame-ancestors 'none'; base-uri 'self'; object-src 'none'`), with no script/style restrictions. No sandbox route or subdomain exists. No sanitizer (DOMPurify), markdown library, syntax highlighter or Mermaid is installed.

### Cited Findings
- `next.config.ts`:
  - Its comment says "Next.js is the API and auth server only. The browser UI is the Vite + React Router app in /web, built to `public/spa`".
  - A `beforeFiles` rewrite sends every non-`api/`, non-`_next/`, non-`spa/`, extension-less path to `/spa/index.html`.
  - `output: "standalone"`, `poweredByHeader: false`.
  - `optimizePackageImports` covers lucide, phosphor, framer-motion, echarts, recharts and @xyflow/react.
  - `serverExternalPackages`: pdfjs-dist, @napi-rs/canvas, @firecrawl/pdf-inspector.
  - [next.config.ts:1-68](next.config.ts)
- Global headers for `/:path*`: `X-Frame-Options: DENY`; `Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; object-src 'none'`; `nosniff`; `Referrer-Policy strict-origin-when-cross-origin`; HSTS; `Permissions-Policy camera=(), geolocation=(), payment=(), usb=()`. The comment: "The CSP is deliberately limited to directives that cannot break the SPA (no script/style restrictions); a full CSP should be rolled out via Report-Only first." `/spa/index.html` is `no-cache`, and `/spa/assets/*` is immutable. — [next.config.ts:25-42](next.config.ts)
- `src/proxy.ts` (the Next 16 "proxy", formerly middleware) is the API login gate. It returns JSON 401 when there is no next-auth JWT. Matcher: `/api/((?!auth(?:/|$)|health$).*)`. — [proxy.ts:1-27](src/proxy.ts)
- Vite config:
  - `root: web/`, `base: '/spa/'` on build, `@` alias pointing to `src/` (UI code under `src/` is shared).
  - Boot scripts inject the theme class and `APPEARANCE_BOOT_SCRIPT` inline in `<head>`.
  - The dev proxy sends `/api` to `:3001`.
  - `build.outDir web/dist`, `chunkSizeWarningLimit: 900`.
  - Only `VITE_*` env vars reach the browser.
  - [web/vite.config.ts](web/vite.config.ts), [web/index.html](web/index.html)
- Routes are lazy-loaded with React Router `lazy: page(() => import('@/views/...'))`. — [web/src/router.tsx:30-51](web/src/router.tsx)
- `web:check-bundle` (`web/e2e/check-bundle.mjs`) fails the build if `web/dist/assets/*.js` contains server markers: `.prisma/client`, `PrismaClient`, `@aws-sdk/`, `@smithy/`, `bcryptjs`, `pg-protocol`, `jose/dist`, `NEXTAUTH_SECRET`, `DATABASE_URL`. — [check-bundle.mjs:1-45](web/e2e/check-bundle.mjs)
- Versions: next 16.4.2, react 18.3.1 (package.json `^18.2.0`), echarts 6.1.0 (verified with `node -e require(...)`). Other dependencies:
  - `echarts-for-react 3.0.6`, `recharts 2.15.4`, `@xyflow/react 12.10.2`, `dagre 0.8.5`
  - `framer-motion ^12.38`, `zod 3.25.76`, `ajv 8.20.0`
  - `@resvg/resvg-js 2.6.2`, `next-themes ^0.4.6`, `react-router 7.18.4`
  - `@tanstack/react-query 5.101`, `zustand 4.5`, `uuid 14`
  - [package.json](package.json)
- **Not installed**: dompurify, isomorphic-dompurify, sanitize-html, react-markdown, remark, rehype, marked, markdown-it, shiki, prismjs, highlight.js, mermaid, katex (`ls node_modules` grep). d3-* packages exist only as transitive dependencies (d3-array, d3-scale, d3-shape, d3-selection, d3-zoom, …), not as direct dependencies. — [package.json](package.json)
- Package manager: npm (`package-lock.json`, `workspaces: ["packages/*"]`, `@aloft/shared` workspace). Test runner: **vitest 4.1** (`npm test` = `vitest run`), default environment `node`, with jsdom opted in per file through a `// @vitest-environment jsdom` docblock, and `include: src/**/*.{test,spec}.{ts,tsx}`. A separate `web:test` uses `web/vitest.config.ts`. Lint is ESLint 9 flat config with `eslint-config-next` core-web-vitals and `--max-warnings 0`. A few rules are turned off (no-explicit-any, exhaustive-deps, …). No custom `no-restricted-imports` rule exists, so the echarts chokepoint is enforced by convention only. — [vitest.config.ts](vitest.config.ts), [eslint.config.cjs:20-45](eslint.config.cjs), [package.json scripts](package.json)
- Next's bundled CSP guide (`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`) says nonces need dynamic rendering through Proxy. "Static pages are generated at build time… no nonce can be injected." — [content-security-policy.md:24-38, 179-187](node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md)
- No `<iframe>`, `sandbox=` or `srcdoc` usage exists in `src` or `web/src`. No route serves artifact HTML. No separate sandbox origin is configured (nothing found in next.config, proxy or infra grep within scope).

### Inferences
- Next.js "client component" and `next/dynamic` guidance is largely irrelevant for UI work. The UI is a Vite SPA, so use `React.lazy` / dynamic `import()` (as `StudioChart` does) to keep heavy renderers (ECharts, Mermaid, a sandbox runtime) out of the main chunk. The files still carry `'use client'` directives, which are harmless in Vite.
- Sandbox options, given the current headers:
  - (a) `<iframe sandbox="allow-scripts" srcdoc=…>` (no `allow-same-origin`) gives an opaque origin with no cookie or API access. `X-Frame-Options: DENY` and `frame-ancestors 'none'` do not block srcdoc frames, because those headers govern framing of a fetched response. A srcdoc document inherits the embedder's CSP (`object-src 'none'`, `base-uri 'self'`), which is benign. I could not confirm in-repo how the browser's inheritance applies, so test it.
  - (b) A dedicated Next API route (e.g. `/api/artifacts/frame`) that serves HTML would be **blocked** by the global `X-Frame-Options: DENY` / `frame-ancestors 'none'` unless that path gets its own header override. It is also same-origin with the app, which is unsafe for untrusted HTML unless the frame is sandboxed without `allow-same-origin`.
  - (c) A separate sandbox origin/subdomain does not exist and would need infra work (ECS/CloudFront, outside this investigation).
- Because the parent CSP has no `script-src`/`style-src`, inline SVG injected with `dangerouslySetInnerHTML` would run any `<script>` or `on*=` handler with full app privileges (cookies, `/api` with the session). Model-authored SVG must be sanitized before inline injection (add DOMPurify, or parse and re-emit an allowlist), or be rendered as `<img src="data:image/svg+xml,…">`, which disables scripts but loses theme variables and interactivity, or go inside the sandbox iframe.
- `zod` and `ajv` are already available for validating visual specs on the server and client. `ajv` is already used with JSON Schema for chart DSL validation paths.
- Any new client module must not import from `src/lib/inspector/prompts.ts`, `tools.ts` or `run-catalog-agent.ts` (Prisma/AWS imports), or `web:check-bundle` fails. A shared visual-spec schema should live in a client-safe module (like `src/lib/studio/chart-dsl.ts`).

### Gaps
- I did not inspect `infra/` or the Dockerfile for CloudFront or ALB-level headers that might add CSP or framing rules in production.
- I did not test whether srcdoc frames inherit this CSP in the target browsers.
- ARCHITECTURE.md's Frontend table still says "Next.js 15.5 — App Router, SSR" and "React 18.2" (ARCHITECTURE.md:115-131). That contradicts package.json (16.4.2) and the Vite SPA. The documentation is stale.

## 7. Project conventions, docs and tests a plan must respect

### Takeaway
Every change must be logged in `docs/CHANGELOG.md`, newest first, with What, Why, Verified and Not done. A Stop hook reminds the agent. Architecture docs describe the SSE-first Inspector but are partly stale. The relevant test suites are the AssistantContent jsdom test, the agent chat route and stream tests, the agent-chats persistence test, and the typography guard.

### Cited Findings
- CLAUDE.md: "Log every change in `docs/CHANGELOG.md` (newest first): what changed, file paths, why, how it was verified, and what is not done. A Stop hook (`.claude/hooks/changelog-guard.mjs`) reminds you…". AGENTS.md: "This is NOT the Next.js you know… Read the relevant guide in `node_modules/next/dist/docs/`". — [CLAUDE.md](CLAUDE.md), [AGENTS.md](AGENTS.md)
- CHANGELOG entry format (example): headings `## <date> — <title>` or `## <title>`, with bullets **What / Why / Unchanged / Verified / Not done**. The newest entry ("Agent chat: Inspect for platform admins and admins") documents the `inspection` side-channel pattern. — [docs/CHANGELOG.md:1-20](docs/CHANGELOG.md)
- ARCHITECTURE.md §5.7 "Streaming-First Agent Architecture": the Inspector streams text chunks, tool call events, query results and "Chart DSL events for live rendering". §7.1 covers Inspector conversational analytics, §8.1 the Inspector chat journey, and line 647 SSR rendering. — [ARCHITECTURE.md:298-305, 370, 647, 707](ARCHITECTURE.md)
- `docs/inspector-architecture.html` sections: harness layers, end-to-end flow, sessions and context mode, server context stack, agent loop, tools, sub-pipelines, UI composition, after each turn, related surfaces, limits and non-goals, key files. — [inspector-architecture.html](docs/inspector-architecture.html)
- Relevant existing tests:
  - `src/components/workbench/__tests__/AssistantContent.json-table.test.tsx` and `json-table.test.ts`
  - `src/app/api/agent-lab/agents/__tests__/chat.route.test.ts` (modified in the working tree) and `chats.route.test.ts`
  - `src/lib/agents/__tests__/agent-chats.test.ts`
  - `src/lib/agents/__tests__/agent-use-chat-stream.test.ts`
  - `src/lib/inspector/__tests__/client-stream-error.test.ts`
  - `src/lib/studio/__tests__/inspector-echarts-theme.test.ts`
  - `src/lib/typography/__tests__/typography-guard.test.ts`
  - Security tests: `src/app/api/__tests__/security-hardening.test.ts`, `authz-hardening.test.ts`, which reference `workbench_sessions`
  - `web/src/tailwind-content.test.ts`
  - The CI baseline per CHANGELOG 2026-10-30: "Full `vitest run` 131 files / 937 tests passed; `tsc --noEmit` clean".
  - [find src -path "*__tests__*"](src), [CHANGELOG](docs/CHANGELOG.md)
- The user's memory notes that ALOFT and DATA360 must never share settings, keys or logs. That is relevant if a sandbox origin or CDN is proposed. — [MEMORY.md](C:/Users/senthilnathan.s/.claude/projects/c--ALOFT-aloft-ui-redesign/memory/MEMORY.md)

### Inferences
- A plan should budget for: new jsdom tests for each block type, including streaming (unclosed fence), invalid spec fallback to a code block, and sanitizer removal of `<script>`/`on*`; route tests for any new SSE event; a `parseChatMessages` round-trip test if `parts` are added; and keeping the typography baseline flat.
- The docs to update would be `docs/CHANGELOG.md` (mandatory), `ARCHITECTURE.md` §5.7 (new event types) and `docs/inspector-architecture.html` (UI composition), and possibly `docs/DESIGN_SYSTEM.md` (visual block tokens).

### Gaps
- I did not read `.claude/hooks/changelog-guard.mjs`.
- I did not check the CI workflow files in `.github/workflows` for which commands gate merges (vitest, lint, typecheck, web:check-bundle).
