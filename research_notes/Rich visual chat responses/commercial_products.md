# How Claude (claude.ai) and ChatGPT deliver rich visual chat responses (as of Nov 2026)

Scope note: notes compiled 2026-11-01. "Documented" = vendor docs, vendor blog posts or specs. "Reverse-engineered" = third-party inspection of network traffic, leaked prompts or exported conversations. "Observed" = seen first-hand in this research session's own tooling (the Claude Code Artifact tool contract). Every claim has a source, or it is listed under Gaps. Twenty tool calls were used, so some vendor pages could not be fetched (openai.com returned 403). Those items are marked.

## Claude Artifacts: types, rendering, sandbox, libraries, emission format, streaming, versioning

### Takeaway
Artifacts are a side-panel surface for lasting deliverables. The original (2024 to 2025) system emitted XML-like artifact tags with a MIME `type`, choosing from six types (code, markdown, HTML, SVG, Mermaid, React). They render in a cross-origin sandboxed iframe on `claudeusercontent.com` under a strict CSP that blocks network egress. React artifacts run with a fixed library set (React, Tailwind, lucide-react, recharts, shadcn/ui and a few more). By 2026, published artifacts each get their own origin, `<uuid>.frame.claudeusercontent.com`, served through signed frame URLs, and a parent-page postMessage bridge mediates privileged calls (`window.claude.complete`, connectors).

### Cited Findings

