# Open-source stack for ChatGPT/Claude-style rich visual chat responses in React/Next.js (as of 2026-11-01)

Method note: the npm versions, licenses, publish dates, unpacked sizes and React peer ranges below came from the npm registry JSON (`https://registry.npmjs.org/<pkg>`) on 2026-11-01. Min/gzip sizes came from the bundlephobia API (`https://bundlephobia.com/api/size?package=<pkg>`) the same day. Bundlephobia measures the package's default entry with no tree-shaking or lazy chunks, so treat those figures as an upper bound for the main import. They do not show the real cost when grammars, diagrams or languages are code-split. Source code was read from GitHub raw files on the `main` branches.

## Streaming markdown renderers (streamdown, react-markdown + remark/rehype, markdown-it, marked; incomplete-markdown handling; block memoization)

### Takeaway
Vercel's **Streamdown** (v2.7.1, Apache-2.0, released 2026-10-19) is now the default for AI chat in React. It is a drop-in replacement for react-markdown that repairs unterminated syntax through **remend** and memoizes per block. Shiki, Mermaid, KaTeX and CJK support ship as opt-in `@streamdown/*` plugins. react-markdown 10.1.0 is stable but has had no release since 2025-03. Using it for streaming means adding your own incomplete-markdown repair and block memoization.

