# Durable runtime and run control for long-running, interruptible, human-in-the-loop agents (2024–2026)

Scope note: research done 2026-11-04 against primary docs where reachable. The product context is Next.js 16 on AWS (ECS/Elastic Beanstalk, Postgres/Prisma). Today the agent loop runs inside one streaming HTTP request, and ADR-003 proposes a Postgres-leased worker. Claims not verified in this session are listed under Gaps and are not stated as fact.

## 1. Durable execution frameworks for agents (Temporal, Inngest, Restate, Step Functions, DBOS, Trigger.dev, Vercel Workflow)

### Takeaway
All mature options use the same core idea. Each LLM call and each tool call becomes a recorded "step" (activity, `step.run`, `ctx.run`, `"use step"`) whose result is journaled. After a crash the orchestrating code is replayed and returns the recorded results instead of calling the model again. The options differ in where the journal lives. Temporal, Restate and Trigger.dev run a separate server or cloud. Inngest is a hosted service. DBOS and Vercel Workflow run in-process, with DBOS on your own Postgres. For a Node/Postgres stack, DBOS (library on existing Postgres) and Temporal's TypeScript AI SDK plugin are the most directly relevant TypeScript-first options. Vercel Workflow/WorkflowAgent is the closest fit to the AI SDK and Next.js, but how well it works self-hosted on AWS was not confirmed.

