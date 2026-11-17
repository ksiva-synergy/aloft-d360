# Agent runtime plan: fix the loop, then make it one harness

**Status:** Proposed · **Date:** 2026-11-07 · **Owner:** TBD
**Builds on:** `reports/Agent loop research.md` and `research_notes/Agent loop research/*` (audit of 2026-11-04)
**Related:** ADR-003 (worker), ADR-004 (agent runtime, to be amended), `docs/business-ai-studio/11-cowork-style-work.md`, `docs/access/pii-protection-backlog.md`

## 1. Decision in one paragraph

Keep the ReAct-style tool loop. We are not changing the agent's reasoning paradigm. We are fixing the plumbing of the loop that every user-facing surface runs (`runFoundryAgentLoop`, Chat Completions against the LiteLLM gateway). We then collapse the three loop copies into one `runAgentTurn` harness and only after that add budgets, compaction and a plan tool behind an eval gate. Durable background runs (Phase 3) are a separate go/no-go decision tied to the Automate roadmap, not part of this commitment.

**Commitment asked for now:** Week 0 + Phase 0 (about 2.5 weeks, one engineer). Phase 1 is approved or not at the Phase 0 checkpoint, using measured numbers.

## 2. What this plan adds to the research report

The report's findings were re-checked against the current tree on 2026-11-07. They hold (line numbers have drifted slightly). These facts were found during planning and change scope or approach:

