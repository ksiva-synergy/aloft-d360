# Runtime harness around production LLM agents: guardrails, permissions, limits, observability, feedback (2024-2026)

Scope note: Sources marked **[fetched]** were read during this session (2026-11-02). Sources marked **[not re-fetched]** are well-known primary documents cited from prior knowledge. The report writer should treat their exact wording and numbers as needing verification. Each one is also listed under the relevant Gaps.

ALOFT context used for the inferences: tool loop = `describe_schema`, read-only SQL `execute_tool` against Databricks through a **shared service principal**, `search_knowledge` over KBs, memory injected into the prompt. Providers are Bedrock plus optional xAI and Azure OpenAI. Runs happen in chat and in unattended automations.

---

## 1. What a "harness" is and which components it owns

### Takeaway
The "harness" is the deterministic software around the model. It owns the loop, the tool registry and permission checks, context and memory management, limits, retries and error handling, human approval and tracing. Vendors now ship it as a product (Claude Agent SDK is described as "a general-purpose agent harness"; the OpenAI Agents SDK provides the runner, guardrails and tracing). Safety and reliability come from the harness, not from the prompt.

### Cited Findings
- Anthropic calls the Claude Agent SDK "a powerful, general-purpose agent harness" with context management such as compaction. For multi-session work they added a structure on top: an **initializer agent** that sets up the environment (an `init.sh`, a progress log, an initial git commit), a **JSON feature list** where the agent may change only the `passes` field, **one feature per session**, git commits plus progress notes for recovery, and a fixed **startup routine** (read the logs and progress, run a basic end-to-end test before new work). Published 26 Nov 2025. [fetched] — [Anthropic, Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- The same post picked JSON over Markdown for state because models are less likely to overwrite JSON inappropriately. Without explicit prompting, Claude often marked features complete after only unit tests or curl checks, so the harness has to require end-to-end verification. [fetched] — [Anthropic, Effective harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- Context engineering (29 Sep 2025): "Context... must be treated as a finite resource with diminishing marginal returns" (context rot). The post's recommended harness techniques:
  - **compaction**: summarize the conversation near the limit and start a new window. Clearing old tool results is the "low-risk first step".
  - **structured note-taking / memory tool**: a file-based memory tool, in public beta.
  - **sub-agents** with clean contexts that return condensed results of about 1,000-2,000 tokens.
  - **just-in-time retrieval** through lightweight identifiers.
  - **minimal, non-overlapping, token-efficient tools**: "if a human engineer can't clearly pick a tool, an agent can't either".

  [fetched] — [Anthropic, Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- The Claude Agent SDK checks permissions in a fixed order: **1. hooks** (`PreToolUse` can deny; a hook "allow" does not skip later deny/ask rules) → **2. deny rules** (apply even in `bypassPermissions`) → **3. ask rules** (always routed to the approval callback) → **4. permission mode** → **5. allow rules** → **6. `canUseTool` callback**. `disallowed_tools=["Bash"]` removes the tool definition so the model never sees it. `dontAsk` mode turns every would-be prompt into a denial. The docs give this as the locked-down headless pattern: `allowedTools: [...] + permissionMode: "dontAsk"`. "For checks that must run on every tool call, use a PreToolUse hook." The docs warn that `allowed_tools` does **not** constrain `bypassPermissions`, and that auto-approved tools never reach `canUseTool`, so checks placed there are silently skipped. [fetched] — [Claude Agent SDK, Configure permissions](https://code.claude.com/docs/en/agent-sdk/permissions)
- OpenAI Agents SDK guardrails:
  - **Input guardrails** run only on the first agent. In the default parallel mode, "the agent may have already consumed tokens and executed tools before being cancelled". Blocking mode (`run_in_parallel=False`) finishes before the agent starts.
  - **Output guardrails** run only on the last agent, after it completes.
  - **Tool guardrails** attach to each `FunctionTool` and run on every call. Before execution they can skip the call, replace the output or raise a tripwire. After execution they can replace the output or raise a tripwire. Handoffs and hosted tools bypass this pipeline.
  - **Tripwires** halt the run with typed exceptions (`InputGuardrailTripwireTriggered`, `OutputGuardrailTripwireTriggered`, `ToolInputGuardrailTripwireTriggered`, `ToolOutputGuardrailTripwireTriggered`).
  - With approval-required tools, input checks normally run *after* approval. `pre_approval_tool_input_guardrails=True` moves them before the approval step.

  [fetched] — [OpenAI Agents SDK, Guardrails](https://openai.github.io/openai-agents-python/guardrails/)
- "Building effective agents" (Dec 2024) separates **workflows** (predefined code paths) from **agents** (the LLM directs its own process and tool use). It recommends the simplest pattern that works, **stopping conditions such as a maximum number of iterations**, extensive testing in **sandboxed environments** with appropriate guardrails, and investment in the agent-computer interface (clear tool docs, poka-yoke arguments). [not re-fetched] — [Anthropic, Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- OpenAI's "A practical guide to building agents" (2025) describes an agent as model + tools + instructions, with a run loop that exits on a final-output tool, a response with no tool calls, an error, or max turns. Its guardrail types are: relevance classifier, safety classifier (jailbreak/injection), PII filter, moderation, **tool safeguards with a low/medium/high risk rating per tool** (read-only vs write, reversibility, permissions, financial impact), rules-based protections (blocklists, input length limits, regex) and output validation. Human intervention triggers are **exceeding failure thresholds** and **high-risk actions**. [not re-fetched; the PDF was downloaded but text extraction failed in this environment] — [OpenAI, A practical guide to building agents (PDF)](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf)

### Inferences
- For ALOFT, the harness is the right place for everything that must hold whether or not the model complies:
  - the tool allowlist, as a deny-by-default list per agent
  - argument validation (SQL parse to read-only, table allowlist)
  - identity propagation
  - limits (turns, tokens, cost, wall clock)
  - guardrail hooks before and after each tool call
  - the approval gate
  - tracing
- The Claude SDK ordering is a useful template for ALOFT's own policy engine: org-level deny → agent-level deny → "ask" (HITL) → mode → allow → runtime callback. Deny must win over every allow, including any "bypass"/admin mode.
- The OpenAI parallel-input-guardrail caveat matters for ALOFT. If the input check runs in parallel with the loop, `execute_tool` may already have run SQL before the tripwire fires. Unattended automations should use **blocking** input guardrails.
- Things each agent should **declare** in its manifest:
  - id/version, owner, purpose and scope statement
  - tools (each with a risk tier)
  - data scope (catalogs, schemas, tables), KBs, memory scope
  - allowed models/providers and data-sensitivity class
  - turn/token/cost/time limits
  - HITL policy, output contract (citations required, JSON schema)
  - run surfaces (chat vs automation)

### Gaps
- I could not text-extract the OpenAI practical-guide PDF in this environment. The guardrail list and the trigger wording above come from prior knowledge and need verification against the PDF.
- "Building effective agents" was not re-fetched this session.

---

## 2. Guardrails: input, output and tool-call (with products)

### Takeaway
Use layers. Cheap deterministic checks (regex/PII, length limits, allowlists, SQL parsing) come first. Then managed classifiers (Bedrock Guardrails, Prompt Shields, Llama Guard/Prompt Guard). Then output checks against the tool results (contextual grounding, citation and schema enforcement). Tool-call guardrails (allowlist, argument validation, least privilege, on-behalf-of identity) are the controls that actually bound damage. Classifiers are probabilistic.

### Cited Findings
- **AWS Bedrock Guardrails** policy types:
  - **Content filters**: Hate, Insults, Sexual, Violence, Misconduct and **Prompt Attack**, each with configurable strength. The Standard tier also covers harmful content hidden in code elements.
  - **Denied topics**.
  - **Word filters**: case-insensitive whole-word and whole-phrase matching.
  - **Sensitive information filters**: **block or mask** PII entities such as SSN, DOB and address, using probabilistic detection plus **custom regex**.
  - **Contextual grounding checks**.
  - **Automated Reasoning checks**: validate responses against logical rules.

  Guardrails attach to inference calls by guardrail ID and version, or run standalone through **`ApplyGuardrail` without invoking a model**. Input tagging lets you evaluate only the user-input section and skip system prompts and search results. Guardrails evaluate inputs and responses "excluding reasoning content blocks". [fetched] — [AWS, Amazon Bedrock Guardrails](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails.html)
- **Bedrock contextual grounding** scores **grounding** (is the response supported by the source; "any new information introduced in the response will be considered un-grounded") and **relevance** (does it answer the query). Details:
  - Thresholds run from 0 to 0.99. Responses scoring below the threshold are blocked. 0.7 is "a reasonable starting point" for conversational use on the Standard tier.
  - Limits: **100,000 chars of grounding source, 1,000 chars of query, 5,000 chars of response**.
  - The check needs three inputs: the grounding source, the query, and the content to guard. With `ApplyGuardrail` you pass these as qualified content blocks (`grounding_source`, `query`, plus an unqualified block holding the response). It runs only on output.
  - Classic tier (the default) is strict and does not support conversational use; the Standard tier needs cross-Region inference. `UpdateGuardrail` without `tierConfig` silently resets the tier to Classic.
  - With streaming, an irrelevant response may be shown to the user and flagged only after it has finished streaming.

  [fetched] — [AWS, Contextual grounding check](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-contextual-grounding-check.html)
- Each filter has `action: BLOCK | NONE`. `NONE` returns detection information without blocking, which gives a detect-only / shadow mode. [fetched] — [AWS, Contextual grounding check (API section)](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-contextual-grounding-check.html)
- **Azure AI Content Safety Prompt Shields** is "a probabilistic classifier trained on known injection techniques across multiple languages", offered as a unified API that covers user-prompt attacks and document (indirect) attacks, with alerts integrated into Defender for Cloud. [fetched, via MSRC] — [Microsoft MSRC, How Microsoft defends against indirect prompt injection attacks (Jul 2025)](https://www.microsoft.com/en-us/msrc/blog/2025/07/how-microsoft-defends-against-indirect-prompt-injection-attacks)
- The OpenAI Agents SDK tool guardrails (per-tool input/output checks that can skip a call, rewrite the output or trip) are the closest off-the-shelf model of "argument validation + output sanitization per tool". [fetched] — [OpenAI Agents SDK, Guardrails](https://openai.github.io/openai-agents-python/guardrails/)
- OWASP LLM06:2025 **Excessive Agency** splits the root causes into excessive **functionality**, excessive **permissions** and excessive **autonomy**. Its mitigations: minimize extensions and their functionality, avoid open-ended tools, **execute extensions in the user's context** (on-behalf-of / OAuth with minimum scope), require user approval for high-impact actions, and enforce authorization in downstream systems, not in the LLM. [not re-fetched] — [OWASP LLM06:2025 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)
- OWASP Top 10 for Agentic Applications 2026 (announced 9 Dec 2025):
  - ASI01 Agent Goal Hijack
  - **ASI02 Tool Misuse** (harmful use of tools the agent is legitimately allowed to use)
  - **ASI03 Identity & Privilege Abuse**
  - ASI04 Supply Chain
  - ASI05 Unexpected Code Execution
  - **ASI06 Memory & Context Poisoning**
  - ASI07 Inter-Agent Communication
  - ASI08 Cascading Failures
  - ASI09 Human-Agent Trust Exploitation
  - ASI10 Rogue Agents

  [fetched via secondary summaries; official page not retrieved] — [Cycode summary](https://cycode.com/blog/owasp-top-10-agentic-applications/); [Polygraf summary](https://www.polygraf.ai/?p=28067); [Trainingcamp explainer](https://trainingcamp.com/articles/owasp-top-10-for-agentic-applications-2026-explained/)
- Other products (not re-fetched; capability descriptions from prior knowledge):
  - **NVIDIA NeMo Guardrails**: programmable "rails" (input, output, dialog, retrieval, execution) written in Colang. [NeMo Guardrails docs](https://docs.nvidia.com/nemo/guardrails/)
  - **Meta Llama Guard 3/4**: a safety classifier over prompts and responses using a hazard taxonomy.
  - **Llama Prompt Guard 2**: a small classifier for jailbreak and prompt-injection detection. [Meta Llama protections](https://www.llama.com/llama-protections/)
  - **Guardrails AI**: validators hub, schema and structured-output validation with re-ask. [Guardrails AI docs](https://www.guardrailsai.com/docs)
  - **OpenAI Moderation API** (`omni-moderation`): harm-category classification. [OpenAI moderation guide](https://platform.openai.com/docs/guides/moderation)

### Inferences
- **Input guardrails, ALOFT**: Bedrock `ApplyGuardrail` works with any model, including xAI and Azure responses. It can be the one platform-wide guardrail layer: Prompt Attack filter, denied topics per agent scope, and PII masking on the user input. That keeps policy consistent across providers.
- **Output guardrails, ALOFT**: run contextual grounding with `grounding_source` = the concatenated tool results (SQL result sets, KB chunks) and `query` = the user question.
  - The source limit (100k chars) and the response limit (5k chars) mean large result sets must be summarized or sampled first, and long answers must be checked in chunks.
  - Use `NONE` (detect) mode first to calibrate thresholds per agent.
  - Add deterministic **citation enforcement**: every numeric claim must map to a tool-call id or KB chunk id present in this run. Add JSON-schema validation for automation outputs.
- **Tool-call guardrails, ALOFT** (highest value):
  - Parse SQL with an AST and allow only a single `SELECT` statement: no DDL/DML, no multiple statements, no `COPY`/`EXPORT`.
  - Enforce a **per-agent table allowlist** on the resolved identifiers.
  - Force `LIMIT` and timeouts.
  - Most importantly, replace or augment the **shared service principal** with the **calling user's identity**, or with a per-agent, narrowly granted principal, so that Unity Catalog row and column policies apply. Today a shared SP means every agent can read whatever the SP can read. That is exactly OWASP LLM06 "excessive permissions" and ASI03.
  - `describe_schema` should be filtered to the same allowlist, so the model cannot even learn of tables outside its scope.
- Declare vs enforce: the agent **declares** its tables, KBs, tools with risk tier, guardrail profile and grounding threshold. The platform **enforces** identity, the SQL AST checks, the guardrail calls and tripwires, and holds the audit trail.

### Gaps
- I did not retrieve the official OWASP Agentic Top 10 page. The exact ASI titles come from secondary summaries.
- I found no primary source this session on Databricks on-behalf-of-user auth for agents (e.g., Databricks Apps or Model Serving OBO). This needs verification before recommending a specific mechanism.
- I did not fetch benchmark accuracy or false-positive rates for Bedrock Prompt Attack, Prompt Shields or Prompt Guard. None are reported here.

---

## 3. Prompt injection containment for agents with data access

### Takeaway
Detection is probabilistic and will fail some of the time ("95% is a failing grade"). Containment has to be architectural:
- never combine untrusted input + sensitive data + an external action/exfiltration channel in one unsupervised session (lethal trifecta / Rule of Two)
- mark untrusted data (spotlighting)
- block exfiltration channels deterministically
- for high-risk flows, separate planning from untrusted-data processing (dual-LLM / CaMeL)

### Cited Findings
- **Lethal trifecta** (Simon Willison, 16 Jun 2025): access to private data + exposure to untrusted content + the ability to communicate externally. Supporting points from the post:
  - LLMs follow instructions wherever they appear.
  - Vendor guardrails claiming to block ~95% of attacks are inadequate: "in web application security 95% is very much a failing grade".
  - Dozens of exfiltration bugs (M365 Copilot, GitHub MCP, GitLab Duo, ChatGPT, Slack, others) were fixed by **blocking the exfiltration path**.
  - MCP-style tool mixing makes it easy to assemble all three ingredients.
  - Quoting the design-patterns paper: once an agent has ingested untrusted input, "it must be constrained so that it is impossible for that input to trigger any consequential actions."

  [fetched] — [Simon Willison, The lethal trifecta for AI agents](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)
- **Meta "Agents Rule of Two"** (31 Oct 2025): [A] processes untrustworthy inputs, [B] has access to sensitive systems or private data, [C] can change state or communicate externally. An agent should satisfy **no more than two** in one session. If all three are needed without a fresh context window, it "should not be permitted to operate autonomously" and needs HITL approval or another reliable validation. An agent may switch configuration within a session, e.g. from [AC] to [B] by disabling external communication before accessing internal systems. Examples include [AB] with human confirmation for reservations and URLs limited to trusted sources. [fetched] — [Meta AI, Agents Rule of Two](https://ai.meta.com/blog/practical-ai-agent-security/)
- **Microsoft defense-in-depth** (Jul 2025):
  - **Spotlighting** has three modes: *delimiting* (randomized delimiters), *datamarking* (a special token interleaved through untrusted text) and *encoding* (base64/ROT13). Each comes with a system-prompt instruction not to follow instructions inside the marked content.
  - **Prompt Shields** classifier.
  - Research systems **TaskTracker** (detection from activations) and **FIDES** (information-flow control for deterministic prevention).
  - **Deterministic blocking of exfiltration**, e.g. markdown images and certain untrusted links.
  - **HITL**: Copilot in Outlook drafts but the user must send.
  - **Data governance**: Purview sensitivity labels and DLP limit what an injected prompt can reach.

  The approach "does not rely on our ability to block all prompt injections". The post gives no effectiveness percentages. [fetched] — [Microsoft MSRC blog](https://www.microsoft.com/en-us/msrc/blog/2025/07/how-microsoft-defends-against-indirect-prompt-injection-attacks)
- The original Spotlighting paper (Hines et al., Mar 2024) reported that datamarking/encoding cut indirect-injection attack success from above 50% to below 2% on the GPT-family models tested. [not re-fetched] — [arXiv 2403.14720](https://arxiv.org/abs/2403.14720)
- **CaMeL** (Google DeepMind and others; v1 24 Mar 2025, v2 24 Jun 2025):
  - A privileged LLM writes a program from the trusted user query only. A quarantined LLM parses untrusted data and has no tool access. A custom interpreter tracks data flow.
  - Each value carries **capabilities** (provenance and allowed readers), and security policies gate tool calls on them.
  - It solves **77% of AgentDojo tasks with provable security**, against 84% for an undefended system.
  - Limitation: when the next actions depend on untrusted data, the planner cannot plan without reading that data. Token overhead is higher than spotlighting.

  [fetched abstract] — [arXiv 2503.18813, Defeating Prompt Injections by Design](https://arxiv.org/abs/2503.18813); limitation and overhead per [secondary review](https://www.themoonlight.io/review/defeating-prompt-injections-by-design). Code: github.com/google-research/camel-prompt-injection.
- "Design Patterns for Securing LLM Agents against Prompt Injections" (Beurer-Kellner et al., 2025) lists six patterns: action-selector, plan-then-execute, LLM map-reduce, dual LLM, code-then-execute, context-minimization. [referenced in fetched Willison post; paper not fetched] — [arXiv 2506.08542](https://arxiv.org/abs/2506.08542)
- OWASP LLM01:2025 Prompt Injection covers direct and indirect injection. Its mitigations: constrain model behavior, define and validate output formats, input/output filtering, **enforce privilege control and least privilege**, **require human approval for high-risk actions**, **segregate and identify external content**, adversarial testing. [not re-fetched] — [OWASP LLM01:2025](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)

### Inferences
- **ALOFT Rule-of-Two mapping**:
  - [B] is always present: Databricks data, private KBs.
  - [A] is present whenever the agent reads free-text columns (tickets, comments, emails stored in tables), KB documents uploaded by many authors, or memory written from earlier sessions. Table **data** is untrusted content, not only web pages.
  - [C] is absent in pure read-only chat **only if** the UI renders no auto-fetching content. Markdown images or links in the chat renderer are an exfiltration channel (the Microsoft and Willison incident class). Automations that send email, Slack, webhooks or write-back are [C].
  - Platform rules that follow:
    - (1) Sanitize the chat renderer deterministically: no remote images, and allowlist link domains.
    - (2) An automation that has any [C] action plus SQL/KB access must either have a HITL approval step or run with [A] removed (structured columns only, trusted-author KBs).
    - (3) After the agent has read untrusted content in a session, the harness may downgrade it (disable [C] tools). That is the Meta "switch configuration" idea.
- Spotlight all tool results: wrap SQL rows and KB chunks in randomized delimiters with provenance (table name, KB doc id, author), and instruct the model to treat them as data. This is cheap and works with every provider.
- CaMeL-style separation is heavy. A practical subset for ALOFT is **plan-then-execute** for automations: the plan and SQL templates are fixed at authoring or approval time, and runtime data can fill values but cannot add new tool calls.

### Gaps
- The Spotlighting paper's exact percentages and the OWASP LLM01 text were not re-fetched this session.
- I found no published measurements of injection success via database cell contents specifically. The inference that table text is untrusted input is mine.

---

## 4. Runtime limits and cost controls

### Takeaway
Every run needs hard caps the harness enforces: turns/tool calls, wall-clock time, tokens, dollar spend. Shared resources also need per-user and per-agent quotas, plus circuit breakers on repeated failure. Model fallback and provider routing should be policy-driven by data sensitivity, never decided by the model.

### Cited Findings
- Anthropic advises stopping conditions such as a maximum number of iterations to keep control. [not re-fetched] — [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- OpenAI names "exceeding failure thresholds" (limits on retries/actions) as a trigger to hand off to a human. [not re-fetched] — [OpenAI practical guide (PDF)](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf)
- SDK limits:
  - The OpenAI Agents SDK runner takes `max_turns` and raises `MaxTurnsExceeded` when it is exceeded. [not re-fetched] — [OpenAI Agents SDK, Running agents](https://openai.github.io/openai-agents-python/running_agents/)
  - The Claude Agent SDK exposes `maxTurns` and (TypeScript) `maxBudgetUsd` options. [not re-fetched] — [Claude Agent SDK TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript)
- OWASP LLM10:2025 **Unbounded Consumption** (denial of wallet, resource exhaustion). Mitigations: input size limits, rate limiting and user quotas, timeouts and throttling, resource allocation management, monitoring and anomaly detection. [not re-fetched] — [OWASP LLM10:2025](https://genai.owasp.org/llmrisk/llm102025-unbounded-consumption/)
- OWASP ASI08 **Cascading Failures** names error propagation across agents and tools as a top agentic risk. [secondary] — [Cycode summary](https://cycode.com/blog/owasp-top-10-agentic-applications/)
- Bedrock Guardrails Standard tier needs cross-Region inference with a chosen guardrail profile that defines destination Regions. Routing scope is therefore a configurable residency decision. [fetched] — [AWS contextual grounding / guardrails docs](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-contextual-grounding-check.html)
- OTel GenAI usage attributes standardize token accounting: `gen_ai.usage.input_tokens` includes cached tokens, `gen_ai.usage.output_tokens` includes reasoning tokens. [fetched] — [OTel GenAI agent spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md)

### Inferences
- Per-agent declared limits, enforced by the platform:
  - max loop iterations (e.g., chat 8-12, automation 20-30)
  - max tool calls per tool per run (e.g., `execute_tool` ≤ N)
  - per-SQL timeout and row/byte cap
  - total run wall-clock
  - max input and output tokens per call
  - max USD per run
- Platform-wide limits: per-user and per-agent daily spend caps, concurrency caps for automations, a global kill threshold.
- A circuit breaker trips an agent or tool into "disabled" after K consecutive tool errors, guardrail tripwires or provider errors within T minutes, and alerts the owner. Repeated identical tool calls (a loop signature) end the run early.
- Fallback policy: list allowed models per agent in priority order, and fall back only within the same **data-sensitivity class**. Data classified confidential/PII never routes to a provider outside the approved residency (e.g., stays on Bedrock in-region and does not go to xAI). Log every fallback.
- Token figures alone undercount cost: guardrail calls (`ApplyGuardrail`), grounding checks and Databricks SQL warehouse time also cost money. Cost per run should include them.

### Gaps
- I did not fetch primary sources for SDK option names (`max_turns`, `maxBudgetUsd`) or for OWASP LLM10. Verify them.
- I found no authoritative published benchmark for "good" default turn or budget limits. The numbers above are illustrative inferences.
- No primary source was fetched on Bedrock/Azure data-residency routing guarantees for cross-Region inference beyond the guardrail-profile mechanism.

---

## 5. Memory governance

### Takeaway
Persistent memory is an attack surface (OWASP ASI06, Memory & Context Poisoning) and a privacy surface. Memory needs:
- explicit scope (user / agent / team / org)
- provenance on every entry (who or what wrote it, from which run, from which source content)
- write controls (no automatic writes derived from untrusted content without review)
- the same untrusted-data treatment as KB content when injected
- user-visible deletion and retention

### Cited Findings
- OWASP ASI06 Memory & Context Poisoning: attackers plant content in memory or the retrieval context so later decisions are corrupted. Techniques include vector-DB poisoning, cross-session context injection and long-term memory manipulation. One summary calls it a delayed form of goal hijack. [secondary] — [Trainingcamp explainer](https://trainingcamp.com/articles/owasp-top-10-for-agentic-applications-2026-explained/); [guptadeepak ASI06](https://guptadeepak.com/agent-security/threats/asi06/)
- Anthropic's memory approach is structured notes written to storage outside the context window and read back later (file-based memory tool, beta). Memory is therefore an explicit, inspectable artifact, not hidden state. [fetched] — [Anthropic, Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- CaMeL's capability model attaches **provenance and allowed readers** to every value and gates tool use on them. This is a formal template for provenance-tagged memory. [fetched abstract] — [arXiv 2503.18813](https://arxiv.org/abs/2503.18813)
- OWASP LLM08:2025 **Vector and Embedding Weaknesses** covers unauthorized access and cross-tenant leakage from shared vector stores, data poisoning and embedding inversion. Mitigations include **permission-aware vector stores**, data validation and source authentication, and logging of retrieval activity. [not re-fetched] — [OWASP LLM08:2025](https://genai.owasp.org/llmrisk/llm082025-vector-and-embedding-weaknesses/)

### Inferences
- Each memory record should carry these fields:
  - `scope` (user|agent|team|org) and `owner_id`
  - `source_run_id`, `source_type` (user-stated | model-inferred | derived-from-tool-result | admin)
  - `trust_level`
  - `created_at`, `expires_at`
  - `pii_flag`
- Inject memory inside spotlight delimiters with provenance. Never put memory in the system-prompt position, where it would gain authority.
- Write policy:
  - Memory derived from tool results or KB text (untrusted [A]) should not be auto-promoted to team or org scope without human review.
  - Model-inferred user preferences stay user-scoped.
- Deletion: a user can view and delete their memories, and deletion propagates to embeddings/indices and to trace stores that hold copies, or the retention policy says why it does not. This aligns with GDPR erasure expectations (not researched here).
- Retrieval from KBs and memory must respect the caller's permissions (permission-aware retrieval). Otherwise `search_knowledge` becomes a cross-team leakage path.

### Gaps
- I found no vendor-neutral primary standard for memory provenance schemas. The schema above is an inference.
- I did not retrieve the official OWASP ASI06 entry text or its listed mitigations.

---

## 6. Observability

### Takeaway
Use the OpenTelemetry GenAI semantic conventions: `invoke_agent` / `execute_tool` / `chat` spans with `gen_ai.*` attributes. Every run should be reconstructable: agent id + version, model/provider, prompt/instructions hash, tools and arguments, tokens, cost, latency, guardrail verdicts, outcome. Message content is **opt-in** because it is sensitive. Store it by reference and redact or limit access, with defined retention.

### Cited Findings
- The GenAI semconv moved to a dedicated repo ([open-telemetry/semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai)).
- Agent spans:
  - `create_agent {gen_ai.agent.name}` (CLIENT)
  - `invoke_agent {gen_ai.agent.name}`: CLIENT for remote agents such as Bedrock Agents or OpenAI Assistants, INTERNAL for in-process frameworks
- Attributes:
  - **Required**: `gen_ai.operation.name` and `gen_ai.provider.name`.
  - **Conditionally required**: `gen_ai.agent.id` (a stable provider-assigned id, not a transient one), `gen_ai.agent.name`, `gen_ai.agent.version`, `gen_ai.agent.description`, and `gen_ai.conversation.id` (must not be synthesized from a trace ID or hash).
  - **Request/response**: `gen_ai.request.model`, temperature/top_p/max_tokens/seed, `gen_ai.response.finish_reasons` (report `error` for failures).
  - **Usage**: `gen_ai.usage.input_tokens` (includes cached), `gen_ai.usage.output_tokens` (includes reasoning).
  - **Errors**: `error.type`.
  - **Opt-in sensitive content**: `gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.system_instructions`, `gen_ai.tool.definitions`, each with **`_ref` URI variants for external storage**.
- **Stability**: `gen_ai.*` attributes are still **Development** status. Only `error.type` and `server.*` are stable.

[fetched; tool-span section truncated] — [OTel GenAI agent spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md)
- The `execute_tool {gen_ai.tool.name}` span carries `gen_ai.tool.name`, `gen_ai.tool.call.id` and `gen_ai.tool.type`, and has opt-in tool-call argument and result attributes. [not verified: this part of the page was truncated and not read] — [OTel GenAI spans](https://github.com/open-telemetry/semantic-conventions-genai)
- The OpenAI Agents SDK tripwire exceptions carry `guardrail_result` and `run_data`, so guardrail verdicts can be attached to traces. [fetched] — [OpenAI Agents SDK, Guardrails](https://openai.github.io/openai-agents-python/guardrails/)
- OWASP LLM08 mitigation includes keeping detailed, immutable logs of retrieval activity. [not re-fetched] — [OWASP LLM08:2025](https://genai.owasp.org/llmrisk/llm082025-vector-and-embedding-weaknesses/)
- Tools (not re-fetched; capability summaries from prior knowledge):
  - **Langfuse**: open source, OTel-compatible tracing, scores, datasets, prompt versioning. [docs](https://langfuse.com/docs)
  - **LangSmith**: tracing, annotation queues, online evaluators, datasets. [docs](https://docs.smith.langchain.com/)
  - **Arize Phoenix / AX**: OpenInference/OTel tracing and evals. [docs](https://arize.com/docs/phoenix)
  - **Datadog LLM Observability**: traces, token/cost, evaluations, sensitive-data scanning. [docs](https://docs.datadoghq.com/llm_observability/)

### Inferences
- Minimum per-run record for ALOFT (one root `invoke_agent` span per run):
  - `gen_ai.agent.id`, `gen_ai.agent.version` (an immutable published agent version)
  - `gen_ai.conversation.id`, surface (chat|automation), `automation_id`
  - calling user id and the **effective data identity** (user OBO vs SP)
  - provider/model per call, plus any fallback events
  - hash of system instructions and memory snapshot (with content stored by `_ref` in an access-controlled store)
  - each tool call: name, args (the SQL text), tables touched, row count, bytes, duration, error
  - KB chunk ids retrieved
  - guardrail verdicts and scores (prompt-attack, PII, grounding/relevance)
  - tokens in/out/cached, computed USD cost, latency (TTFT, total)
  - finish reason, outcome (success | tripwire | limit_exceeded | error | human_rejected)
  - user feedback linked by run id
- PII in logs: SQL result rows and prompts may contain PII. Store content separately from metrics, mask it with the same sensitive-info filter, restrict access by role, and set shorter retention for content than for metadata. Pin to a semconv version, because `gen_ai.*` is still Development and names have changed (e.g., the move to `gen_ai.provider.name`).
- Trace replay: with versioned agent config + the instructions hash + recorded tool results, a run can be replayed deterministically against a new model or prompt version. That is the bridge to the evals in section 7.

### Gaps
- The `execute_tool` and workflow span details were in the truncated portion of the OTel page. Verify the attribute names, especially the tool argument/result attributes and the provider enum values (e.g., `aws.bedrock`, `azure.ai.openai`, `x_ai`).
- I did not compare tool features or pricing (Langfuse, LangSmith, Arize, Datadog) against current docs this session.

---

## 7. Feedback and continuous improvement; incident response

### Takeaway
Close the loop:
- capture explicit feedback (thumbs plus a reason or correction) and implicit signals (tripwires, retries, abandonment) linked to trace ids
- triage into labeled datasets, turn failures into regression eval cases that gate new agent versions
- run online evaluators (grounding, policy) on sampled production traffic
- alert on quality, cost and latency drift
- keep a per-agent kill switch and version rollback

### Cited Findings
- Anthropic's harness pattern makes verification explicit: a feature list with pass/fail status that agents cannot edit except to flip `passes`, plus mandatory end-to-end testing. Agents left to self-assess marked work done prematurely. [fetched] — [Anthropic, Effective harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- Bedrock guardrail filters support `action: NONE` (detect and return information without blocking). This allows shadow evaluation of a new guardrail policy on live traffic before enforcement, and the docs advise re-testing thresholds on your own data before changing tiers. [fetched] — [AWS contextual grounding](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-contextual-grounding-check.html)
- Guardrails are versioned: you create a version of a guardrail and reference it by ID and version at inference. Policy changes are releasable artifacts. [fetched] — [AWS Bedrock Guardrails](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails.html)
- Microsoft's response pattern to an exfiltration report was to block the **technique class**, not only the single prompt, "including variants". [fetched] — [MSRC blog](https://www.microsoft.com/en-us/msrc/blog/2025/07/how-microsoft-defends-against-indirect-prompt-injection-attacks)
- The Claude Agent SDK allows changing the permission mode mid-session (`setPermissionMode`), and deny rules and hooks apply in every mode. This is a mechanism for a runtime clamp-down. [fetched] — [Claude Agent SDK permissions](https://code.claude.com/docs/en/agent-sdk/permissions)
- NIST AI 600-1 (Generative AI Profile, Jul 2024) suggests actions including post-deployment monitoring, collecting user feedback, incident tracking and disclosure, and red-teaming across its GenAI risks (e.g., confabulation, information security, data privacy). [not re-fetched] — [NIST AI 600-1](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf)

### Inferences
- **Feedback schema**: `run_id`, rating (+1/-1), reason category (wrong data, wrong table, hallucinated number, missing citation, unsafe, too slow), free-text correction, the corrected SQL or answer (optional), and the reviewer.
- **Pipeline**:
  1. Negative feedback and tripwire runs go to a triage queue.
  2. Confirmed failures become eval cases: input, expected tables/SQL properties, expected answer facts, and must-not behaviors.
  3. Each agent version must pass its regression set (plus shared red-team/injection cases) before publishing.
- **Online evals**: sample N% of runs for LLM-judge grounding and citation checks (or reuse the Bedrock grounding scores). Track per-agent rates of tripwires, empty results, SQL errors, thumbs-down and cost per run. Alert when they deviate from the baseline.
- **Kill switch**: a per-agent `status` (active | read-only | suspended) checked by the harness at run start **and before each tool call**, so an in-flight automation stops. Add a per-tool disable and a global "all automations pause". Roll back by re-pointing to a prior immutable agent version. Each incident needs a record linked to its traces.

### Gaps
- I fetched no primary source on specific vendor feedback-to-dataset workflows (LangSmith annotation queues, Langfuse datasets).
- I found no authoritative guidance on sampling rates or alert thresholds for online evals.

---

## 8. Governance frameworks touching runtime (brief)

### Takeaway
The frameworks converge on the same runtime obligations: automatic event logging over the system's lifetime, human oversight with the ability to intervene or stop, post-deployment monitoring, and incident handling. ALOFT's harness logs and kill switch are the technical evidence for these. Most ALOFT data-analysis agents are unlikely to be EU "high-risk", but enterprise customers will ask for equivalent controls.

### Cited Findings
- **EU AI Act Art. 12**: high-risk AI systems "shall technically allow for the automatic recording of events (logs) over the lifetime of the system". Logs must support identifying risk situations or substantial modifications, post-market monitoring (Art. 72), and deployer monitoring (Art. 26(5)). The page states the obligations apply from **2 Dec 2027** (Annex III) and **2 Aug 2028** (Annex I) under Art. 113(c). [fetched] — [AI Act Art. 12](https://artificialintelligenceact.eu/article/12/)
  - Note on dates: the originally enacted application date for Annex III high-risk obligations was 2 Aug 2026. The later dates on the fetched page appear to reflect the 2025-2026 "Digital Omnibus" postponement. Verify against the current consolidated text. [not re-fetched] — [AI Act Art. 113](https://artificialintelligenceact.eu/article/113/)
- **EU AI Act Art. 14** (human oversight): people overseeing the system must be able to understand its limits, stay aware of automation bias, override or disregard outputs, and **interrupt the system via a "stop" button or similar procedure**. **Art. 19 / Art. 26(6)**: providers and deployers keep automatically generated logs for **at least six months** unless other law says otherwise. [not re-fetched] — [AI Act Art. 14](https://artificialintelligenceact.eu/article/14/); [Art. 26](https://artificialintelligenceact.eu/article/26/)
- **NIST AI 600-1** (26 Jul 2024) is a cross-sector GenAI profile of the AI RMF (Govern/Map/Measure/Manage). It lists 12 GenAI risks (including confabulation, data privacy, information security, information integrity) with suggested actions such as monitoring, logging, incident disclosure and content provenance. [not re-fetched] — [NIST AI 600-1](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf)
- **ISO/IEC 42001:2023**: a certifiable AI management system standard covering AI policy, risk and impact assessment, lifecycle controls, monitoring and continual improvement (Annex A controls). [not re-fetched] — [ISO/IEC 42001](https://www.iso.org/standard/81230.html)

### Inferences
- Mapping to harness features:
  - Art. 12 / NIST "Measure/Manage" → immutable run logs (section 6) with retention ≥ 6 months for metadata.
  - Art. 14 → HITL approvals plus a kill switch and stop on automations (section 7).
  - ISO 42001 → agent registry with owner, purpose, risk assessment and version history (the declared manifest in section 1).

### Gaps
- Articles 14, 19, 26 and 113, NIST AI 600-1 and ISO 42001 were not re-fetched this session. Verify the exact obligations and dates, especially the Digital Omnibus changes to the application dates.
- Whether any ALOFT use case falls under Annex III (e.g., employment or credit decisions over HR/finance data) was not assessed.