### Cited Findings
**Streamdown**
- Streamdown calls itself "A drop-in replacement for react-markdown, designed for AI-powered streaming". It handles unclosed bold, partial code blocks and unterminated links, and it has built-in support for syntax highlighting, math and diagrams — [streamdown.ai/docs](https://streamdown.ai/docs)
- npm: `streamdown` 2.7.1, published 2026-10-19, first published 2025-08-14, Apache-2.0, peer `react ^18.0.0 || ^19.0.0`, 122 KB unpacked — [npm registry](https://registry.npmjs.org/streamdown)
- Bundlephobia: 493 KB min / **150 KB gzip** for the default entry — [bundlephobia](https://bundlephobia.com/package/streamdown)
- Plugin architecture: `import { code } from '@streamdown/code'` is passed as `plugins={{ code }}`. Without it, code blocks render as plain text with no highlighting. `@streamdown/mermaid`, `@streamdown/math` and `@streamdown/cjk` are separate installs — [streamdown.ai/llms.txt](https://streamdown.ai/llms.txt)
- The code plugin uses Shiki. Its 200+ languages are lazy-loaded so only the grammars in use are downloaded. `shikiTheme` takes a `[light, dark]` tuple (default `github-light`/`github-dark`). Code shells render as plain text first and colors apply when highlighting resolves — [streamdown.ai/llms.txt](https://streamdown.ai/llms.txt)
- Mermaid: the `mermaid` prop takes `config` (a MermaidConfig) and `errorComponent`. `controls.mermaid` adds download (svg/png/mmd), copy, fullscreen and panZoom — [streamdown.ai/llms.txt](https://streamdown.ai/llms.txt)
- Incomplete markdown: `parseIncompleteMarkdown` (on by default) runs the **remend** preprocessor. The `remend` prop has per-feature flags `links, images, bold, italic, boldItalic, inlineCode, strikethrough, katex, setextHeadings, comparisonOperators, htmlTags`, plus `linkMode: "protocol" | "text-only"` and custom `handlers`. remend's `katex` option completes unclosed `$$` blocks — [streamdown.ai/llms.txt](https://streamdown.ai/llms.txt)
- `remend` standalone: 1.4.0, published 2026-09-30, Apache-2.0, 28 KB unpacked, no React dependency, so it also works with react-markdown, marked and others — [npm registry](https://registry.npmjs.org/remend)
- Memoization: streaming updates are memoized per parsed block. `parseMarkdownIntoBlocksFn` and `BlockComponent` let you customize splitting and rendering — [streamdown.ai/llms.txt](https://streamdown.ai/llms.txt)
- Streaming UX props: `isAnimating` disables copy buttons while streaming. `caret: "block" | "circle"` appears only when `isAnimating` is true and `mode="streaming"`. `mode="static"` is available for completed messages. `useIsCodeFenceIncomplete` lets custom renderers detect an open fence. Character-level animation "generates more DOM nodes. Use it sparingly" — [streamdown.ai/llms.txt](https://streamdown.ai/llms.txt)
- Security: the default rehype plugins are `rehype-raw`, `rehype-sanitize` and `rehype-harden`. rehype-harden is "permissive by default: allows all image and link prefixes, data images enabled". `allowedTags` works only with the default rehype plugins. Custom `rehypePlugins` require you to configure `rehype-sanitize` yourself. Other options are `urlTransform`, `linkSafety` and `disableAutolinkProtocols` — [streamdown.ai/llms.txt](https://streamdown.ai/llms.txt)
- Gotchas: Tailwind v4 needs `@source "../node_modules/streamdown/dist/*.js";`, plus a `@source` line per installed plugin, with extra `../` segments in monorepos. `animated` needs `import 'streamdown/styles.css'`. On Next.js, a "Package shiki can't be external" warning means you should install `shiki` explicitly and add it to `transpilePackages`. Mermaid bundling errors for `vscode-jsonrpc`/`langium` are an upstream issue, fixed by making them server-external and aliasing them to `false` on the client in webpack. Vite SSR needs `streamdown` in `ssr.noExternal` because of a katex CSS import — [streamdown.ai/llms.txt](https://streamdown.ai/llms.txt)
- Adoption: Vercel's own `vercel/chatbot` template (formerly "AI Chatbot") depends on `streamdown ^2.3.0` — [vercel/chatbot package.json](https://raw.githubusercontent.com/vercel/chatbot/main/package.json); the repo was renamed to "Chatbot (formerly AI Chatbot)" — [github.com/vercel/ai-chatbot](https://github.com/vercel/ai-chatbot)

**react-markdown + remark/rehype**
- `react-markdown` 10.1.0, published 2025-03-07 (no release in roughly 20 months), MIT, peer `react >=18`, about 33 KB gzip / 111 KB min — [npm registry](https://registry.npmjs.org/react-markdown), [bundlephobia](https://bundlephobia.com/package/react-markdown)
- `remark-gfm` 4.0.1 (2025-02), `remark-math` 6.0.0 (2023-09) and `rehype-katex` 7.0.1 (2024-08) are all MIT and stable but release rarely — [npm registry](https://registry.npmjs.org/remark-gfm), [npm](https://registry.npmjs.org/remark-math), [npm](https://registry.npmjs.org/rehype-katex)
- LibreChat still uses `react-markdown ^9.0.1` with `remark-directive ^3`, `rehype-katex ^6` and `rehype-highlight ^6` — [LibreChat client/package.json](https://raw.githubusercontent.com/danny-avila/LibreChat/main/client/package.json)

**markdown-it / marked** (string-to-HTML parsers, not React components)
- `marked` 18.1.2 (2026-10-26, MIT): 46 KB min / **14 KB gzip**, the smallest option — [npm registry](https://registry.npmjs.org/marked), [bundlephobia](https://bundlephobia.com/package/marked)
- `markdown-it` 15.0.3 (2026-10-16, MIT): 96 KB min / 40 KB gzip — [npm registry](https://registry.npmjs.org/markdown-it), [bundlephobia](https://bundlephobia.com/package/markdown-it)
- Open WebUI (Svelte) uses `marked ^9.1.0` — [open-webui package.json](https://raw.githubusercontent.com/open-webui/open-webui/main/package.json)

**Other streaming-markdown libs**
- `@llm-ui/react` 0.13.3 was last published 2024-06-01 with a peer range of `react ^18.0.0` only. It is effectively stale and has no React 19 peer — [npm registry](https://registry.npmjs.org/@llm-ui/react)
- `@assistant-ui/react-markdown` 0.14.24 (2026-10-22, MIT, peer `react ^18 || ^19`) — [npm registry](https://registry.npmjs.org/@assistant-ui/react-markdown)

### Inferences
- In a Next.js 16 / React 19 app, Streamdown plus its `@streamdown/code`, `@streamdown/mermaid` and `@streamdown/math` plugins covers most of this list with one component. The main costs are the 150 KB gzip core and the Tailwind `@source` and Next.js externals setup.
- marked and markdown-it produce HTML strings that you then have to inject through `dangerouslySetInnerHTML` and sanitize, for example with DOMPurify. They lose React-component overrides, which makes generative-UI-in-markdown harder. They make most sense for a non-React side (a Svelte app like Open WebUI) or server-side rendering.
- If you stay on react-markdown, the standard streaming setup is: run `remend` on the partial text, split into blocks with `marked.lexer` or similar, and `React.memo` each block so only the last block re-parses. That is the pattern Streamdown packages up.
- rehype-harden's permissive defaults mean an app should configure the allowed link and image prefixes explicitly, so model-emitted image URLs can't be used to exfiltrate data.

### Gaps
- I didn't read Streamdown's dedicated Memoization and Security pages (they were past the fetched part of llms.txt), so I couldn't confirm the exact block-splitting algorithm or the default `linkSafety` behavior.
- I found no independent benchmark comparing Streamdown and react-markdown render cost during streaming.
- I couldn't confirm the status of the older `parse-incomplete-markdown` package name or whether it was renamed to `remend`. remend first appeared on npm on 2025-12-03.

## Code highlighting: Shiki vs Prism vs highlight.js

### Takeaway
**Shiki 4.5.0** (MIT, 2026-10-01) is the accuracy leader because it uses TextMate grammars and VS Code themes. Its JavaScript regex engine (all built-in languages supported since 3.9.1) removes the Oniguruma WASM. With fine-grained `shiki/core` plus lazy language imports, it fits on the client. Prism is the smallest (about 7 KB gzip core) but is effectively in maintenance mode. A full highlight.js import is about 300 KB gzip.

### Cited Findings
- `shiki` 4.5.0, published 2026-10-01, MIT; default entry 204 KB min / 63 KB gzip (grammars and themes load as separate lazy chunks) — [npm registry](https://registry.npmjs.org/shiki), [bundlephobia](https://bundlephobia.com/package/shiki)
- Shiki regex engines: Oniguruma (the default, WASM, widest compatibility) versus the JavaScript engine (native `RegExp`, which transpiles Oniguruma patterns with Oniguruma-To-ES). The docs recommend the JS engine for browsers and bundle-size control because it avoids "a large WebAssembly file". "As of Shiki 3.9.1, all built-in languages are supported." Best results need the RegExp `v` flag (Node 20+/ES2024), and `target` can be `'ES2018' | 'auto' | 'ES2024' | 'ES2025'` — [shiki.style/guide/regex-engines](https://shiki.style/guide/regex-engines)
- The JS engine throws on unconvertible patterns by default. `forgiving: true` gives best-effort output that "can result in highlighting mismatches". For the smallest bundles, use `createHighlighterCore` from `shiki/core` with dynamic language/theme imports and `createJavaScriptRawEngine`. Precompiled languages (`@shikijs/langs-precompiled`) are "not yet supported" because of issue #918 — [shiki.style/guide/regex-engines](https://shiki.style/guide/regex-engines)
- `react-shiki` 0.11.2 (2026-10-06, MIT) is a React wrapper — [npm registry](https://registry.npmjs.org/react-shiki)
- `prismjs` 1.30.0 was last published 2025-03-10 (MIT); core is 19 KB min / 7 KB gzip, with languages added per import. `prism-react-renderer` 2.4.1 was last published 2024-12-11 — [npm registry](https://registry.npmjs.org/prismjs), [bundlephobia](https://bundlephobia.com/package/prismjs), [npm](https://registry.npmjs.org/prism-react-renderer)
- `highlight.js` 11.12.0 (2026-08-12, BSD-3-Clause): the full default entry is 901 KB min / **300 KB gzip**; you need `highlight.js/lib/core` plus per-language registration to shrink it — [npm registry](https://registry.npmjs.org/highlight.js), [bundlephobia](https://bundlephobia.com/package/highlight.js)
- `react-syntax-highlighter` 16.1.2 (2026-10-08, MIT) wraps Prism and highlight.js (refractor/lowlight) — [npm registry](https://registry.npmjs.org/react-syntax-highlighter)
- Real-world choices: Open WebUI depends on both `shiki ^4.0.1` and `highlight.js ^11.9.0` — [open-webui package.json](https://raw.githubusercontent.com/open-webui/open-webui/main/package.json). LibreChat uses `rehype-highlight` (highlight.js) — [LibreChat client/package.json](https://raw.githubusercontent.com/danny-avila/LibreChat/main/client/package.json). vercel/chatbot pins `shiki ^3.21.0` (while Streamdown is on Shiki 4) — [vercel/chatbot package.json](https://raw.githubusercontent.com/vercel/chatbot/main/package.json)

### Inferences
- For dark/light, Shiki's dual-theme output (or Streamdown's `shikiTheme` tuple) avoids re-highlighting when the theme toggles.
- Shiki highlights asynchronously, which is why Streamdown shows plain text first. Expect a brief flash of unstyled code on the first block of each language.
- vercel/chatbot pins Shiki 3 while Streamdown has moved to Shiki 4. If you also use Shiki directly, check for duplicate Shiki copies in the bundle.

### Gaps
- I found no first-party byte size for the Oniguruma WASM versus the JS engine on the Shiki page. Commonly cited figures (about 600 KB for WASM) were not verified this session.
- I didn't confirm the maintenance roadmap for Prism v2.

## Diagrams: Mermaid (v11/v12) and alternatives (beautiful-mermaid, D2, @xyflow/react, Excalidraw)

### Takeaway
**Mermaid is now v12.2.0** (MIT, 2026-10-13). v12 targets ES2024/Safari 17.4+ and bundles ELK. It is heavy (169 KB gzip for the default entry, with lazy diagram chunks on top) and must be dynamically imported on the client only. Use `mermaid.parse(code, { suppressErrors: true })` to gate rendering while text streams. Keep `securityLevel: 'strict'` (the default), or use `'sandbox'` for untrusted output.

### Cited Findings
- `mermaid` 12.2.0, published 2026-10-13, MIT; 119 MB unpacked (it ships many builds); default entry 694 KB min / **169 KB gzip** — [npm registry](https://registry.npmjs.org/mermaid), [bundlephobia](https://bundlephobia.com/package/mermaid)
- v12.0.0+ bundles "target ES2024 and are aimed to support Safari 17.4 or later". Since v12.0.0, ELK is bundled with the main package. The "tiny" build is "approximately half the size" and "doesn't include Mindmap Diagrams, Architecture Diagrams, KaTeX rendering, lazy loading" — [mermaid.js.org/config/usage](https://mermaid.js.org/config/usage.html)
- securityLevel values: `strict` (the default: "HTML tags in the text are encoded and click functionality is disabled"), `antiscript` (HTML allowed, only script elements removed, clicks enabled), `loose` (HTML and clicks allowed), and `sandbox` ("all rendering takes place in a sandboxed iframe", which prevents JS running in the diagram context and may limit links and popups) — [mermaid.js.org/config/usage](https://mermaid.js.org/config/usage.html)
- `mermaid.parse(text, parseOptions)` returns `{ diagramType }` when the input is valid. With `suppressErrors: true` it returns `false` on invalid input instead of throwing. `mermaid.render()` returns an SVG string plus `bindFunctions`, which you call after insertion for click and tooltip events — [mermaid.js.org/config/usage](https://mermaid.js.org/config/usage.html)
- Open WebUI and LibreChat both pin `mermaid ^11.17.2`. Neither had moved to v12 on main at the time checked — [open-webui package.json](https://raw.githubusercontent.com/open-webui/open-webui/main/package.json), [LibreChat client/package.json](https://raw.githubusercontent.com/danny-avila/LibreChat/main/client/package.json). LibreChat renders mermaid artifacts inside Sandpack with `mermaid ^11.4.1` and `react-zoom-pan-pinch ^3.6.1` — [LibreChat artifacts.ts](https://raw.githubusercontent.com/danny-avila/LibreChat/main/client/src/utils/artifacts.ts)
- Streamdown's Mermaid plugin exposes `errorComponent` for invalid diagrams, along with pan/zoom and download controls — [streamdown.ai/llms.txt](https://streamdown.ai/llms.txt)
- `beautiful-mermaid` 1.1.3 (MIT, created 2026-01-28, last published 2026-02-26): **471 KB gzip** default entry, larger than mermaid's default entry — [npm registry](https://registry.npmjs.org/beautiful-mermaid), [bundlephobia](https://bundlephobia.com/package/beautiful-mermaid)
- `@xyflow/react` (React Flow) 12.12.0 (2026-09-24, MIT, peer `react >=17`): 59 KB gzip — [npm registry](https://registry.npmjs.org/@xyflow/react), [bundlephobia](https://bundlephobia.com/package/@xyflow/react)
- `@excalidraw/excalidraw` 0.18.1 (2026-04-20, MIT, peer includes `^19.0.0`): 45.7 MB unpacked — [npm registry](https://registry.npmjs.org/@excalidraw/excalidraw)

### Inferences
- Streaming pattern: render a code block placeholder until the fence closes (Streamdown's `useIsCodeFenceIncomplete`), then debounce `mermaid.parse(..., {suppressErrors:true})` and call `render()` only when it succeeds. Keep the last good SVG on screen instead of flashing errors.
- Upgrading to Mermaid 12 drops older Safari (below 17.4). Check the browser matrix for enterprise users.
- @xyflow/react suits LLM output given as JSON nodes and edges (interactive graphs). The model emits data, not code, which is safer and easier to validate. Excalidraw is too heavy to embed inline per message and fits better as a lazily loaded artifact panel.

### Gaps
- I found no authoritative description of beautiful-mermaid's renderer, whether it is ASCII/SVG-based, or what it does beyond theming. Only the npm metadata was verified.
- I didn't research D2's (Terrastruct) browser/WASM status or license this session.
- I couldn't confirm mermaid 12 release notes listing breaking changes beyond ES2024 and ELK.

## Charts for LLM output (Vega-Lite, ECharts, Recharts, Chart.js, Plotly, AntV GPT-Vis)

### Takeaway
For LLM-emitted charts, **declarative JSON specs** (Vega-Lite, ECharts `option`, AntV GPT-Vis) are the right fit. They can be validated against a schema and rendered without executing model code. Vega-Lite plus vega-embed is the most compact grammar but costs about 290 KB gzip (vega + vega-lite + embed). ECharts' full build is about 359 KB gzip (tree-shakeable). Recharts and Chart.js need the app to map JSON to components or configs. Plotly is about 1.4 MB gzip.

### Cited Findings
- `vega-embed` 7.3.0 (2026-09-23, BSD-3-Clause) at 21 KB gzip, `vega-lite` 6.5.0 (2026-10-08) at 88 KB gzip, `vega` 6.4.0 at 178 KB gzip — [npm vega-embed](https://registry.npmjs.org/vega-embed), [npm vega-lite](https://registry.npmjs.org/vega-lite), [bundlephobia vega](https://bundlephobia.com/package/vega)
- Open WebUI ships `vega ^6.2.0` and `chart.js ^4.5.0` in its frontend — [open-webui package.json](https://raw.githubusercontent.com/open-webui/open-webui/main/package.json)
- `echarts` 6.1.0 (2026-05-19, Apache-2.0): full entry 1089 KB min / 359 KB gzip. `echarts-for-react` 3.0.6 (2026-01-21, MIT) — [npm registry](https://registry.npmjs.org/echarts), [bundlephobia](https://bundlephobia.com/package/echarts), [npm](https://registry.npmjs.org/echarts-for-react)
- `recharts` 3.10.1 (2026-07-25, MIT, peer includes `^19.0.0`): 146 KB gzip — [npm registry](https://registry.npmjs.org/recharts), [bundlephobia](https://bundlephobia.com/package/recharts)
- `chart.js` 4.6.1 (2026-10-22, MIT): 68 KB gzip — [npm registry](https://registry.npmjs.org/chart.js), [bundlephobia](https://bundlephobia.com/package/chart.js)
- `plotly.js` 4.2.0 (2026-10-29, MIT, 96 MB unpacked). `plotly.js-dist-min` 4.2.0 is **1376 KB gzip**. `react-plotly.js` 4.1.0 (2026-07-29, peer `react ^18 || ^19`) — [npm registry](https://registry.npmjs.org/plotly.js), [bundlephobia](https://bundlephobia.com/package/plotly.js-dist-min), [npm](https://registry.npmjs.org/react-plotly.js)
- `@antv/gpt-vis` 1.3.0 (published 2026-10-29, MIT, 3 MB unpacked) and `@antv/mcp-server-chart` 0.9.10 (2026-02-25, MIT) — [npm gpt-vis](https://registry.npmjs.org/@antv/gpt-vis), [npm mcp-server-chart](https://registry.npmjs.org/@antv/mcp-server-chart)
- Recharts is among LibreChat's preinstalled artifact dependencies (`standardDependencies` includes `recharts`, `three`, `lucide-react`, `react-router-dom` and `@radix-ui/*`), so model-written React artifacts can import it — [LibreChat artifacts.ts](https://raw.githubusercontent.com/danny-avila/LibreChat/main/client/src/utils/artifacts.ts)

### Inferences
- Safety ranking for model-emitted charts: Vega-Lite and ECharts JSON are data-only, but both can carry expressions. Vega has an expression language, and ECharts accepts formatter functions if you eval strings. Never `eval` formatters, and validate specs with a JSON schema before rendering. Vega's expression language is sandboxed by design (it is not JS eval), but treat that as "unverified this session" for the exact guarantees.
- Recharts and Chart.js work best as the target of a tool call, for example `renderChart({type, series, ...})` validated by Zod and rendered by app code. This fits the AI SDK / assistant-ui tool-UI pattern better than free-form specs.
- Plotly's size rules it out for inline chat use unless it is lazily loaded inside an artifact iframe.

### Gaps
- I didn't fetch GPT-Vis docs, so I can't confirm its spec format (markdown code block `vis-chart` syntax) or React 19 support. Its npm metadata shows no React peer.
- I didn't research Microsoft's LIDA / "chart from LLM" projects or the Vega expression-sandbox guarantees this session.
- ECharts tree-shaken sizes (core plus a few charts) were not measured.

## Generative UI frameworks (AI SDK, assistant-ui, CopilotKit/AG-UI, Thesys C1/Crayon, A2UI, MCP Apps/MCP-UI, OpenAI Apps SDK, json-render)

### Takeaway
There are three tiers: **static** (the app owns components and the model picks one or fills a tool call: AI SDK tool parts, assistant-ui tool UIs, CopilotKit `useFrontendTool`), **declarative** (the model emits a JSON spec rendered from a trusted catalog: Google **A2UI** v0.9, Vercel Labs **json-render**, Thesys C1, Open-JSON-UI) and **open-ended** (sandboxed HTML iframes: **MCP Apps**, stable as SEP-1865, which ChatGPT now treats as the default under the OpenAI Apps SDK). AI SDK RSC `streamUI` is still published but documented as **experimental**, with AI SDK UI recommended for production.

### Cited Findings
**Vercel AI SDK**
- `ai` 7.0.159 and `@ai-sdk/react` 4.0.163, both published 2026-10-30, Apache-2.0. The `@ai-sdk/react` peer range is `react ^18 || ~19.0.1 || ~19.1.2 || ^19.2.1` (it pins patched 19.x lines) — [npm ai](https://registry.npmjs.org/ai), [npm @ai-sdk/react](https://registry.npmjs.org/@ai-sdk/react)
- AI SDK RSC: "AI SDK RSC is currently experimental". The docs recommend AI SDK UI for production and link a migration guide. `streamUI` "calls a model and allows it to respond with React Server Components" — [ai-sdk.dev RSC overview](https://ai-sdk.dev/docs/ai-sdk-rsc/overview). `@ai-sdk/rsc` 3.0.159 is still released alongside `ai` and is not npm-deprecated — [npm registry](https://registry.npmjs.org/@ai-sdk/rsc)
- AI SDK UI generative UI: iterate `message.parts`. Tool parts are typed `tool-${toolName}` (since AI SDK 5.0), for example `part.type === 'tool-displayWeather'`, with states such as `input-available`, `output-available` and `output-error`. On `output-available` you render `<Weather {...part.output} />` and use `part.errorText` on error — [ai-sdk.dev generative UI](https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces)
- Custom data parts in practice: vercel/chatbot streams artifact content as `data-codeDelta` parts handled in `onStreamPart` — [vercel/chatbot artifacts/code/client.tsx](https://raw.githubusercontent.com/vercel/chatbot/main/artifacts/code/client.tsx)

**assistant-ui**
- `@assistant-ui/react` 0.15.32 (2026-10-28, MIT, peer `react ^18 || ^19`): 871 KB min / 261 KB gzip default entry — [npm registry](https://registry.npmjs.org/@assistant-ui/react), [bundlephobia](https://bundlephobia.com/package/@assistant-ui/react)

**CopilotKit / AG-UI**
- `@copilotkit/react-core` 1.83.0 (2026-10-28, MIT, 12.6 MB unpacked). `@ag-ui/core` 1.0.3 (2026-10-16, MIT) — [npm react-core](https://registry.npmjs.org/@copilotkit/react-core), [npm ag-ui](https://registry.npmjs.org/@ag-ui/core)
- CopilotKit's taxonomy: static (the frontend owns components, streamed via AG-UI), declarative (A2UI, Open-JSON-UI) and open-ended (MCP Apps, HTML/iframe). APIs: `useFrontendTool` with a `render` per status (`inProgress`, `executing`, `complete`). `createA2UIMessageRenderer` from `@copilotkit/a2ui-renderer` is passed to `renderActivityMessages`. `MCPAppsMiddleware` from `@ag-ui/mcp-apps-middleware` is attached to a `BuiltInAgent` from `@copilotkit/runtime/v2`. AG-UI "is not a generative UI specification" but an event/state protocol (tool lifecycles, interactions, state) — [CopilotKit developer's guide to generative UI in 2026](https://www.copilotkit.ai/blog/the-developer-s-guide-to-generative-ui-in-2026)
- Open-JSON-UI is described as an open standardization of OpenAI's internal declarative schema — [CopilotKit guide](https://www.copilotkit.ai/blog/the-developer-s-guide-to-generative-ui-in-2026) (vendor source)

**Google A2UI**
- `@a2ui/react` 0.14.0 (2026-10-17, Apache-2.0, first published 2026-03-17, peer `react ^18 || ^19`): 50 KB gzip — [npm registry](https://registry.npmjs.org/@a2ui/react), [bundlephobia](https://bundlephobia.com/package/@a2ui/react)
- A2UI "employs a JSON payload to define what to render". The client "only renders trusted components from a predefined catalog". Example payloads use `"version": "v0.9"`, and the same payload targets React, Flutter and Angular. A2UI over MCP uses MIME `application/a2ui+json` via `resources/read` or `tools/call`. Patterns exist for embedding MCP Apps in A2UI and the reverse. Google is "considering making a MCP extension to support A2UI". The post is dated 2026-06-17 and co-written with MCP Apps co-creators — [Google Developers Blog](https://developers.googleblog.com/en/a2ui-and-mcp-apps/)
- A2UI messages: `surfaceUpdate`, `dataModelUpdate` and `beginRendering` (JSONL stream) — [CopilotKit guide](https://www.copilotkit.ai/blog/the-developer-s-guide-to-generative-ui-in-2026)

**MCP Apps / MCP-UI / OpenAI Apps SDK**
- `@modelcontextprotocol/ext-apps` 2.0.4 (2026-10-27, MIT, peer React 17–19). `@mcp-ui/client` 7.1.1 (2026-05-09, Apache-2.0, 88 KB gzip). `@mcp-ui/server` 6.1.0 (2026-02-13) — [npm ext-apps](https://registry.npmjs.org/@modelcontextprotocol/ext-apps), [npm mcp-ui client](https://registry.npmjs.org/@mcp-ui/client), [bundlephobia](https://bundlephobia.com/package/@mcp-ui/client), [npm mcp-ui server](https://registry.npmjs.org/@mcp-ui/server)
- MCP Apps treat UI as a resource: servers provide prebuilt HTML via `ui://` URIs, rendered in sandboxed iframes — [a2ui.org ecosystem comparison](https://a2ui.org/introduction/agent-ui-ecosystem/). The App Bridge (`AppBridge` from `@modelcontextprotocol/ext-apps`) relays events to the host via postMessage — [Google Developers Blog](https://developers.googleblog.com/en/a2ui-and-mcp-apps/)
- ChatGPT implements the MCP Apps UI standard. New apps should use MCP Apps standard keys and the bridge by default, and use `window.openai` only for ChatGPT-specific capabilities — [OpenAI: MCP Apps compatibility in ChatGPT](https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt)
- MCP Apps (SEP-1865) reached Stable, spec revision 2026-01-26 (secondary source) — [mcpbundles guide](https://www.mcpbundles.com/guides/mcp-apps-vs-chatgpt-apps-sdk). `window.openai.widgetState`/`setWidgetState()` have no direct MCP Apps equivalent — [sunpeak migration guide](https://sunpeak.ai/docs/mcp-apps/server/migrate-openai-apps)
- Microsoft 365 Copilot supports MCP Apps with partial field mapping (`app.ontoolinput`/`app.ontoolresult` supported, `openai/widgetAccessible` not) — [Microsoft Learn](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-mcp-apps)

**json-render (Vercel Labs)**
- `@json-render/core` and `@json-render/react` 0.21.3 (2026-10-24, Apache-2.0, first published 2026-01-14). The React package's peer is **`react ^19.2.3`** (React 19 only). It is 47 KB gzip — [npm registry](https://registry.npmjs.org/@json-render/react), [bundlephobia](https://bundlephobia.com/package/@json-render/react)
- API: `defineCatalog(schema, {components, actions})` with Zod `props` per component. `catalog.prompt()` generates the system prompt. `defineRegistry` builds the registry and `<Renderer spec registry />` renders it. The flat spec is `root` plus an `elements` map. Streaming uses `createSpecStreamCompiler().push(chunk)`, which returns `{result, newPatches}`. Packages cover React, Vue, Svelte, Solid, `@json-render/shadcn` (36 components), React Native, Remotion, React PDF/Email, Ink and R3F, plus an MCP integration. It claims to be "Guardrailed: AI can only use components in your catalog". The repo has about 18.9k stars — [github.com/vercel-labs/json-render](https://github.com/vercel-labs/json-render)

**Thesys C1 / Crayon**
- C1 is an OpenAI-compatible API that returns a UI spec (DSL) instead of text. The React SDK provides `C1Component` and `C1Chat` with progressive rendering. Crayon is the MIT open-source design system underneath, built on Radix and shadcn patterns — [Thesys blog](https://www.thesys.dev/blogs/how-to-build-generative-ui-applications), [abduzeedo](https://abduzeedo.com/thesys-generative-ui-c1-api)
- npm: `@thesysai/genui-sdk` 0.10.3 (2026-07-01) has license "see LICENSE.md", not a standard OSS identifier. `@crayonai/react-ui` 0.9.16 (2026-02-03, MIT) — [npm genui-sdk](https://registry.npmjs.org/@thesysai/genui-sdk), [npm crayon](https://registry.npmjs.org/@crayonai/react-ui). The search sources call the package `@thesys/genui-sdk`, so the scope name conflicts with npm, where `@thesysai/genui-sdk` is the one that exists.

### Inferences
- In a Next.js app already on AI SDK UI, the lowest-risk path is the static tier: typed tool parts rendered by app components, plus custom `data-*` parts for artifacts. json-render or A2UI can then be added for declarative layouts, since both use catalog-constrained trusted components. MCP Apps only become relevant when third-party MCP servers ship their own UI.
- json-render's React 19.2.3+ peer and pre-1.0 versioning (0.21) mean breaking changes are likely. A2UI is also pre-1.0 (spec v0.9, React renderer 0.14).
- Thesys C1 is a hosted, proprietary API layer with an MIT UI kit. It isn't a fully open-source option.
- CopilotKit is the only framework found that integrates all three tiers (AG-UI, A2UI and MCP Apps) out of the box, but most of that comparison comes from CopilotKit's own materials.

### Gaps
- The assistant-ui Tool UI docs page returned 404 (`/docs/guides/ToolUI`). I couldn't verify the current `makeAssistantToolUI`/`makeAssistantTool` API names or the status values (`running`/`complete`/`incomplete`/`requires-action`) this session.
- I didn't verify the AI SDK `input-streaming` state or the AI SDK 6/7 changes to tool parts. The fetched page referenced only 5.0.
- I didn't verify OpenAI's Open-JSON-UI repository or license.
- I didn't verify official MCP Apps spec text (the stable date comes from a secondary source).

## Artifact implementations in open-source chat apps (LibreChat, Open WebUI, LobeChat, vercel/chatbot, big-AGI)

### Takeaway
LibreChat parses `:::artifact{identifier type title}` directives with `remark-directive` and runs React, HTML and Mermaid inside **Sandpack** (with a configurable, self-hostable bundler URL and Tailwind 3.4.17 from CDN). Open WebUI collects HTML, CSS, JS and SVG from code blocks into an `<iframe srcdoc>` with an injected CSP and `sandbox="allow-scripts allow-downloads allow-forms"` (`allow-same-origin` off by default). vercel/chatbot avoids running arbitrary UI: artifacts are text (ProseMirror), code (CodeMirror plus **Pyodide** in-browser Python), sheet (react-data-grid) and image, streamed as AI SDK `data-*` parts.

### Cited Findings
**LibreChat**
- The directive is parsed via remark `visit(tree, ['textDirective','leafDirective','containerDirective'])`. The artifact key is `${identifier}_${type}_${title}_${messageId}`, and the default identifier is `lc-no-identifier` — [LibreChat Artifact.tsx](https://raw.githubusercontent.com/danny-avila/LibreChat/main/client/src/components/Artifacts/Artifact.tsx). Messages are detected with `/:::artifact(?:\{[^}]*\})?/g` — [useArtifacts.ts](https://raw.githubusercontent.com/danny-avila/LibreChat/main/client/src/hooks/Artifacts/useArtifacts.ts). It depends on `remark-directive ^3.0.0` and `@codesandbox/sandpack-react ^2.19.10` — [client/package.json](https://raw.githubusercontent.com/danny-avila/LibreChat/main/client/package.json)
- Types: `text/html`, `application/vnd.react`, `text/markdown`, `text/plain`, `application/vnd.code`, mermaid, `image/svg+xml` and Office previews (`application/vnd.librechat.docx-preview` and others). Short aliases (`react`, `html`, `md`, `mermaid`, `svg`) are normalized. Sandpack templates: React and Mermaid use `react-ts`; HTML, code, markdown and SVG use `static`. Empty dependency maps "skip the sandpack package.json install step". The bundler is `startupConfig.bundlerURL` / `staticBundlerURL` (configurable, so it can be self-hosted). Tailwind is loaded from `https://cdn.tailwindcss.com/3.4.17`. A bare SVG is wrapped in an HTML shell because it would otherwise "render blank". An Office-HTML trust gate stops RAG-extracted text from becoming "executable markup" — [LibreChat artifacts.ts](https://raw.githubusercontent.com/danny-avila/LibreChat/main/client/src/utils/artifacts.ts)

**Open WebUI**
- Artifacts render in `<iframe srcdoc={injectCsp(content, $config?.ui?.iframe_csp)}>`. The sandbox flags are user settings: `allow-scripts`, `allow-downloads` and `allow-forms` default to **on**, and `allow-same-origin` defaults to **off**. SVG has its own renderer. Fullscreen and "download as .html" are supported, and in-iframe link clicks are intercepted to use `history.pushState` — [Open WebUI Artifacts.svelte](https://raw.githubusercontent.com/open-webui/open-webui/main/src/lib/components/chat/Artifacts.svelte)

**vercel/chatbot (formerly ai-chatbot)**
- Stack: `next 16.2.10`, `react 19.2.7`, `ai 7.0.15`, `@ai-sdk/react 4.0.16`, `streamdown ^2.3.0`, `shiki ^3.21.0`, `codemirror ^6`, `prosemirror-view`, `react-data-grid 7.0.0-beta.47`, `papaparse` — [vercel/chatbot package.json](https://raw.githubusercontent.com/vercel/chatbot/main/package.json)
- Artifact kinds are under `artifacts/{text,code,sheet,image}/{client,server}.tsx`. Tools `create-document`, `update-document`, `edit-document` and `request-suggestions` live in `lib/ai/tools/` — [vercel/chatbot repo tree](https://github.com/vercel/chatbot)
- Code artifacts run Python in-browser via `loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.23.4/full/" })` with `loadPackagesFromImports` and a matplotlib output shim. Streaming arrives through `onStreamPart` handling `streamPart.type === "data-codeDelta"` — [artifacts/code/client.tsx](https://raw.githubusercontent.com/vercel/chatbot/main/artifacts/code/client.tsx)

### Inferences
- Running Pyodide on the main thread from a 2023-era version (0.23.4) is a demo-grade choice. Production apps would move it to a Web Worker and a current Pyodide.
- Open WebUI's default (scripts on, same-origin off) is the conventional safe baseline. With `allow-scripts` plus `allow-same-origin` on the same origin, the sandbox is effectively escaped.
- LibreChat's design (an explicit directive with identifier, type and title, plus a self-hostable Sandpack bundler) is the closest open-source analogue to Claude Artifacts. Its directive syntax depends on the prompt telling the model to use `:::artifact`.

### Gaps
- LobeChat and big-AGI artifacts: GitHub API listing failed (redirect and rate limits), so I couldn't verify their implementations this session.
- I didn't confirm how LibreChat renders partially streamed artifacts (whether Sandpack refreshes per chunk or waits for the directive to close).

## Running model-written React: Sandpack/Nodebox, esm.sh, react-runner, Babel standalone in an iframe

### Takeaway
**Sandpack** (`@codesandbox/sandpack-react` 2.20.0, Apache-2.0) is the most turnkey option, as used by LibreChat. Its last npm release was 2025-02-14, so it is a maintenance risk, and it relies on a CodeSandbox-hosted bundler unless you self-host. A lighter DIY path is a sandboxed cross-origin iframe with `@babel/standalone` (8.0.10, about 542 KB gzip) plus an import map to esm.sh. `react-runner` (1.0.5, 2024-06, React peer only up to 18) is stale.

### Cited Findings
- `@codesandbox/sandpack-react` 2.20.0, published 2025-02-14, Apache-2.0, peer includes `^19` — [npm registry](https://registry.npmjs.org/@codesandbox/sandpack-react). Bundlephobia reports 650 KB min / 13 KB gzip. The gzip figure looks anomalous, so treat it as unreliable — [bundlephobia](https://bundlephobia.com/package/@codesandbox/sandpack-react)
- LibreChat makes the Sandpack bundler URL configurable (`bundlerURL`, `staticBundlerURL`) and preinstalls `three`, `recharts`, `lucide-react` and Radix for React artifacts — [LibreChat artifacts.ts](https://raw.githubusercontent.com/danny-avila/LibreChat/main/client/src/utils/artifacts.ts)
- `@babel/standalone` 8.0.10 (2026-10-29, MIT): 2138 KB min / **542 KB gzip** — [npm registry](https://registry.npmjs.org/@babel/standalone), [bundlephobia](https://bundlephobia.com/package/@babel/standalone)
- `react-runner` 1.0.5, last published 2024-06-05, peer `react ^16 || ^17 || ^18` (no React 19) — [npm registry](https://registry.npmjs.org/react-runner)
- MCP Apps / OpenAI Apps standardize the "UI in a sandboxed iframe + postMessage bridge" model for model-adjacent UI — [Google Developers Blog](https://developers.googleblog.com/en/a2ui-and-mcp-apps/), [OpenAI MCP Apps compatibility](https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt)

### Inferences
- Babel standalone at about 540 KB gzip should load only inside the artifact iframe, never in the main app bundle. Sucrase or esbuild-wasm are lighter transpile alternatives (not measured this session).
- Whichever runner you use, serve the iframe from a separate origin (or `srcdoc` without `allow-same-origin`), apply a CSP, and expose host capabilities only through a narrow postMessage API, as Open WebUI and MCP Apps do.

### Gaps
- I didn't research Nodebox or esm.sh status and limits, or the cost and self-hosting requirements of the CodeSandbox bundler, this session.
- I didn't verify Sandpack's maintenance status beyond the npm publish date (no GitHub activity was checked).

## Math: KaTeX vs MathJax

### Takeaway
**KaTeX 0.19.1** (MIT, 2026-10-23, about 75 KB gzip plus fonts) is the default in chat UIs (Streamdown's math plugin, rehype-katex, Open WebUI, LibreChat). It is synchronous and fast. **MathJax 4.1.3** (Apache-2.0, 2026-07-03) has broader TeX coverage and accessibility, but it is larger and asynchronous.

### Cited Findings
- `katex` 0.19.1, published 2026-10-23, MIT: 254 KB min / 75 KB gzip — [npm registry](https://registry.npmjs.org/katex), [bundlephobia](https://bundlephobia.com/package/katex)
- `mathjax` 4.1.3, published 2026-07-03, Apache-2.0, 19.5 MB unpacked. `better-react-mathjax` 3.0.3 (2026-10-14, MIT) — [npm mathjax](https://registry.npmjs.org/mathjax), [npm better-react-mathjax](https://registry.npmjs.org/better-react-mathjax). (Bundlephobia only had the legacy `mathjax-full` 3.2.2 at 49 KB gzip, which isn't comparable to v4 — [bundlephobia](https://bundlephobia.com/package/mathjax-full).)
- Open WebUI uses `katex ^0.16.22` and LibreChat uses `rehype-katex ^6.0.3` — [open-webui package.json](https://raw.githubusercontent.com/open-webui/open-webui/main/package.json), [LibreChat client/package.json](https://raw.githubusercontent.com/danny-avila/LibreChat/main/client/package.json)
- Streamdown's remend completes unclosed `$$` math during streaming (the `katex` flag). Streamdown's math is a separate `@streamdown/math` plugin — [streamdown.ai/llms.txt](https://streamdown.ai/llms.txt)
- Mermaid's tiny build drops KaTeX rendering in diagrams — [mermaid.js.org/config/usage](https://mermaid.js.org/config/usage.html)

### Inferences
- KaTeX's synchronous render suits per-block memoized streaming, because a math block renders once when its block finalizes. MathJax's asynchronous typesetting complicates streaming reflow.
- LLMs often emit `\(...\)` / `\[...\]` delimiters as well as `$...$`. Whichever renderer you choose, normalize the delimiters (remark-math defaults to dollar delimiters). This should be checked in practice.

### Gaps
- I didn't benchmark KaTeX vs MathJax 4 render speed, MathJax 4 bundle size per component, or KaTeX font payload size this session.