### Cited Findings
**Temporal**
- The Temporal + OpenAI Agents SDK integration was announced as Public Preview on July 30, 2025 and updated to "Generally Available" as of March 23, 2026. It runs "every agent invocation" as a Temporal Activity. Temporal retries failed downstream requests, waits out rate limits, and resumes after crashes from stored Activity results. — [Temporal blog](https://temporal.io/blog/announcing-openai-agents-sdk-integration)
- That OpenAI Agents integration post covers only the **Python** SDK. It does not say a TypeScript version of the OpenAI Agents integration exists. — [Temporal blog](https://temporal.io/blog/announcing-openai-agents-sdk-integration)
- For human-in-the-loop, Temporal describes Updates as the way to inject control and data into a running Workflow and Queries as the way to read data out. — [Temporal blog](https://temporal.io/blog/announcing-openai-agents-sdk-integration)
- **TypeScript:** Temporal has an official Vercel AI SDK integration (`@temporalio/ai-sdk`, with an `AiSdkPlugin` registered on the Worker). You call AI SDK APIs directly in Workflow code. The LLM invocation is wrapped as an Activity, so it is retried and tracked. Tool functions run in Workflow context and must follow Workflow determinism rules; in the cookbook, tools are implemented as Activities. A built-in stateless MCP client is provided. Model calls and tool calls appear in the Temporal UI Event History. A blog walkthrough was published in January 2026. — [Temporal docs: AI SDK integration](https://docs.temporal.io/develop/typescript/integrations/ai-sdk); [Temporal AI cookbook](https://docs.temporal.io/ai/cookbook/ai-sdk-by-vercel-typescript); [Temporal blog](https://temporal.io/blog/building-durable-agents-with-temporal-and-ai-sdk-by-vercel)

**Inngest / AgentKit**
- AgentKit "Human in the Loop" tools are built on Inngest's `step.waitForEvent()`, so the AgentKit network must run inside an Inngest function. The docs' example waits for a developer reply event, with a timeout and a match on ticket ID, and returns the reply as the tool result. — [AgentKit docs: Human in the Loop](https://agentkit.inngest.com/advanced-patterns/human-in-the-loop)
- Progress is pushed to the UI with `step.realtime.publish` between steps, or `inngest.realtime.publish` inside a `step.run`. This comes from a community skill guide, not primary docs. — [community skill summary](https://skillselion.com/skills/inngest/inngest-skills/inngest-agents)

**Restate**
- Restate journals LLM inference and tool calls as durable steps. On a crash, retries "bring the agent back to the last completed step before the crash." Restate sits in front of the agent process and handles failure detection, retries, concurrency control and idempotency. It integrates with the Vercel AI SDK through model middleware and tools that call `ctx.run`. (June 19, 2025) — [Restate blog](https://www.restate.dev/blog/durable-ai-loops-fault-tolerance-across-frameworks-and-without-handcuffs)
- Human-in-the-loop works by awaiting a durable promise that an external approval resolves. While it waits, the agent can be suspended, so serverless users pay only for active work. Virtual Objects keyed by session or user ID queue interactions and hold transactional state such as message history, which gives one active run per session. — [Restate blog](https://www.restate.dev/blog/durable-ai-loops-fault-tolerance-across-frameworks-and-without-handcuffs)
- Stated limitation: parallel tool calls are not supported out of the box, because replay must be deterministic. Restate recommends promise combinators or wrapping the calls in a single tool. — [Restate blog](https://www.restate.dev/blog/durable-ai-loops-fault-tolerance-across-frameworks-and-without-handcuffs)
- Deployment can be self-hosted or Restate Cloud, scaling from a laptop to a multi-zone cluster. — [Restate blog](https://www.restate.dev/blog/durable-ai-loops-fault-tolerance-across-frameworks-and-without-handcuffs)

**DBOS**
- DBOS Transact is an open-source TypeScript library that runs inside your application and uses Postgres as its only backend, with no separate orchestration server. Functions are annotated with `@DBOS.workflow()` and `@DBOS.step()`, and every step is checkpointed to Postgres so a crashed workflow resumes after its last completed step. — [DBOS Transact](https://dbos.dev/dbos-transact); [DBOS TS v2.0 announcement](https://dbos.dev/blog/dbos-transact-v2-typescript)
- A Vercel AI SDK integration (`@dbos-inc/vercel-ai`) reportedly wraps the model so each call becomes a checkpointed step. This comes from secondary sources and was not confirmed in primary docs. — [third-party article](https://ecorpit.com/dbos-durable-workflows-ai-agents-postgres-temporal-alternative-2026/)
- Caveat from one integrator: the Helix Agents runtime built on DBOS restarts a fresh workflow that re-runs the agent loop from message history, rather than restoring mid-step. In practice, resume quality depends on how the agent loop is split into steps. — [Helix runtime-dbos docs](https://agents.open-source.onhelix.ai/reference/runtime-dbos.html)

**Trigger.dev**
- v4 offers "waitpoints" for human-in-the-loop (`wait.forToken()` / `wait.completeToken()`), a Realtime API with React hooks for streaming LLM output, and, in v4.4.2, "input streams" for two-way communication with running tasks, aimed at approval UIs and chat. It can be self-hosted with Docker Compose or Helm. These findings come from repository mirrors and PRs, not the official docs. — [Trigger.dev repo mirror/README](https://github.com/berioxqc/trigger.dev); [PR #2432](https://github.com/triggerdotdev/trigger.dev/pull/2432/files)
- A PostgreSQL MVCC race in Trigger.dev's waitpoint system was fixed. Creating a waitpoint at the same moment the token was completed could leave a run blocked. This is a concrete example of the kind of bug a home-built Postgres approval wait can hit. — [Trigger.dev repo mirror](https://github.com/berioxqc/trigger.dev)

**Vercel Workflow (Workflow DevKit / Workflow SDK)**
- `'use workflow'` marks the orchestrating function, which is re-run on recovery and reuses recorded step results. `'use step'` marks a function whose result is persisted. `WorkflowAgent` connects the AI SDK agent loop to durable execution, and "Recovery boundaries belong inside that loop, around model calls and external tool operations." (Vercel KB, October 15, 2026) — [Vercel KB: durable AI agents](https://vercel.com/kb/guide/durable-ai-agents)
- Wrapping the whole agent loop in one step records nothing until the loop finishes, so an interruption repeats the entire loop. Pass serializable IDs between steps and create DB connections and SDK clients inside steps. — [Vercel KB](https://vercel.com/kb/guide/durable-ai-agents)
- The DevKit is event-sourced (replay, so workflow code must be deterministic). Next.js integrates through `withWorkflow` in the Next config. These details come from third-party skill pages. — [skillselion](https://skillselion.com/skills/vercel/vercel-plugin/workflow); [mcp.directory](https://mcp.directory/skills/workflow)
- AI SDK `WorkflowAgent` has no default step limit, while `ToolLoopAgent` defaults to `isStepCount(20)`. — [AI SDK loop control](https://ai-sdk.dev/docs/agents/loop-control)

**AWS**
- Bedrock AgentCore Runtime supports real-time work and long-running workloads of up to 8 hours, with a dedicated guide for asynchronous and long-running agents. Pricing is consumption-based, and CPU billing "typically eliminat[es] charges during I/O wait periods" such as waiting on LLM responses. — [AWS AgentCore Runtime docs](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agents-tools-runtime.html)
- A third-party source (May 2026) lists about $0.0895 per vCPU-hour (active CPU only) and about $0.00945 per GB-hour of memory, billed on peak footprint for the whole session. Idle long sessions therefore still accrue memory cost. These figures are not confirmed against the AWS pricing page. — [Cloudburn](https://cloudburn.io/blog/amazon-bedrock-agentcore-pricing)

### Inferences
- **Fit ranking for this stack (Node, Postgres, AWS, Next.js 16):**
  1. DBOS: in-process library on the existing Postgres, the smallest operational change from ADR-003's leased worker.
  2. Temporal: the most mature, with an official TS AI SDK plugin. Cost: running a Temporal cluster or paying for Temporal Cloud, plus Workflow determinism discipline.
  3. Restate: TS-first, with good session semantics through Virtual Objects. Cost: a separate server.
  4. Inngest and Trigger.dev: good developer experience, with built-in realtime and wait-for-event or token. Both are SaaS-first, and Trigger.dev can be self-hosted.
  5. Vercel Workflow: the best fit with the AI SDK. Unclear off Vercel.
  6. AgentCore Runtime: managed compute for long sessions, but not a step journal by itself.
- Whatever the engine, the step boundary must be **per model call and per tool call**. This is the single most important design rule shared by the Vercel, Temporal, Restate and DBOS docs.
- Replay-based engines (Temporal, Restate, Vercel Workflow) require deterministic orchestration code. Agent loops are naturally nondeterministic, so all nondeterminism (LLM output, clock, random, I/O) must live inside steps.

### Gaps
- Current pricing for Temporal Cloud, Inngest, Trigger.dev Cloud, Restate Cloud and DBOS Cloud was not retrieved. Licences were not verified in this session either: from training knowledge, Temporal and Trigger.dev are MIT/Apache, Restate is BSL, DBOS Transact is MIT, and Inngest's server is SSPL-style. All of these need checking.
- AWS Step Functions (callback pattern with task tokens, Express vs Standard pricing) and Bedrock Agents "return of control" were not researched in this session.
- Self-hosting Vercel Workflow outside Vercel (for example a Postgres-backed "World") and its maturity were not confirmed.
- AgentKit's `useAgent` hook was not verified against primary docs.

## 2. Agent frameworks' persistence and interrupt models

### Takeaway
The frameworks converge on one model. A run pauses at a tool-approval or `interrupt()` point, serializes its state (checkpoint or `RunState`), returns pending interruptions to the caller, and is resumed later with a decision. LangGraph needs a checkpointer and `thread_id`, and re-executes the interrupted node from the start. OpenAI Agents JS serializes `RunState` with `toString()`/`fromString()`. The Claude Agent SDK provides a persistent streaming session with hooks, permission modes, queued messages and interrupts. The AI SDK has `stopWhen`/`prepareStep` loop control, `needsApproval`, and opt-in durability through `WorkflowAgent`.

### Cited Findings
**LangGraph (JS)**
- `interrupt(value)` suspends the graph and returns `value` under `__interrupt__`. You resume with `new Command({ resume })`, and the resume value becomes the return value of `interrupt()`. A checkpointer is required (a durable one for production) along with a `thread_id`. Payloads must be JSON-serializable. — [LangGraph JS interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- **On resume the node restarts from the beginning.** Side effects before `interrupt()` must be idempotent or moved after it or into a separate node. Interrupt calls must be deterministic in order and count, because matching is index-based. Do not wrap `interrupt()` in a bare try/catch. — [LangGraph JS interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- Parallel branches can each interrupt and are resumed together with a map from interrupt ID to value. Static `interruptBefore`/`interruptAfter` are documented as debugging tools, not for HITL. Tool-level approval works by calling `interrupt()` inside a tool, and the reviewer can edit arguments or cancel. Optional `responseSchema` (≥1.4.16) validates resume input with Zod. — [LangGraph JS interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)

**OpenAI Agents SDK (JS)**
- A tool sets `needsApproval: true` or an async predicate on its arguments. When approval is pending, the tool does not run. A `RunToolApprovalItem` is returned in `result.interruptions`, including from nested `agent.asTool()` runs. — [OpenAI Agents JS: Human-in-the-loop](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/)
- Decisions use `result.state.approve(item)` or `result.state.reject(item, {message})`. `alwaysApprove`/`alwaysReject` make the decision sticky for the rest of the run. Partial resolution is allowed, and unresolved items pause the run again. Resume with `run(agent, state)`. — [OpenAI Agents JS: HITL](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/)
- Persistence: `result.state.toString()` saves state and `RunState.fromString(agent, serialized)` restores it with the same root agent graph. For long pauses, keep snapshots in server storage. `RunState.fromString()` "does not authenticate the snapshot", so the app must verify integrity, authorize the reviewer, prevent replay, and atomically consume each pending request before resuming. Long pauses across agent versions may require running two SDK versions side by side. — [OpenAI Agents JS: HITL](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/)
- The SDK exposes `MaxTurnsExceededError` and has Guides for Guardrails, Sessions, Streaming and Tracing. Their contents were not read here. — [OpenAI Agents JS docs index](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/)

**Claude Agent SDK**
- Streaming input mode is "the preferred way". It runs as a long-lived process that "takes in user input, handles interruptions, surfaces permission requests, and handles session management", and supports **queued messages** that "process sequentially, with ability to interrupt". The prompt is an `AsyncGenerator<SDKUserMessage>`, so the host can yield new user messages while the agent is running. — [Claude Agent SDK: Streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)
- Single-message mode does **not** support dynamic message queueing or real-time interruption. It is meant for stateless environments such as Lambda, and continues a conversation with `continue: true`. It throws after error results such as `error_max_turns`. `maxTurns` is an option. — [Claude Agent SDK: Streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)
- Permission mode can be changed mid-session with `setPermissionMode()` (TS) or `set_permission_mode()` (Py), and takes effect for later tool requests ("start restrictive and loosen permissions as trust builds"). — [Claude Agent SDK: Permissions](https://code.claude.com/docs/en/agent-sdk/permissions)
- Subagents inherit `plan`, `acceptEdits`, `auto` or `bypassPermissions` from the main session. A plan-mode parent keeps subagents in plan mode, and `bypassPermissions` is never applied from a subagent definition. — [Claude Agent SDK: Permissions](https://code.claude.com/docs/en/agent-sdk/permissions)

**Vercel AI SDK**
- Loop control: `stopWhen` takes one condition or an array, and the loop stops when any is met. Built-ins are `isStepCount(n)`, `hasToolCall(...names)` and `isLoopFinished()`. Custom `StopCondition`s are allowed, and the docs show a cost budget that stops when estimated cost from summed token usage exceeds $0.50. The loop also ends when "A tool call needs approval". — [AI SDK loop control](https://ai-sdk.dev/docs/agents/loop-control)
- `prepareStep` runs before each step and can switch the model, change settings, restrict `activeTools`/`toolChoice`, and prune or transform messages (`pruneMessages`) for context management. — [AI SDK loop control](https://ai-sdk.dev/docs/agents/loop-control)
- AI SDK 6 introduced human-in-the-loop tool approval through a single `needsApproval` flag. — [Vercel blog: AI SDK 6](https://vercel.com/blog/ai-sdk-6)
- Secondhand: AI SDK 7 is reported GA with opt-in durable, resumable agents through `WorkflowAgent` and HMAC-signed approval gates. Not verified in primary release notes. — [Noqta blog](https://noqta.tn/en/blog/vercel-ai-sdk-7-durable-agents-voice-developer-guide-2026)

### Inferences
- If the product keeps a home-grown loop, the OpenAI Agents JS `RunState` model is the best template for a "paused run" record: serialized state, a list of pending approvals with opaque IDs, server-side authorization, and atomic consumption. Its security guidance applies directly to an approval API in Next.js.
- LangGraph's "node re-executes on resume" rule is a general warning. Any resume that replays from the last checkpoint re-runs the code between that checkpoint and the pause, so side effects there must be idempotent.
- The Claude Agent SDK runs as a long-lived local process (the Claude Code CLI). It fits a dedicated worker container better than a request-scoped Next.js route.

### Gaps
- LangGraph Postgres checkpointer (`@langchain/langgraph-checkpoint-postgres`) and time-travel (`getStateHistory`, fork from checkpoint) were not fetched in this session.
- Claude Agent SDK sessions (`resume`, `forkSession`), the hooks reference, and options such as `maxBudgetUsd` were not fetched. Only streaming input and permissions pages were read.
- Mastra (workflows with suspend/resume, storage adapters) and Pydantic AI `UsageLimits` were not researched in this session.

## 3. Steering and interrupting a running agent; graceful stop; pause/resume

### Takeaway
Steering is implemented as a per-run **inbox (message queue)** that the loop drains at step boundaries, between model turns or after tool results. Stop is a separate **control signal**, not a closed HTTP connection. The Claude Agent SDK's streaming input (queued messages plus interrupt) and the AI SDK's explicit guidance that `stop()` only disconnects are the clearest primary statements of this.

### Cited Findings
- Claude Agent SDK streaming input supports queued user messages, processed sequentially, with the ability to interrupt. The generator can yield more messages while the agent runs. — [Claude Agent SDK: Streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)
- AI SDK resumable streams: "client-side aborts are treated as disconnects", and `stop()` "only closes the current HTTP connection". A real stop button must call a dedicated endpoint that **persists the partial response, cancels the work, and clears `activeStreamId`**. "Route cleanup is a disconnect, not an explicit stop." After a stop, avoid auto-reconnect "until the user sends another message or explicitly retries." — [AI SDK: resume streams](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams)
- AI SDK `prepareStep` runs before every step and can rewrite messages, tools and model. It is the natural hook point for injecting queued steering messages or forcing a final summary step, for example by removing all tools with `activeTools: []`. — [AI SDK loop control](https://ai-sdk.dev/docs/agents/loop-control)
- Temporal Updates inject control and data into a running workflow, and Queries read state out. — [Temporal blog](https://temporal.io/blog/announcing-openai-agents-sdk-integration)
- Restate Virtual Objects keyed by session ID have one instance per key that queues interactions. Callers can detach and reattach, and cancel. — [Restate blog](https://www.restate.dev/blog/durable-ai-loops-fault-tolerance-across-frameworks-and-without-handcuffs)
- Trigger.dev v4.4.2 "input streams" provide bidirectional communication with running tasks, for approval UIs and chat. — [PR #2432](https://github.com/triggerdotdev/trigger.dev/pull/2432/files)
- Pause/resume through durable waits: Inngest `step.waitForEvent()` with timeout ([AgentKit](https://agentkit.inngest.com/advanced-patterns/human-in-the-loop)), Restate durable promises with suspension ([Restate](https://www.restate.dev/blog/durable-ai-loops-fault-tolerance-across-frameworks-and-without-handcuffs)), Vercel `createHook` raced against `sleep('7d')` ([Vercel KB](https://vercel.com/kb/guide/durable-ai-agents)), and Trigger.dev `wait.forToken()` ([repo](https://github.com/berioxqc/trigger.dev)).

### Inferences
- Recommended control plane: a `run_control` row or `run_inbox` table per run, written by the API and checked by the worker before each model call. It holds `steer` messages (appended as user turns), `stop` (finish the current step, then run one tools-off "summarize progress" turn and mark the run `stopped`), `pause` (checkpoint and release the lease), and `cancel` (hard abort through `AbortSignal`, marking in-flight tool calls as unknown). The design follows from the primitives above. It was not described as a single pattern in any one source.
- A graceful stop that writes a summary should itself be budgeted (one turn, no tools) so a stop request cannot run away.

### Gaps
- No primary source documenting Claude Cowork's internal steering implementation was found or fetched.
- AbortSignal propagation semantics in the AI SDK (`abortSignal` on `generateText`/`streamText`) were not fetched.

## 4. Approval / permission models; idempotency and exactly-once tool calls after a crash

### Takeaway
Per-tool **allow / ask / deny** with an ordered evaluation (hooks, then deny, then ask, then mode, then allow, then interactive callback) is the most fully documented model, from the Claude Agent SDK. Durable engines give exactly-once **recording** of a step result, not exactly-once **side effects**. If a crash lands between the external call and the checkpoint, the step is retried, so side-effecting tools need idempotency keys derived from a stable step ID plus a business-level uniqueness constraint.

### Cited Findings
- Claude Agent SDK evaluation order: (1) hooks, which can deny; a hook `allow` does not skip later deny/ask rules. (2) Deny rules, which win even in `bypassPermissions`. (3) Ask rules, which go to `canUseTool` even in bypass mode. (4) Permission mode. (5) Allow rules. (6) The `canUseTool` callback. In `dontAsk` mode, step 6 is skipped and the call is denied. — [Claude Agent SDK: Permissions](https://code.claude.com/docs/en/agent-sdk/permissions)
- Modes: `default`, `dontAsk` (deny instead of prompting, for a fixed headless tool surface), `acceptEdits`, `bypassPermissions`, `plan` (no edits; edits always prompt), and `auto` (a model classifier approves or blocks actions). The TS SDK custom-tool `permission_policy` can be `always_ask` or `always_deny`. — [Claude Agent SDK: Permissions](https://code.claude.com/docs/en/agent-sdk/permissions)
- Pitfalls documented there: auto-approved calls never reach `canUseTool`, so checks placed there are silently bypassed. `allowedTools` does **not** constrain `bypassPermissions`. Use `PreToolUse` hooks for checks that must run on every call. — [Claude Agent SDK: Permissions](https://code.claude.com/docs/en/agent-sdk/permissions)
- OpenAI Agents JS: `needsApproval` can be a boolean or an argument-dependent predicate. Decisions can be sticky with `alwaysApprove`/`alwaysReject`. Rejections can carry a message back to the model. The server should validate decisions against stored pending requests and consume each one atomically. — [OpenAI Agents JS: HITL](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/)
- LangGraph: an approval inside a tool can let the reviewer edit the arguments or cancel the call. — [LangGraph JS interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- Vercel durable agents: send an `Idempotency-Key` derived from the **step ID**, which stays stable across retries of the same invocation. Use a business identifier or DB uniqueness constraint to prevent duplicates across runs. Reads are safe to repeat, while publishing, charging or appending need deduplication. For approvals, register the hook with `createHook` and check `getConflict()` before sending the approval request, race it against a durable deadline, and resume with `resumeHook()` only after server-side confirmation of the reviewer's permission. — [Vercel KB: durable AI agents](https://vercel.com/kb/guide/durable-ai-agents)
- A single approved run "can span model inference, hours of human review, and days of side effects". — [Vercel KB: agent approval workflow](https://vercel.com/kb/guide/agent-approval-workflow-stack-guide.md)
- Restate lists idempotency among the concerns its runtime handles. — [Restate blog](https://www.restate.dev/blog/durable-ai-loops-fault-tolerance-across-frameworks-and-without-handcuffs)

### Inferences
- For the product: classify every tool as `read` / `write-idempotent` / `write-nonidempotent`. Give each tool call a `tool_call_id`, persisted *before* execution with status `started`, and pass it as the idempotency key to downstream systems. On recovery, a `started` call with no result is re-run only for read and idempotent tools. A non-idempotent one is surfaced to a human as "outcome unknown". This is the standard outbox/idempotency pattern applied to tool calls, combining the Vercel and LangGraph guidance.
- Approval records should be first-class rows (pending, approved, rejected, expired) with reviewer identity and argument snapshot, consumed atomically. OpenAI's guidance treats an unauthenticated serialized state as untrusted.

### Gaps
- No source here quantified how often duplicate side effects happen in practice.
- Bedrock Agents "return of control" (the client executes the action and returns the result) was not fetched.

## 5. Budgets and guardrails at runtime

### Takeaway
Frameworks expose budgets mostly as **turn/step caps** (`maxTurns`, `isStepCount`), with cost, token and time budgets left to custom stop conditions. The AI SDK documents a cost-budget `StopCondition` example. Loop detection and circuit breakers were not found as built-in, documented features in the sources reached.

### Cited Findings
- AI SDK: `ToolLoopAgent` defaults to `isStepCount(20)` "as a safeguard against runaway costs" and warns when that default cuts a loop off. `WorkflowAgent` has **no default limit**. A custom `StopCondition` example stops when estimated cost exceeds $0.50. — [AI SDK loop control](https://ai-sdk.dev/docs/agents/loop-control)
- The Vercel durable-agent example caps the loop at `isStepCount(8)`. — [Vercel KB](https://vercel.com/kb/guide/durable-ai-agents)
- Claude Agent SDK has a `maxTurns` option, and an exhausted run ends with result subtype `error_max_turns`. — [Claude Agent SDK: Streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)
- OpenAI Agents JS exposes `MaxTurnsExceededError` and has a Guardrails guide. — [OpenAI Agents JS docs](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/)
- Durable waits should carry deadlines: Inngest `waitForEvent` with timeout ([AgentKit](https://agentkit.inngest.com/advanced-patterns/human-in-the-loop)), Vercel `sleep('7d')` race ([Vercel KB](https://vercel.com/kb/guide/durable-ai-agents)).
- Temporal "waits out rate limits" and retries downstream failures automatically. — [Temporal blog](https://temporal.io/blog/announcing-openai-agents-sdk-integration)

### Inferences
- Enforce budgets in the worker, not in the model loop library alone. Keep a per-run ledger of tokens, cost, wall-clock and tool calls, checked before each step: soft limit, then force a summary turn; hard limit, then stop. Combine this with a repeated-identical-tool-call detector (same tool and arguments N times), which is a cheap form of loop detection. The ALOFT platform spend ledger (recent commit) could back the cost dimension.
- Durable engines can retry forever by default, so per-step retry policies need max attempts. Otherwise a failing LLM provider turns into a budget leak.

### Gaps
- Pydantic AI `UsageLimits` (request/token limits) was not fetched. It is Python-only, so low priority for this stack.
- No primary source on built-in loop detection or circuit breakers in these frameworks was found.
- Claude Agent SDK `maxBudgetUsd` (if it exists in the current version) was not verified.

## 6. Streaming progress to UIs and reconnecting to a running task

### Takeaway
The documented pattern separates **generation** from the **HTTP connection**. The worker writes events to a durable log or pub/sub keyed by stream ID, the chat row stores `activeStreamId`, and clients reconnect with a GET that replays and tails the stream (204 if none is active). The AI SDK's `resumable-stream` needs Redis. A Postgres event table plus SSE achieves the same without Redis, with more polling or LISTEN/NOTIFY work.

### Cited Findings
- AI SDK resumable streams: the `resumable-stream` package handles publish/subscribe. A Redis instance "Stores stream data". Your DB "Tracks which stream ID is active for each chat". The POST handler saves `activeStreamId` and `onEnd` clears it. `useChat({ resume: true })` reconnects on mount and after network-drop visibility changes. `GET /api/chat/[id]/stream` returns 204 if nothing is active. Streams expire in Redis after a configured TTL. Clear `activeStreamId` when starting a new stream to avoid races. Authenticate both creation and resumption. — [AI SDK: resume streams](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams)
- Inngest: `step.realtime.publish` / `inngest.realtime.publish` push progress from steps (community guide). — [skill summary](https://skillselion.com/skills/inngest/inngest-skills/inngest-agents)
- Trigger.dev: Realtime API to subscribe to run updates and stream LLM output, including a `useRealtimeStream` React hook. — [Trigger.dev repo mirror](https://github.com/berioxqc/trigger.dev)
- LangGraph streaming loops on `graph.streamEvents(..., { version: "v3" })` and checks `stream.interrupted`. — [LangGraph JS interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- Ably documents running a Vercel Workflow DevKit agent loop in Next.js with Ably as the streaming and control channel (vendor docs). — [Ably AI Transport](https://ably.com/docs/ai-transport/frameworks/vercel-wdk)
- The Temporal UI and Restate UI show each step or journal entry, which serves as an operator-facing progress view. — [Temporal docs](https://docs.temporal.io/develop/typescript/integrations/ai-sdk); [Restate blog](https://www.restate.dev/blog/durable-ai-loops-fault-tolerance-across-frameworks-and-without-handcuffs)

### Inferences
- For this AWS deployment: an append-only `run_events(run_id, seq, type, payload)` table in Postgres is the source of truth. SSE `GET /api/runs/:id/events?after=seq` replays from `seq` and then tails, using LISTEN/NOTIFY or short polling. The client stores its last `seq`, the SSE `Last-Event-ID` header. This gives reconnect, multi-tab and audit for free, and needs no Redis. Token-level deltas can be coalesced (for example every 100–250 ms) to limit row volume. The design is inferred from the AI SDK pattern and is not documented as such by a single source.
- ECS/EB load balancers and idle timeouts affect long SSE connections. Reconnect-by-`seq` makes those timeouts harmless.

### Gaps
- Benchmarks for Postgres-backed event logs versus Redis streams at token granularity were not found.
- `resumable-stream` versions that support non-Redis backends were not checked.

## 7. Build vs adopt: when a Postgres-leased custom worker is enough

### Takeaway
A Postgres-leased worker (ADR-003) can provide durability if it checkpoints **per model call and per tool call**, persists approvals and inbox messages as rows, and makes side-effecting tools idempotent. The hard parts are what durable engines provide out of the box: replay/resume semantics, durable timers and waits with deadlines, race-free wait/complete, retries with backoff, versioning of in-flight runs, and an operator UI. The trigger to adopt rather than build is the need for durable waits measured in days, complex fan-out, or many workflow types. DBOS is the lowest-friction way to "adopt" while staying on Postgres.

### Cited Findings
- DBOS markets durable execution with no extra infrastructure beyond Postgres: `npm install` plus decorators. — [DBOS Transact](https://dbos.dev/dbos-transact)
- Pitfall: a Postgres MVCC race in Trigger.dev's waitpoints, where a waitpoint was created concurrently with token completion, left runs blocked. Home-built "wait for approval" on Postgres can hit the same class of bug. — [Trigger.dev repo mirror](https://github.com/berioxqc/trigger.dev)
- Pitfall: wrapping the whole loop in one durable step gives no mid-loop recovery. — [Vercel KB](https://vercel.com/kb/guide/durable-ai-agents)
- Pitfall: on resume, code before the pause point is re-executed (LangGraph nodes). Non-idempotent side effects there duplicate. — [LangGraph JS interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- Pitfall: replay engines forbid naive parallel tool calls (Restate) or require deterministic workflow code (Temporal tools in Workflow context, Vercel event sourcing). — [Restate blog](https://www.restate.dev/blog/durable-ai-loops-fault-tolerance-across-frameworks-and-without-handcuffs); [Temporal docs](https://docs.temporal.io/develop/typescript/integrations/ai-sdk); [skillselion](https://skillselion.com/skills/vercel/vercel-plugin/workflow)
- Pitfall: long-paused runs face agent and SDK version drift. OpenAI notes possibly needing two SDK versions side by side. — [OpenAI Agents JS: HITL](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/)
- Pitfall: the Helix runtime on DBOS restarts the agent loop from message history rather than a mid-step checkpoint, so resume granularity depends on integration design. — [Helix runtime-dbos](https://agents.open-source.onhelix.ai/reference/runtime-dbos.html)
- Community advice: avoid "One giant setTimeout, cron polling, or Redis TTL as the human-review mechanism" and prefer a durable wait. — [community skill summary](https://skillselion.com/skills/inngest/inngest-skills/inngest-agents)

### Inferences
- **Custom leased worker is enough when:** there is a single workflow type (the agent loop), approvals are stored as rows and the run *ends* (status `awaiting_approval`, lease released) rather than holding a worker, resume is "load messages and state from Postgres, continue the loop", fan-out is minimal, and the team accepts building retries, lease heartbeats, stuck-run reapers, and an admin view. The minimal schema is `agent_runs` (status, lease_owner, lease_expires_at, version, budget counters), `agent_steps`/`tool_calls` (idempotency key, status, result), `run_events` (UI stream), `run_inbox` (steer/stop/pause), and `approvals`. Lease acquisition uses `SELECT … FOR UPDATE SKIP LOCKED`, with heartbeat renewal and fencing by an incrementing lease token so a zombie worker cannot write after losing its lease.
- **Adopt DBOS when:** you want the same Postgres-only footprint but with tested step checkpointing, workflow recovery, durable sleeps and queues, instead of hand-rolling them.
- **Adopt Temporal/Restate when:** there are many long-lived workflows, cross-service sagas, durable waits measured in days or weeks, strict versioning needs, or a desire for a mature operator UI, and the team accepts running a cluster or paying for a cloud service.
- **Adopt Inngest/Trigger.dev when:** a managed service with built-in realtime and HITL waits is acceptable and data residency or SaaS dependency is not a blocker.
- Whichever path is chosen, the agent loop should move **out of the Next.js request** into an ECS worker service. Next.js routes become thin: create a run, post to its inbox, approve, and SSE-tail its events.

### Gaps
- No independent, primary-source post-mortems of teams moving from a custom Postgres queue to Temporal/Inngest for agents were found in this session.
- The contents of ADR-003 were not reviewed as part of this external research.