**Emission format (leaked system prompt, the 2024-era Claude 3.5 Sonnet version)**
- Artifacts are emitted as tags with an `identifier` attribute (kebab-case, reused when the artifact is updated), a `title` attribute, a `type` attribute, and `language` for code artifacts — [dazeb gist, Claude System Prompt Artifact](https://gist.github.com/dazeb/f41920dcb9cb8faba6803e821b600e8d); [danielturus gist, Claude 3.5 Sonnet full artifacts prompt](https://gist.github.com/danielturus/f32c7778c515786e8423de22abeb69f8)
- The older 3.5 Sonnet copies use the `antArtifact` / `antartifact` tag name. The type values are MIME-like strings — [WebSearch summary of leaked prompt copies; Pliny leak on X, June 2024](https://x.com/elder_plinius/status/1804052791259717665?lang=en)
- The six types and their MIME strings are `application/vnd.ant.code` (code), `text/markdown` (documents), `text/html` (HTML pages), `image/svg+xml` (SVG), `application/vnd.ant.mermaid` (Mermaid diagrams) and `application/vnd.ant.react` (React components) — [dazeb gist](https://gist.github.com/dazeb/f41920dcb9cb8faba6803e821b600e8d)
- Before creating an artifact, the model reasons in one sentence inside a hidden `antThinking` tag about whether the content qualifies, and whether it is new or an update — [dazeb gist](https://gist.github.com/dazeb/f41920dcb9cb8faba6803e821b600e8d); [HN discussion "Claude uses hidden chain of thoughts to plan artifact use"](https://news.ycombinator.com/item?id=40903135)
- Use artifacts for "Substantial content (>15 lines)" that is likely to be modified, reused or taken outside the conversation. Avoid them for short snippets, explanations, one-off questions and feedback on an existing artifact. "If unsure, don't create an artifact" — [dazeb gist](https://gist.github.com/dazeb/f41920dcb9cb8faba6803e821b600e8d)
- An update reuses the identifier and includes the complete updated content, with no "// rest of the code remains the same" truncation — [dazeb gist](https://gist.github.com/dazeb/f41920dcb9cb8faba6803e821b600e8d)
- A copy of the Claude 4 Opus prompt (May 2025) still contains an `artifacts_info` section. It bans `localStorage`/`sessionStorage` in artifacts and says to use React state (`useState`, `useReducer`) instead — [Wyatt Walls on X, Claude 4 Opus system prompt](https://x.com/lefthanddraft/status/1925627622215524810)

**React artifact runtime rules (leaked)**
- A React artifact needs a default export and either no required props or defaults for all props. Styling uses Tailwind classes only, with no arbitrary values. Hooks must be imported — [dazeb gist](https://gist.github.com/dazeb/f41920dcb9cb8faba6803e821b600e8d)
- The available libraries are lucide-react (written in the prompt as "lucid3-react@0.263.1"), recharts and shadcn/ui components. The prompt says "NO OTHER LIBRARIES (e.g. zod, hookform) ARE INSTALLED OR ABLE TO BE IMPORTED" — [dazeb gist](https://gist.github.com/dazeb/f41920dcb9cb8faba6803e821b600e8d)
- Later leaked copies add MathJS, lodash, d3, Plotly, Chart.js, Three.js and Papaparse to the importable set — [WebSearch summary citing CypherpunkSamurai gist, which collects tags across 3.5 Sonnet to Opus 4.7](https://gist.github.com/CypherpunkSamurai/99234bbf35d6de7ad44f09e2ad9a9500). Caveat: that gist is a generator built from leaks, not a primary leak.
- The community project claude-artifact-runner reproduces the environment and bundles Shadcn UI, Tailwind, Lucide and Recharts as "included by default" — [Claude Artifact Runner](https://docsearch.algolia.com/mcp/docs/repo/claudio-silva/claude-artifact-runner)

**HTML artifact rules (leaked)**
- An HTML artifact is a single file with HTML, JS and CSS together. "The only place external scripts can be imported from is https://cdnjs.cloudflare.com". Images from the web are disallowed, and placeholder images are given by width and height — [dazeb gist](https://gist.github.com/dazeb/f41920dcb9cb8faba6803e821b600e8d)

**Sandbox, origin and CSP**
- Artifacts run in a sandboxed environment. `localStorage` and external `fetch()` are restricted by CSP headers and the `<iframe sandbox>` mechanism. Errors in artifact code are not sent back to the model automatically — [Simon Willison, 25 Jun 2025](https://simonwillison.net/2025/jun/25/ai-powered-apps-with-claude)
- In 2026, each web artifact is served from its own origin, `<uuid>.frame.claudeusercontent.com`, not from claude.ai, so "Two artifacts cannot see each other" — [Pluto Security, 6 Aug 2026](https://pluto.security/blog/inside-claude-artifacts-how-your-agent-publishes-to-the-web/)
- The quoted CSP (truncated in the source) is `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; connect-src 'self'; form-action 'self'; object-src 'none'; webrtc 'block'; frame-ancestors 'self' https://claude.ai https://*.claude.ai; ...`. In tests, fetch, XHR, WebSocket, image beacons and sendBeacon were all blocked. Camera, microphone and geolocation are denied — [Pluto Security](https://pluto.security/blog/inside-claude-artifacts-how-your-agent-publishes-to-the-web/)
- Connector calls are issued by the parent page under the viewer's session. The in-page bridge is a message-passing stub that holds no token, and artifacts that declare connectors cannot be made public — [Pluto Security](https://pluto.security/blog/inside-claude-artifacts-how-your-agent-publishes-to-the-web/)
- Share URLs are `claude.ai/code/artifact/<uuid>` on paid plans (with `x-robots-tag: none`) and `claude.ai/public/artifacts/<uuid>` on free plans. In Cowork, artifacts are written to disk and rendered at `cowork-artifact://local/<id>/index.html` in an isolated app partition — [Pluto Security](https://pluto.security/blog/inside-claude-artifacts-how-your-agent-publishes-to-the-web/)
- The page body renders in a cross-origin sandboxed iframe through a signed frame URL: `claude.ai/code/frame/<uuid>` redirects to `<uuid>.frame.claudeusercontent.com/_f/...` — [claudeissues.com issue 87275](https://claudeissues.com/issue/87275-claude-code-cannot-read-claude-ai-artifact-links-sandboxed-frame-blocks-text-ext)
- Observed in this session's Claude Code Artifact tool contract (2026-11-01): pages may load external scripts only from cdnjs.cloudflare.com, cdn.jsdelivr.net/npm/, unpkg.com, cdn.tailwindcss.com and code.jquery.com, with pinned exact versions. Stylesheets may come only from Google Fonts. Dark mode is handled through `prefers-color-scheme` plus a host-set `data-theme` attribute. Each artifact has its own origin for browser storage. Optional "runtime capabilities" (shared DB, viewer identity, asking Claude, file storage) are exposed through `window.claude.*` — first-hand observation of the tool description, no public URL.

**AI-powered artifacts**
- Since June 2025, artifacts can call `await window.claude.complete('prompt')`, which takes a string and returns a string. The prompt counts against the viewing user's own account, not the author's. Conversation history must be serialized into the prompt — [Simon Willison](https://simonwillison.net/2025/jun/25/ai-powered-apps-with-claude); leaked instructions in [simonw gist](https://gist.github.com/simonw/31957633864d1b7dd60012b2205fd747); announcement at [anthropic.com/news/claude-powered-artifacts](https://anthropic.com/news/claude-powered-artifacts) (not fetched)
- The mechanism changed on 31 Jul 2025 — [Simon Willison, updates to Claude](https://simonwillison.net/2025/Jul/31/updates-to-claude/) (linked from the post above, not fetched)
- The "analysis tool" is a separate JavaScript execution environment where Claude prototypes and checks results before building an artifact — [Simon Willison](https://simonwillison.net/2025/jun/25/ai-powered-apps-with-claude)

**Artifacts vs inline visuals (2026)**
- Artifacts are permanent, shareable or downloadable documents and tools shown in a side panel. Inline visuals are temporary and change or disappear as the conversation moves on — [Claude blog, "Claude builds interactive visuals"](https://claude.com/blog/claude-builds-visuals)
- Reverse-engineered contrast: artifacts are deliverables with a fixed library set in a side panel with a download button. The visualizer is inline with a transparent background and can load any allow-listed CDN library — [Michael Livshits](https://michaellivs.com/blog/reverse-engineering-claude-generative-ui/)

### Inferences
- The old system was text-protocol based: tags in the streamed assistant text, parsed client-side. The client could open the side panel and show the code view while tokens streamed, then switch to the rendered preview once the closing tag arrived. That design follows from the tag format. I found no fresh 2026 source confirming the current wire format (tag or tool call) for side-panel artifacts.
- Recommended replication pattern: render each artifact in a cross-origin iframe on a separate sandbox domain (per artifact or per conversation). Use CSP `connect-src 'self'` to stop egress, a CDN allowlist in `script-src`, and a parent-mediated postMessage RPC for privileged actions such as LLM calls and data access.
- A fixed, preloaded library set for React (Tailwind, lucide, recharts, shadcn) cuts failure rates sharply compared with arbitrary imports. That is the main reason Claude constrains it.

### Gaps
- I found no exact current `sandbox=` attribute list (for example `allow-scripts allow-same-origin allow-popups allow-forms`) in a primary source.
- I could not confirm whether side-panel artifacts in late 2026 are still emitted as `antArtifact` tags or as a tool call (`artifacts` tool with `create`/`update`/`rewrite` commands, as some 2025 leaks suggest). This was not verified within the call budget.
- I could not confirm the exact React bundling mechanism (in-iframe Babel/esbuild-wasm vs server-side compile).
- The version-history UI (artifact version switcher) was not documented in any fetched source.
- The precise artifacts launch date (June 2024, with Claude 3.5 Sonnet) is consistent with the June 2024 leak tweet but was not fetched from anthropic.com.

## Claude's newer inline visuals (2025–2026): "Imagine with Claude" and inline charts and diagrams

### Takeaway
On 12 Mar 2026 Anthropic shipped inline interactive visuals (beta, on by default, all plans including free). The model decides when a chart, diagram or interactive explainer helps and renders it inside the message, not in the side panel. Reverse engineering shows a two-step tool protocol. First `visualize:read_me(modules=[...])` loads design guidelines, then `visualize:show_widget(widget_code=<HTML fragment>)` streams an HTML/SVG fragment that is rendered progressively. Scripts run after streaming completes, libraries come from an allow-listed CDN, and a `sendPrompt()` bridge lets clicks post follow-up messages.

### Cited Findings
- Announced 12 Mar 2026: Claude builds custom charts, diagrams and visualizations inline in responses and adjusts them as the conversation develops. Beta, on by default, all plan types. Expanded to Claude Cowork on all paid plans on 22 Apr 2026 — [Claude blog](https://claude.com/blog/claude-builds-visuals)
- Examples: a compound-interest curve the user can manipulate, an interactive periodic table with clickable elements, weather visuals and purpose-designed recipe layouts. It is triggered by Claude's judgement or by prompts such as "draw this as a diagram" or "visualize how this might change over time" — [Claude blog](https://claude.com/blog/claude-builds-visuals)
- Press coverage confirms the date and HTML/SVG inline rendering — [The Register, 13 Mar 2026](https://www.theregister.com/software/2026/03/13/claude-charts-a-new-course-with-charts-of-course/5224646); [WinBuzzer](https://winbuzzer.com/2026/03/13/claude-now-builds-interactive-charts-and-diagrams-in-chat-xcxwbn/); [getaibook](https://getaibook.com/news/claudes-new-inline-visuals-what-developers-should-know-about-html-charts-in-chat)
- The feature grows out of "Imagine with Claude", a temporary research-preview experience from fall 2025 that generated software in real time without prewritten code — [Claude blog](https://claude.com/blog/claude-builds-visuals); [WebSearch summary of coverage](https://thenewstack.io/anthropics-claude-interactive-visualizations/)
- At launch, no public API let developers target this inline visual runtime — [getaibook](https://getaibook.com/news/claudes-new-inline-visuals-what-developers-should-know-about-html-charts-in-chat)

**Reverse-engineered mechanics (Michael Livshits, 13 Mar 2026)**
- Tool `read_me` (`visualize:read_me` in network payloads) takes `modules: [...]` from {`diagram`, `mockup`, `interactive`, `chart`, `art`} and must be called before the first widget — [michaellivs.com](https://michaellivs.com/blog/reverse-engineering-claude-generative-ui/)
- Tool `show_widget` takes four parameters. `i_have_seen_read_me` (boolean) forces the guideline load. `title` is a snake_case identifier. `loading_messages` holds 1–4 short strings shown while rendering. `widget_code` is an HTML fragment with no doctype, html, head or body tags — [michaellivs.com](https://michaellivs.com/blog/reverse-engineering-claude-generative-ui/)
- Streaming: `widget_code` streams as JSON string chunks. The client parses partial HTML and inserts nodes incrementally, so styles and structure appear as they arrive. `<script>` tags run only after streaming completes (the guidelines say to put scripts last). CDN libraries load asynchronously, then charts become interactive — [michaellivs.com](https://michaellivs.com/blog/reverse-engineering-claude-generative-ui/)
- The guidelines' CDN allowlist is cdnjs.cloudflare.com, cdn.jsdelivr.net, unpkg.com and esm.sh, with examples Chart.js, D3 and Three.js — [michaellivs.com](https://michaellivs.com/blog/reverse-engineering-claude-generative-ui/)
- The design system includes:
  - CSS variables such as `--color-text-primary` and `--color-background-secondary`
  - nine color ramps with seven stops each, at most 2–3 ramps per widget
  - two font weights (400 and 500) and sentence case
  - no gradients, shadows or blur, because they flash during DOM updates, and no HTML comments
  - mandatory dark mode
  - cards with a 0.5px border and a large radius

  Source: [michaellivs.com](https://michaellivs.com/blog/reverse-engineering-claude-generative-ui/)
- Guideline module sizes: interactive about 19K, chart about 22K, mockup about 19K, art about 17K and diagram about 59K characters. Shared sections are deduplicated when several modules are requested. The guidelines can be recovered from a claude.ai conversation exported as JSON, because the export includes full tool-call payloads — [michaellivs.com](https://michaellivs.com/blog/reverse-engineering-claude-generative-ui/)
- Bridge: `sendPrompt(text)` sends a message to the chat as if the user had typed it — [michaellivs.com](https://michaellivs.com/blog/reverse-engineering-claude-generative-ui/)
- Iframe or not, the sources conflict. Livshits infers it is not a sandboxed iframe, because of live rendering during streaming, CSS variables resolving from the parent, a transparent background and no iframe chrome, and he suspects a parent-page CSP is the boundary — [michaellivs.com](https://michaellivs.com/blog/reverse-engineering-claude-generative-ui/). This is contradicted by a dev.to author who inspected network traffic and says the single HTML file is "render[ed] in an iframe" — [dev.to, navayuvan, Apr 2026](https://dev.to/navayuvan/i-reverse-engineered-claudes-ui-widget-and-it-changed-how-i-think-about-building-llm-apps-483f)
- The dev.to author reports that widget quality depends on the model with identical instructions: Sonnet 4.6 "solid", Opus "significantly better", Mythos "on another level" — [dev.to](https://dev.to/navayuvan/i-reverse-engineered-claudes-ui-widget-and-it-changed-how-i-think-about-building-llm-apps-483f)
- A third-party catalogue of 37 claude.ai internal tools lists `visualize:show_widget` — [N1-AI/claude-hidden-toolkit](https://github.com/N1-AI/claude-hidden-toolkit)
- Known bug (Apr 2026): `visualize:read_me` and `visualize:show_widget` return 400 in Claude Desktop on Windows — [anthropics/claude-code issue #89329](https://github.com/anthropics/claude-code/issues/89329)

**Open-source replication (useful engineering detail)**
- The pi-generative-ui rebuild handles streaming as follows:
  - debounce `toolcall_delta` updates by 150ms
  - keep one shell page with a `#root` element
  - apply updates through morphdom (from jsdelivr) so unchanged nodes are left alone and new nodes fade in
  - buffer updates that arrive before morphdom loads
  - on `toolcall_end`, recreate `<script>` tags so they execute
  - escape backslashes, quotes and `</script>`

  Approaches that failed: `setHTML` on every delta was choppy, `innerHTML` replacement destroyed nodes, and naive appending broke because the browser auto-closes partial tags — [michaellivs.com](https://michaellivs.com/blog/reverse-engineering-claude-generative-ui/); [GitHub Michaelliv/pi-generative-ui](https://github.com/Michaelliv/pi-generative-ui)

### Inferences
- The progressive-render effect, where the widget visibly builds while tokens stream, comes from DOM-diffing partial HTML. Running in the parent DOM (or a same-origin srcdoc iframe the parent writes into) makes that simplest. A cross-origin iframe would need postMessage of each chunk. The conflicting reports may both be partly right, for example a host-written sandboxed iframe that inherits CSS variables.
- Forcing a guideline-loading tool call before rendering keeps the system prompt small and lets the design system be loaded on demand per module. This is a reusable pattern for an in-house design system.
- The "no gradients, shadows, blur, comments; scripts last" rules are deliberate engineering for streaming stability, not just aesthetics.

### Gaps
- Anthropic has published no official technical documentation on the inline visual runtime (iframe vs shadow DOM, sanitizer, CSP).
- I could not confirm whether an inline visual can be "promoted" to a side-panel artifact, or how visuals are persisted or replayed when a conversation reloads.
- Claude.ai's "analysis tool" status in 2026 (still present, or folded into code execution and file creation) was not verified.

## ChatGPT: Canvas, interactive charts, tables, Mermaid, Apps SDK / MCP Apps widgets

### Takeaway
ChatGPT has three distinct visual surfaces:
1. **Canvas** is a side editor for writing and code. It can render React/HTML in a sandbox, with admin toggles for code execution and network access.
2. **Interactive charts** from data analysis: Python code runs in a sandbox and the result is shown as an interactive chart for bar, line, pie and scatter. Other chart types fall back to static images.
3. **Apps SDK widgets**: MCP-server-provided HTML templates (`text/html;profile=mcp-app`, `ui://` URIs) rendered in sandboxed iframes on `web-sandbox.oaiusercontent.com`. They read data through `window.openai` / MCP Apps postMessage JSON-RPC and support inline, fullscreen and picture-in-picture display modes. This has been standardised as MCP Apps (SEP-1865, final Jan 2026).

### Cited Findings

**Canvas**
- React/HTML code in Canvas "is rendered in a sandbox environment, allowing you to view the output of the code". Code execution and React/HTML rendering "can result in external network requests". In enterprise workspaces, canvas code execution is on by default and "Allow canvas code to access the network" is off by default (admin-configurable). The help center says "all npm packages and many javascript libraries will work" — [OpenAI Help: What is the canvas feature](https://help.openai.com/en/articles/9930697) (via search snippet of the help-lb mirror)
- HTML/React rendering in Canvas arrived in the o1-era update and is available to all users (paid-only o1 features aside) — [The Decoder](https://the-decoder.com/openais-chatgpt-gets-a-major-canvas-upgrade-with-html-and-react-code-rendering/); [html.it](https://www.html.it/magazine/openai-canvas-supporta-il-rendering-del-codice-html-e-react/)
- Conflict on library support: a French review says React rendering stays basic, with no external libraries such as Three.js — [Clubic](https://www.clubic.com/actualite-551483-chatgpt-cette-nouveaute-de-canevas-qui-va-plaire-aux-web-designers-et-developpeurs-front-end.html). The help center says all npm packages work — [OpenAI Help](https://help.openai.com/en/articles/9930697)
- Date conflict: one search-surfaced source says Canvas launched "October 2023", which is likely wrong. Canvas launched in Oct 2024 (background knowledge, openai.com/index/introducing-canvas not fetched; openai.com returned 403) — [The Decoder](https://the-decoder.com/?p=20807)

**Interactive charts and tables (data analysis)**
- Interactive charts are supported for bar, line, pie and scatter. Other chart types may be returned as static images — [OpenAI Help: Data analysis with ChatGPT](https://help-lb.openai.com/en/articles/8437071-data-analysis-with-chatgpt)
- Chart types you can request: line, bar, pie, histogram, scatter, box plot, heat map, area, radar, treemap, bubble, waterfall. Without a stated type, ChatGPT chooses one. Only bar, pie, scatter and line are interactive "in most cases" — [OpenAI Help 9213685](https://help.openai.com/en/articles/9213685)
- The May 2024 announcement ("Improvements to data analysis in ChatGPT", GPT-4o era) introduced interactive charts and tables. Unsupported charts get a static version — [openai.com/index/improvements-to-data-analysis-in-chatgpt](https://openai.com/index/improvements-to-data-analysis-in-chatgpt) (search snippet only; fetch returned 403)
- A third-party report says interactive charts now appear in conversations without a file upload, for the same four types — [tonyreviewsthings](https://www.tonyreviewsthings.com/chatgpt-interactive-charts/) (unverified)

**Apps SDK / MCP Apps widgets (documented)**
- `window.openai` properties:
  - `toolInput` holds the tool arguments.
  - `toolOutput` holds `structuredContent`, which the model reads verbatim.
  - `toolResponseMetadata` holds widget-only data, including `_meta`.
  - `widgetState` holds persisted UI state.
  - Context values are `theme`, `displayMode`, `maxHeight`, `safeArea`, `view`, `userAgent` and `locale`, subscribable via `useOpenAiGlobal` / the `openai:set_globals` event.

  Source: [OpenAI Apps SDK Reference](https://developers.openai.com/apps-sdk/reference.md)
- `window.openai` methods: `setWidgetState`, `callTool(name,args)`, `sendFollowUpMessage({prompt, scrollToBottom})`, `uploadFile`, `selectFiles`, `getFileDownloadUrl`, `requestDisplayMode`, `requestModal({params, template})`, `requestClose`, `notifyIntrinsicHeight`, `openExternal({href, redirectUrl})`, `setOpenInAppUrl` — [Apps SDK Reference](https://developers.openai.com/apps-sdk/reference.md)
- Display modes are `inline`, `fullscreen` and `pip`. On mobile, pip may appear as fullscreen. Modes are declared through `_meta["openai/ui"].availableDisplayModes` — [Apps SDK Reference](https://developers.openai.com/apps-sdk/reference.md)
- Tool `_meta` fields:
  - `ui.resourceUri`, also available under the alias `openai/outputTemplate`
  - `ui.visibility`, defaulting to `["model","app"]`
  - `openai/toolInvocation/invoking` and `openai/toolInvocation/invoked`, status text of 64 characters or fewer shown while running and after completion

  Source: [Apps SDK Reference](https://developers.openai.com/apps-sdk/reference.md)
- Resource `_meta` fields:
  - `ui.prefersBorder`, a hint to show a bordered card
  - `ui.csp`, with `connectDomains`, `resourceDomains` and optional `frameDomains`
  - `ui.domain`, a dedicated origin that defaults to `https://web-sandbox.oaiusercontent.com` and must be unique per plugin
  - `openai/widgetDescription`, a summary for the model
  - Legacy `openai/widgetCSP`, which also supports `redirect_domains`

  Subframes are blocked by default — [Apps SDK Reference](https://developers.openai.com/apps-sdk/reference.md)
- Tool result channels: `structuredContent` (model and component), `content` (model and component), `_meta` (component only, hidden from the model). The host provides `openai/widgetSessionId`. The resource MIME type is `text/html;profile=mcp-app` with `ui://` URIs — [Apps SDK Reference](https://developers.openai.com/apps-sdk/reference.md)
- OpenAI's guidance is to prefer MCP Apps standard keys and bridge methods and use `window.openai` only where MCP Apps lacks an equivalent — [Apps SDK Reference](https://developers.openai.com/apps-sdk/reference.md)
- MCP Apps bridge methods include `ui/notifications/tool-result` (host to iframe) and `ui/message` (iframe posts a follow-up into the conversation) — [aguidetocloud widget-rendering guide](https://claw.aguidetocloud.com/openai/apps-sdk/widget-rendering/) (third-party)

**MCP Apps standard (SEP-1865)**
- SEP-1865 was created 2025-11-21 and is now Final, on the Extensions Track. It unifies MCP-UI and the OpenAI Apps SDK. UI is predeclared as `ui://` resources referenced from tool metadata, so hosts can prefetch templates, cache presentation separately from data, and review templates for security. The UI and host talk over MCP JSON-RPC via postMessage. Sandboxed iframes are mandatory. The initial content type is HTML only, `text/html;profile=mcp-app` — [SEP-1865](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp)
- Alternatives the SEP rejected:
  - a global injected API object, because it needs host-specific injection and fails for external iframes
  - external URLs in the MVP, because of model visibility, screenshotting and review concerns
  - embedded resources in tool results (the earlier MCP-UI approach), because of caching and review problems

  The SEP says HTML-only allows screenshot generation via html2canvas — [SEP-1865](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp)
- MCP-UI adopters named in the SEP: Postman, HuggingFace, Shopify, Goose, ElevenLabs. The SEP says the Apps SDK launched in "November 2025" — [SEP-1865](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp). Possible conflict: my background knowledge is that the Apps SDK was announced at OpenAI DevDay on 6 Oct 2025 (not verified this session).
- Finalisation date reported as 26 Jan 2026. The extension identifier is `io.modelcontextprotocol/ui`. The host proxies UI-initiated tool calls to the MCP server, so the app never calls tools directly — [morphllm MCP Apps](https://www.morphllm.com/mcp-apps); [composio](https://composio.dev/blog/what-are-mcp-apps) (secondary)
- Claude also renders MCP Apps in conversations ("interact with apps like Figma, Canva, and Slack within conversations") — [Claude blog](https://claude.com/blog/claude-builds-visuals)

### Inferences
- ChatGPT interactive charts are most likely Python (matplotlib or pandas plots) whose figure data is extracted and re-rendered by a front-end chart component, which would explain why only four simple types are interactive. This is inference. I found no primary source on the conversion mechanism.
- The Apps SDK / MCP Apps three-channel result split (`structuredContent` for model plus UI, `content` for text, `_meta` for UI only) is a strong pattern to copy. It keeps tokens low while giving the widget full data.
- Status strings (`invoking` / `invoked`, at most 64 characters) and `loading_messages` (Claude) show that both vendors give tool-rendered UI a short human-readable progress label.

### Gaps
- I found no primary documentation of ChatGPT's chart-conversion internals or its chart theme or colour palette.
- I could not verify Mermaid rendering in ChatGPT's main chat (as opposed to Canvas). Not researched within budget.
- Any 2025–2026 ChatGPT "visual answer" formats beyond Apps SDK widgets (for example rich shopping or product cards, or image-based explainers) were not covered.
- The exact `sandbox` attributes of the Apps SDK iframe are not in the reference page. A double-iframe "sandbox proxy" design is described in the full ext-apps spec, which I did not fetch.

## Other references (Gemini, Perplexity, Copilot)

### Takeaway
Google's Gemini "dynamic view" (Nov 2025) is the most aggressive generative-UI approach. Gemini 3 Pro codes a fully custom interactive page for each prompt. It has been evaluated as close to human-expert-designed sites, but it can take a minute or more to generate.

### Cited Findings
- Google Research (Nov 2025) introduced generative UI in two Gemini app experiments. In "dynamic view", Gemini designs and codes a fully customised interactive response for each prompt using agentic coding. In "visual layout", it produces a magazine-style view. It is also available in Search AI Mode for Pro/Ultra subscribers in the US. The implementation is built on Gemini 3 Pro "with three important additions", and the accompanying paper is "Generative UI: LLMs are Effective UI Generators" — [Google Research blog](https://research.google/blog/generative-ui-a-rich-custom-visual-interactive-user-experience-for-any-prompt/)
- Human raters ranked expert-made sites highest, generative UI a close second, and other output formats (including plain LLM markdown) far behind. Speed was excluded from the evaluation. Generation "can sometimes take a minute or more". Google released the PAGEN dataset of expert-made sites — [Google Research blog](https://research.google/blog/generative-ui-a-rich-custom-visual-interactive-user-experience-for-any-prompt/)
- The visual layout description is secondary — [woshipm](https://www.woshipm.com/?p=6298420)

### Inferences
- There is a speed vs richness trade-off. Full-page generation (Gemini dynamic view) is the richest but slowest. Claude's inline widgets keep latency in check by streaming small HTML fragments with progressive render. ChatGPT's data-analysis charts use fixed chart components (fast and reliable but limited).

### Gaps
- Perplexity visuals and Microsoft Copilot were not researched within the tool-call budget.
- I found no technical details on how Gemini sandboxes dynamic-view output.

## UX patterns that make these feel good

### Takeaway
Across vendors, the pattern is:
- Inline and ephemeral for explanatory visuals.
- A side panel (or fullscreen) for lasting, editable deliverables.
- Short status or loading strings while generating.
- Progressive render during streaming, with interactivity only after completion.
- Theme-aware design tokens so visuals match light and dark chat.
- Explicit escape hatches: download, share, fullscreen or pip, and "send follow-up from the visual".

### Cited Findings
- Inline vs panel split: Claude visuals are inline and temporary, while artifacts are persistent, shareable or downloadable side-panel items — [Claude blog](https://claude.com/blog/claude-builds-visuals). Inline visuals have a transparent background, and the artifact side panel has a download button — [michaellivs.com](https://michaellivs.com/blog/reverse-engineering-claude-generative-ui/)
- When visuals appear: the model decides, using criteria like the old artifact rules (substantial content over 15 lines that is reusable, or a visual that aids understanding), or the user asks explicitly — [dazeb gist](https://gist.github.com/dazeb/f41920dcb9cb8faba6803e821b600e8d); [Claude blog](https://claude.com/blog/claude-builds-visuals)
- Loading states: Claude's `loading_messages` (1–4 strings) — [michaellivs.com](https://michaellivs.com/blog/reverse-engineering-claude-generative-ui/). ChatGPT's `openai/toolInvocation/invoking` and `invoked` (64 characters or fewer) — [Apps SDK Reference](https://developers.openai.com/apps-sdk/reference.md)
- Progressive render: structure and styles stream in, scripts and libraries activate last, and visual effects that flash during DOM updates are avoided — [michaellivs.com](https://michaellivs.com/blog/reverse-engineering-claude-generative-ui/)
- Theming: Claude widgets use host CSS variables and must support dark mode — [michaellivs.com](https://michaellivs.com/blog/reverse-engineering-claude-generative-ui/). ChatGPT exposes `theme` to widgets — [Apps SDK Reference](https://developers.openai.com/apps-sdk/reference.md)
- Sizing: `notifyIntrinsicHeight` prevents clipping, and `maxHeight` and `safeArea` are exposed — [Apps SDK Reference](https://developers.openai.com/apps-sdk/reference.md)
- Expand and escape: ChatGPT supports `requestDisplayMode` (inline, fullscreen, pip), `requestModal`, `openExternal` and `setOpenInAppUrl` — [Apps SDK Reference](https://developers.openai.com/apps-sdk/reference.md). Claude artifacts can be shared through public or paid URLs — [Pluto Security](https://pluto.security/blog/inside-claude-artifacts-how-your-agent-publishes-to-the-web/)
- Closing the loop from visual to chat: Claude has `sendPrompt(text)` — [michaellivs.com](https://michaellivs.com/blog/reverse-engineering-claude-generative-ui/). ChatGPT has `sendFollowUpMessage` and `callTool` — [Apps SDK Reference](https://developers.openai.com/apps-sdk/reference.md)
- Persistence: ChatGPT keeps `widgetState` and `setWidgetState` between renders — [Apps SDK Reference](https://developers.openai.com/apps-sdk/reference.md). Claude artifacts were told not to use localStorage, and to use React state instead (2025 prompt) — [Wyatt Walls](https://x.com/lefthanddraft/status/1925627622215524810)
- Error fallback: artifact runtime errors are not sent back to the model automatically — [Simon Willison](https://simonwillison.net/2025/jun/25/ai-powered-apps-with-claude). ChatGPT falls back to a static chart image for unsupported interactive types — [OpenAI Help](https://help-lb.openai.com/en/articles/8437071-data-analysis-with-chatgpt)

### Inferences
- For a React chat app, a reasonable tiered design is:
  1. Markdown tables and Mermaid inline, rendered client-side.
  2. Model-emitted chart specs rendered by built-in chart components, which is ChatGPT's fixed-type approach.
  3. Inline streamed HTML/SVG widgets with a guideline-loading tool and morphdom-style progressive render (Claude's visualize approach).
  4. Side-panel artifacts in a cross-origin sandbox iframe with strict CSP, a fixed library set, versioning by identifier, and copy, download and fullscreen actions.
- Offer a "fix this" action that feeds iframe `window.onerror` output back to the model. Neither vendor documents doing this automatically (Claude explicitly does not), so it is an opportunity.

### Gaps
- Copy, download and fullscreen button sets per surface were not captured from primary UI documentation, and the claude.ai and ChatGPT help pages for these were not fetched.
- I found no documentation on accessibility handling (alt text, keyboard support) for generated visuals at either vendor.