| # | Fact | Evidence | Consequence |
|---|---|---|---|
| F1 | The gateway is **LiteLLM** | ELB name `k8s-litellmg-litellmi-…` in `src/lib/llmlite/config.ts:11` | LiteLLM features below are available, subject to the gateway's version and config (probe in Week 0) |
| F2 | LiteLLM passes OpenAI-format `cache_control` through to Anthropic and converts it to Bedrock `cachePoint`. It reports `prompt_tokens_details.cached_tokens` and `cache_creation_input_tokens` | [LiteLLM prompt caching](https://docs.litellm.ai/docs/completion/prompt_caching) | Claude caching on the production path does **not** need a new provider path, only message changes. The loop hard-codes `cacheWriteTokens: 0` (`foundry-chat.ts:563`), so writes are currently invisible |
| F3 | LiteLLM returns `thinking_blocks` for Claude and requires them to be sent back with tool results (otherwise 400). It also accepts `reasoning_effort`. `reasoning_content` is returned for other providers but is plain text, not resumable state | [LiteLLM reasoning](https://docs.litellm.ai/docs/reasoning_content) | Claude-with-thinking through the existing Chat Completions loop is feasible. Grok's reasoning continuity is not, unless the gateway's `/v1/responses` keeps it (probe) |
| F4 | LiteLLM can return `x-litellm-response-cost` in response headers | [LiteLLM cost tracking](https://docs.litellm.ai/docs/proxy/cost_tracking) | Cost truth can come from the gateway instead of our price table. Unknown whether the header is present on **streamed** responses (probe) |
| F5 | Grok 4.7 via LiteLLM gets the **45 s** Azure stall timer, not the 180 s Grok timer | `foundry-chat.ts:114, 454` (`llmlite` takes this branch); the 180 s value applies only to `resource === 'xai'` (`:117, 226`) | Probable source of spurious "Azure deployment issue" timeouts on the default model. Quick Phase 0 fix |
| F6 | **Nine** call sites reach the loops, not three | `inspector/chat`, `agents/chat`, `flows/agent-try` (via `runCatalogAgent`), `workbench/chat`, `workbench/test-run`, `inspector/teach`, `semantic/.../blueprint`, `.../refine-item`, `flows-copilot/propose.ts`, `boost/runner.ts` | Phase 1 migration is staged per caller behind a flag. Minor callers move last |
| F7 | **No unit tests** exist for `agent-loop.ts` or `foundry-chat.ts` | `src/lib/inspector/__tests__/` has none; no `providers/__tests__` | Week 0 starts with characterization tests on a mocked stream before any edit |
| F8 | Eval tables exist (`PlatformEvalSuite/Case/Run/Result`) but **no runner executes cases**. The POST only inserts a `queued` row | `src/app/api/agent-lab/ops/evals/route.ts:28-48` | The golden-set runner (Phase 2) is new code, not wiring |
| F9 | Migrations for agent-ops tables are applied **by hand** (`prisma db execute` + `migrate resolve`) | header of `prisma/migrations/20261017_agent_turn_loop_log/migration.sql` | Schema additions (finish reason etc.) are batched into one migration per phase, and someone with DB rights applies it |
| F10 | ADR-004 (Proposed) puts a `ModelGateway` adapter over `dispatchAgentLoop` | `docs/business-ai-studio/adr/ADR-004-agent-runtime-and-model-routing.md` §Decision 1 | ADR-014 amends it: Studio's adapter wraps `runAgentTurn`. One loop serves Studio and chat |
| F11 | The PII backlog already flags "the SQL tool sends full raw results to the model" | `docs/access/pii-protection-backlog.md` | Result previews (P0-1) also cut PII exposure. Coordinate column masking with that backlog |

## 3. Goals and non-goals

**Goals (measurable at the end of Phase 1):**
- Every turn has a correct outcome label (`completed`, `truncated`, `aborted`, `errored`, `budget_exhausted`) and a cost row, including errored and aborted turns.
- No tool result above the per-tool cap enters model context.
- A turn that hits the loop cap returns a synthesised answer, never an empty one.
- On Claude via the gateway, `cache_read_tokens > 0` from loop 2 on at least 90% of multi-loop turns.
- Inspector, saved-agent chat and Try-it run one loop implementation with identical outcome and cost semantics.

**Non-goals for this plan:** a new planning paradigm; multi-agent orchestration; an agent framework dependency (ADR-004 rejected this); model routing; durable background runs (separate decision, §9).

## 4. Week 0: safety net and gateway probe (3–4 days)

Nothing in Phase 0 starts until these four items exist.

**W0-1 Characterization tests for `runFoundryAgentLoop` (1.5 d).** Use Vitest with an injected OpenAI client that replays canned stream chunks. Cover:
- text-only answer;
- one tool round;
- parallel tool calls;
- a tool that throws;
- malformed tool arguments;
- loop cap reached;
- `finish_reason: 'length'`;
- abort mid-stream.

Assert current behaviour first, including the bugs, so each fix shows up as a deliberate test change. This needs one small seam: `getFoundryClient` becomes injectable through params (default unchanged).

**W0-2 Gateway capability probe (1 d).** Write `scripts/probes/llmlite-capabilities.ts`, run locally by a developer with their own gateway credentials. It must never print keys, only booleans and token counts. It records, for Claude Sonnet 5, Grok 4.7 and GPT-6 Luna:

| Question | How |
|---|---|
| Does `cache_control` on a system content part produce `cache_creation_input_tokens` then `cached_tokens` on an identical second call? | Two calls with a system prompt above the minimum cacheable size |
| Does `prompt_cache_key` pass through and raise the Grok/GPT cache hit rate? | Same prefix, with and without the key |
| Are `thinking_blocks` returned with `reasoning_effort: 'medium'` on Claude, and does a tool round-trip with them succeed? Without them, is it a 400 or silently dropped (`modify_params`)? | Tool-call round trip |
| Does `/v1/responses` work for `aws_bedrock/xAI-Grok-4.7`, and does it return reasoning items that survive a tool round? | Responses call with `include: ['reasoning.encrypted_content']` |
| Is `x-litellm-response-cost` present on non-streamed responses? On streamed ones? | `.withResponse()` on both |
| Is `tool_choice: 'none'` accepted when history contains tool calls, per model? | Needed for the wrap-up turn |
| Which `finish_reason` values appear on length cut-off and on tool calls? | `max_tokens: 50` |

Output: a results table appended to this doc (§12) plus the gateway LiteLLM version if exposed. Every "depends on the gateway" item below is decided from this table.

**W0-3 Baseline (0.5 d).** Run read-only `SELECT`s over the last 14 days with a CLI OAuth profile. Never use the app service principal (`AGENTS.md`):

```sql
-- per model: turns, outcome mix, loops, peak context, cache ratio, tokens per turn
SELECT model, outcome, count(*) AS turns,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY loops)              AS p50_loops,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY peak_context_chars) AS p95_ctx_chars,
       sum(cache_read_tokens)::float / nullif(sum(input_tokens),0)       AS cache_read_ratio,
       avg(input_tokens) AS avg_in, avg(output_tokens) AS avg_out,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)         AS p95_ms
FROM agent_turn_log
WHERE started_at > now() - interval '14 days'
GROUP BY model, outcome ORDER BY turns DESC;

-- context growth by loop index (quadratic-growth check)
SELECT loop, avg(context_chars) AS avg_ctx, avg(input_tokens) AS avg_in, count(*)
FROM agent_loop_log WHERE started_at > now() - interval '14 days'
GROUP BY loop ORDER BY loop;
```

Also pull logged cost per turn from `agent_cost_log` for the same window, to compare later with gateway cost.

**W0-4 Capture one Inspector request body (0.25 d).** Use a local dev session to confirm or rule out the duplicated latest user message (`useInspectorChat.ts:285, 297-306`).

**Checkpoint:** baseline numbers and the probe table are written into §12. If the cache ratio for Claude is already high, or most turns are 1–2 loops, the expected savings shrink. Re-rank Phase 0 before starting.

## 5. Phase 0: stop the leaks (about 2 weeks)

Each ticket is one PR against a feature branch, with tests from W0-1 updated. Sizes: S < 2 d, M 2–5 d.

| ID | Change | Files | Size | Done when |
|---|---|---|---|---|
| **P0-1** | **SQL result previews.** The model gets columns and types, `row_count`, `truncated`, the first rows as CSV up to a char cap (env, default 8,000 chars and ≤100 rows), and a `result_id`. Full rows stay in `sessionQueryResults` / `studio_query_results` and the UI card. The prompt states that the person already sees the full table. `emit_chart` and `export_query_result` accept an optional `result_id` (fixes the same-batch race) | `inspector/tools.ts:440-467`, `prompts.ts` (LIMIT guidance), `answer-rules.ts` | M | No `execute_tool` content above the cap enters context (unit test). Chart with `result_id` picks the right result |
| **P0-2** | **Cost truth.** (a) Read `x-litellm-response-cost` where present (W0-2). (b) Otherwise add gateway ids to the price table, mapped explicitly (`aws_bedrock/Claude-Sonnet-5` etc.), and **log a warning instead of silently falling back to Sonnet**. (c) Cost errored and aborted Inspector turns. (d) Cache split for agents. (e) Real tool-call count instead of `loops - 1`. (f) Record cache writes from `cache_creation_input_tokens`. (g) Keep metrics for non-UUID sessions (use a synthetic id, not an early return) | `lifecycle/log-agent-cost.ts`, `inspector/chat/route.ts:560-600, 632, 697, 727-790`, `agents/run-catalog-agent.ts:345-372`, `agent-ops/record-turn-metrics.ts:41`, `foundry-chat.ts:500-505, 563` | S–M | Every turn in a 1-day sample has an `agent_cost_log` row. Logged cost is within 5% of gateway spend logs for the same requests, where the header is available |
| **P0-3** | **Stop reasons and wrap-up.** (a) Capture `finish_reason`. (b) On `length` with partial tool calls, don't execute; return "your tool call was cut off" and continue once. (c) On `length` with text, continue once, then label `truncated`. (d) Malformed JSON arguments return an explicit error to the model. (e) When the loop cap is reached, make one final call with `tool_choice: 'none'` (or an instruction plus discarding tool calls, if W0-2 shows `none` is rejected) that answers from gathered evidence. (f) Inspector replaces the canned footer with that answer plus a one-line "stopped at the step limit" note | `foundry-chat.ts:456-668`, `inspector/chat/route.ts:672-683`, `run-catalog-agent.ts:333-342` | S–M | Tests: a length cut-off is never `completed`; loop cap → non-empty `finalText` |
| **P0-4** | **Real Stop.** The route builds an `AbortController` from `request.signal`, passed as `signal` to the loop and combined with the stall timer (`AbortSignal.any`). Check abort inside the stream loop and before the tool batch. Add `'aborted'` to `AgentLoopResult.outcome`. Aborted turns skip bandit, CTSGV judge, memory attribution and scoring (`route.ts:615-671`), but are still costed. Keep the boolean flag as a compatibility shim for the callers not yet migrated | `agent-loop.ts:24-31, 100`, `foundry-chat.ts`, `inspector/chat/route.ts:332-335, 740`, `agents/chat/route.ts:165` | S | Test: abort mid-stream → no tools run, outcome `aborted`, cost row written |
| **P0-5** | **Timeouts and error text.** Gateway reasoning models get a first-token timeout (180 s) separate from the inter-chunk stall timeout (45 s). Replace the "Azure deployment issue… switch to Claude Sonnet, Grok 4.3" text with a message based on the actual resource. Tool errors tell the model whether retrying makes sense (`retryable`) | `foundry-chat.ts:114-130, 454, 669-683`, `inspector/tools.ts:421-478` | S | Spurious-timeout rate in `agent_turn_log.error` drops versus the W0-3 baseline |
| **P0-6** | **Hygiene.** Per-tool try/catch in the Bedrock loop. Fix the contradictory `SHOW CATALOGS` hint and the unknown-action enum. Dedupe the user message if W0-4 confirms it. Saved-agent chat persists the final answer, not concatenated narration (wire `onTextReplace`) | `agent-loop.ts:260-267`, `context/describe.ts:266-269`, `context/dispatch.ts:194-197`, `useInspectorChat.ts`, `agents/chat/route.ts:166-203` | S | Tests per item |
| **P0-7** | **Telemetry columns (one migration).** Add `finish_reason`, `provider_request_id`, `retry_count` and `cost_usd` to `agent_loop_log`, and `agent_id` and `agent_version` to `agent_turn_log`. Hand-applied per F9 | `prisma/migrations/2026xxxx_agent_loop_telemetry/`, `record-turn-metrics.ts` | S | Columns populated on new turns |

Deliberately **not** in Phase 0: the global `describe_schema` semaphore (needs Prisma pool sizing data first), the Bedrock static-key client (affects only minor surfaces), and history caps (Phase 2, behind evals).

**Phase 0 checkpoint (go/no-go for Phase 1).** Compare 7 days after deploy with the W0-3 baseline:
- median and p95 input tokens per multi-loop turn;
- outcome mix (how many former `completed` turns are now `truncated` or `aborted`);
- cost per turn by model with corrected pricing;
- spurious-timeout rate.

If input tokens fell sharply and the remaining cost is small, Phase 1's case rests on consolidation alone. That is still worth doing, but it can be scheduled against other work.

## 6. Phase 1: one harness, cache-first (about 3 weeks)

### 6.1 Shape

```
src/lib/agent-runtime/
  turn.ts            runAgentTurn(spec) → TurnResult   (the only loop)
  adapters/
    chat-completions.ts   LiteLLM / OpenAI-compatible (production)
    converse.ts           Bedrock Converse (blueprint, flows-copilot fallback)
    responses.ts          xAI direct, or gateway /v1/responses if W0-2 says yes
  tool-results.ts    result store, previews, result_id lookup (from P0-1)
  prompt-layout.ts   static prefix / dynamic context split, cache breakpoints per adapter
  cost.ts            cost meter (gateway header → price table)
  outcome.ts         single outcome mapping + post-run hook policy (which hooks run per outcome)
  history.ts         per-surface history policy (caps now, compaction in Phase 2)
  types.ts
```

An adapter does one thing: `step(request, signal) → { text, toolCalls, reasoningState, finishReason, usage, costUsd? }`. Abort, tool execution, wrap-up, metrics, outcome and persistence live once in `turn.ts`. `reasoningState` is opaque to the loop. It holds Claude `thinking_blocks` or Responses reasoning items, and the adapter puts it back on the next request unchanged.

`TurnSpec` carries: surface id, model, static system prompt, dynamic context blocks, history, tool registry, `RunLimits` (`maxSteps` now; USD, tokens and time in Phase 2), `signal`, event sink and persistence hooks. This is the `RunLimits` unification that `04-harness-skills-reasoning.md` §2 already proposes.

### 6.2 Cache-first prompt layout

- **Order:** tools → static system (base prompt, answer rules, chart DSL schema) → **breakpoint 1** → dynamic context (semantic section, insights, session knowledge, memory) as a separate system part or leading context message → history → **breakpoint 2, moved to the last message each loop**. Anthropic allows four breakpoints; we use two.
- Claude via the gateway: `cache_control: { type: 'ephemeral' }` on those content parts (F2).
- Grok/GPT: rely on automatic prefix caching, plus a per-session `prompt_cache_key` if W0-2 shows it passes through.
- Cap PRIOR ANALYSIS INSIGHTS (`prompts.ts:458-483`): latest N, char cap. This is the one history change that cannot wait, because it is uncapped and sits in every request.

### 6.3 Reasoning continuity (decided from W0-2)

| W0-2 result | Action |
|---|---|
| Gateway `/v1/responses` keeps Grok reasoning across tool rounds | Grok goes through `responses.ts` via the gateway. Default model unchanged |
| It doesn't, and Claude `thinking_blocks` round-trip works | Offer Claude Sonnet 5 with `reasoning_effort` as a reasoning-preserving option. **Change the default only if the Phase 2 golden set shows it is better per dollar.** Until then the default stays Grok, with the known limitation recorded |
| Neither works | Keep Chat Completions. Mitigate with P0-1 (smaller context) and, in Phase 2, `update_plan` (the plan carries intent across rounds) |

### 6.4 Migration order (flag `AGENT_RUNTIME_V2`, per surface)

1. Inspector chat (highest traffic; most of Phase 0 already lives here).
2. `runCatalogAgent`, which moves saved-agent chat and Automate Try together.
3. Workbench chat and test-run.
4. Teach, boost runner, flows-copilot, semantic blueprint and refine-item.
5. Delete `runFoundryAgentLoop`, `runXaiResponsesLoop` and `runAgentLoop` after two weeks with no fallbacks used.

There is no shadow mode, because running a turn twice would also run live warehouse SQL twice. Roll out by environment, then by role, with the flag as instant rollback.

### 6.5 ADR-014

Write `docs/business-ai-studio/adr/ADR-014-single-agent-turn-harness.md`. It decides that one `runAgentTurn` serves chat, saved agents, Automate and Studio, and it amends ADR-004 Decision 1 (the `ModelGateway` adapter wraps `runAgentTurn`).

**Phase 1 exit:**
- The same golden question on Inspector and on saved-agent chat gives the same outcome label and cost formula.
- The cache-read criterion from §3 holds.
- All nine call sites are migrated or explicitly listed as remaining.
- The three old loop functions are deleted.

## 7. Phase 2: evals first, then budgets, compaction and plan (about 4 weeks)

**P2-1 Loop golden set and runner (first, M).**
- 30–50 cases drawn from real Inspector and agent traces, including at least 8 long multi-step tasks.
- Each case stores the question, reference SQL, expected tables, numeric tolerance and required citations.
- **Execution match is computed by running the reference SQL at eval time.** This avoids maintaining a pinned warehouse snapshot. Drift affects both sides equally; cases on fast-moving tables use tolerances.
- Each case runs k = 3 times through `runAgentTurn` with the real surface spec. Results go to the existing `PlatformEval*` tables (F8).
- Report pass^3, cost per **successful** task, steps, cache ratio, p95 latency, budget-exhaustion rate and repetition events.
- Rough cost: 40 × 3 runs × ~$0.10 ≈ $12 per run. This is an estimate; replace it with Phase 0 numbers.
- **Gate:** CI has no warehouse credentials, so the gate is a required run (manual or nightly) whose result is linked in every PR that touches `src/lib/agent-runtime/`. Merges are blocked by review rule when pass^3 regresses.

Then, each behind the gate:

| ID | Change | Size |
|---|---|---|
| P2-2 | Running budget ledger (USD, tokens, wall time, tool calls) checked before each step. Soft limit → tools-off wrap-up; hard limit → `budget_exhausted` with a "continue?" prompt. Defaults per role; replaces `maxLoops` as the primary bound. Mid-turn re-check of `assertInteractiveBudget` | M |
| P2-3 | Repeated-call detector: hash of tool name plus normalised arguments. After 2 repeats inject "you already ran this; result_id X". After 3, wrap up | S |
| P2-4 | Context policy: clear old tool results (keep the last 3 in full, stub the rest with `result_id`) once over a threshold (start at 40k tokens). Inspector history cap. LLM compaction only for sessions that still exceed the threshold, logged with before/after tokens | M |
| P2-5 | `update_plan` tool plus a plan panel in Inspector, only for turns with three or more steps. The plan carries query lineage (`result_id`s) | M |
| P2-6 | Typed final answer plus execution-grounded checks: numbers in the answer must trace to a result; totals reconcile. Checks use code, not a second LLM pass | M |

**Phase 2 exit:**
- pass^3 is no worse than the Phase 1 baseline.
- Median input tokens per multi-loop turn are at least 50% below the W0-3 baseline.
- Budget exhaustion always yields a partial answer.

## 8. Rollout, safety and data rules

- Every PR goes on a feature branch with no direct push to `main`, and is logged in `docs/CHANGELOG.md`.
- All baseline and eval SQL is read-only `SELECT`, run with a CLI OAuth profile. Never print gateway or Databricks secrets. The probe script reads credentials from env and prints only results.
- The one migration per phase is reviewed and hand-applied (F9). Nothing destructive.
- Result previews reduce how much raw data reaches the model. Column masking stays with the PII backlog (F11) and must use the same preview function so there is one choke point.

## 9. Phase 3 and later: separate decisions

**Phase 3, durable runs** (ADR-003 worker, `agent_runs` / `run_events` / `run_inbox` / `approvals` / `agent_tool_calls`; 3–5 weeks).

Go only if (a) Automate "Ask an agent" or background chat tasks are on the next-quarter roadmap, and (b) agent versioning (immutable, pinned versions) is done. Without (b), a background run could execute a draft that changed mid-task. The harness from Phase 1 is designed so the worker calls the same `runAgentTurn`. Nothing in Phases 0–2 has to be redone.

**Phase 4, routing and sub-agents.** Only after the golden set exists. Cheap model for compaction and chart specs, failover on 5xx, read-only `delegate`. Each change must hold pass^3 at lower cost per successful task.

## 10. Timeline (one engineer, estimates)

| Block | Duration | Cumulative |
|---|---|---|
| Week 0: tests, probe, baseline | 3–4 d | ~1 wk |
| Phase 0 | ~2 wk | ~3 wk |
| Checkpoint: go/no-go Phase 1 | — | — |
| Phase 1 | ~3 wk | ~6 wk |
| Phase 2 | ~4 wk | ~10 wk |
| Phase 3 (if approved) | 3–5 wk | ~13–15 wk |

The biggest schedule risk is the gateway. If W0-2 shows LiteLLM features are disabled or outdated on our deployment, P0-2 and §6.2–6.3 need the gateway owners. Raise that on day 2, not at the end of Phase 0.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Previews hurt answers that list many rows | The UI already shows the full table. The prompt says so. The golden set includes "list the top 50" cases. The cap is an env setting |
| `tool_choice: 'none'` rejected by Bedrock-backed models when history has tool calls | W0-2 checks it. Fallback: instruction plus discarding any tool calls in the wrap-up turn |
| Streamed responses lack the cost header | Price table keyed by gateway id, plus a weekly reconciliation against LiteLLM spend logs (tag requests with `x-litellm-tags: turn:<id>` if supported) |
| Outcome relabelling makes dashboards look worse overnight | Announce it with Phase 0. Old "completed" turns were partly mislabelled; mark the deploy date on dashboards |
| Refactor regressions in nine callers | W0-1 tests, per-surface flag, minor callers last, golden set from Phase 2 |
| Changing the default model on a hunch | Default changes only with golden-set evidence (§6.3) |

## 12. Results log (fill in during Week 0)

- **W0-2 probe table:** _pending_
- **W0-3 baseline:** _pending_
- **W0-4 duplicate user message:** _pending_

## 13. Open decisions

1. Owner and start date for Week 0.
2. Who owns the LiteLLM gateway config, and can we get its version and enabled features (caching passthrough, `modify_params`, cost headers)?
3. Preview cap default (8,000 chars / 100 rows proposed).
4. Is Automate "Ask an agent" on next quarter's roadmap? This decides Phase 3.
5. Who curates the golden-set cases (needs a domain person for reference SQL)?
