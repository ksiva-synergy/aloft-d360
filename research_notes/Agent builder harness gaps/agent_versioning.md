# Agent Versioning: Industry Best Practice (2025-2026)

Research date: 2026-11-02. Scope: how agent-builder platforms and LLMOps tools version, stage, pin, promote and roll back LLM agents, as input for ALOFT agent versioning design. Sources are primary vendor docs unless marked otherwise.

Two recent platform changes affect this survey:
- **Amazon Bedrock Agents (now "Bedrock Agents Classic") is in maintenance mode and closed to new customers.** AWS points new builds to Amazon Bedrock AgentCore. [AWS: Deploy and use a Bedrock agent](https://docs.aws.amazon.com/bedrock/latest/userguide/agents-deploy.html)
- **OpenAI is deprecating reusable prompt objects.** Prompt creation was de-emphasized from 3 June 2026, and the `v1/prompts` endpoint is scheduled to shut down on **30 November 2026**. OpenAI now advises keeping prompts in versioned code (git history, PR review, release tags, feature flags) rather than in a server-side prompt registry. [OpenAI prompting guide](https://developers.openai.com/api/docs/guides/prompting)

---

## 1. What should an immutable agent version contain, and how are dependencies that change underneath it handled?

### Takeaway
The cloud agent platforms agree that an agent version is an **immutable snapshot of the whole agent definition**: instructions, model, tools and configuration. Any change creates a new version. None of the vendor docs reviewed explains how a fixed version should behave when a referenced dependency changes underneath it, such as a re-indexed knowledge base, an edited tool or a model alias that moves. A builder like ALOFT has to decide this itself, either by pinning dependency versions inside the snapshot or by recording their resolved state on each run.

### Cited Findings
- **Microsoft Foundry:** "An **agent** represents a composable unit — defined by its instructions, model, and tools. An **agent version** captures a specific immutable snapshot of an agent. Every time you make changes to your agent, such as updating the prompt or adding tools, a new agent version is created." — [Microsoft Learn: Agent applications in Foundry](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/agent-applications)
- **Bedrock Agents (Classic):** "A *version* is a snapshot that preserves the resource as it exists at the time it was created … Versions are immutable … To make updates to an agent in production, you must create a new version." All edits go to a mutable working draft called `DRAFT`. — [AWS: Deploy an agent](https://docs.aws.amazon.com/bedrock/latest/userguide/deploy-agent.html)
- **Bedrock AgentCore Runtime:** "Each update to the AgentCore Runtime creates a new version with a complete, self-contained configuration. Versions are immutable once created. Each version contains all the configuration needed for execution." Changes to the protocol, the container image or the network/security settings each create a new version. Creating or repointing an endpoint does not. — [AWS: AgentCore Runtime versioning and endpoints](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agent-runtime-versioning.html)
- **Salesforce Agentforce:** "Commit Version saves a snapshot of the current version of your agent's metadata, which locks the version so that you can either activate the agent or create a new draft version from the current version." (Trailhead text quoted in search results; page not opened directly.) — [Trailhead: Explore the new Agentforce Builder](https://trailhead.salesforce.com/content/learn/modules/new-agentforce-builder-quick-look/explore-the-new-agentforce-builder)
- **Copilot Studio:** the deployable unit is a Power Platform **solution**. It packages the agent, its topics, agent flows, **connection references, environment variables** and any Dataverse tables, so per-environment values are kept outside the versioned logic. (From search summaries of the Microsoft Learn ALM guide and Microsoft labs; the page was not opened directly.) — [Microsoft Learn: Copilot Studio ALM guidance](https://learn.microsoft.com/microsoft-copilot-studio/guidance/alm); [Microsoft MCS ALM lab](https://microsoft.github.io/mcs-labs/labs/mcs-alm/?event=bootcamp)
- **MLflow Prompt Registry** splits the snapshot into two parts. The prompt template version is immutable ("immutable, providing strong guarantees for reproducibility"). The **model configuration stored with a version (model name, temperature, max tokens) is mutable** and "can be updated or deleted without creating a new version". — [MLflow Prompt Registry](https://mlflow.org/docs/latest/genai/prompt-registry/)
- **Langfuse:** prompt versions carry both content and a `config` object. The version diff ("Changes v2 → v5") shows content and config differences. — [Langfuse prompt version control](https://langfuse.com/docs/prompt-management/features/prompt-version-control)
- **Identity and permissions are bound to the published artifact in Foundry, not to the version.** Publishing gives the agent "its own dedicated agent identity", and "permissions don't transfer automatically". Tool calls that worked in development can fail with authorization errors after publishing. — [Microsoft Learn: Agent applications](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/agent-applications)
- **Model drift under a fixed configuration:** an undated model name (an alias) points to whatever model the vendor currently recommends, and that target can change. The guidance is to pin a dated snapshot ID and run regression evals before upgrading. OpenAI also retires dated snapshots; one report says six snapshots, including `gpt-5-2025-08-07` and `o3-2025-04-16`, will be removed on 11 December 2026. (Secondary sources; not checked against OpenAI's deprecations page.) — [privatedevops.com](https://privatedevops.com/news/openai-retires-gpt-5-o3-snapshots-december-2026); [vincentschmalbach.com: model alias vs versioned ID](https://www.vincentschmalbach.com/model-alias-vs-versioned-model-id/)

### Inferences
- Based on the platforms above, a full ALOFT `AgentVersion` snapshot should hold:
  - instructions and system prompt, plus the prompt template and its variables
  - model provider and the **fully resolved model ID**: a Bedrock model ID or inference-profile ARN, or a Databricks serving endpoint plus its served-model version. Never a floating alias.
  - inference parameters: temperature, top_p, max tokens, stop sequences, reasoning/thinking budget
  - tool list, with each tool's ID, version and JSON schema copied into the snapshot
  - knowledge-base bindings: KB ID, plus index/embedding-model version or snapshot ID
  - data-source scope: catalogs, schemas and tables, plus row/column policies
  - memory configuration
  - output and answer schema
  - guardrail and policy configuration, including the Bedrock guardrail ID and **guardrail version**
  - orchestration settings: max steps, timeouts, sub-agents and their pinned versions
  - attached eval results, created by, a commit message, the parent version, and a content hash
- Settings that legitimately vary by environment (credentials, connection references, the agent's identity and permissions) should live **outside** the immutable version. Copilot Studio's connection references and environment variables and Foundry's per-application identity both separate them this way. MLflow's mutable model config is a counter-example: it weakens reproducibility, and ALOFT should not copy it.
- When a dependency changes underneath a fixed version, there are three workable strategies:
  - **Pin by value.** Copy the tool schema and prompt text into the snapshot. Strongest reproducibility.
  - **Pin by reference.** Store `toolId@version` or `kbId@indexVersion`. Requires dependencies to be versioned too.
  - **Resolve at run time and record what was resolved** on every run, accepting drift but keeping it traceable.

  Knowledge bases usually cannot be frozen by value because they get re-synced. The realistic approach is to record the KB's index or sync job ID on each run, and to treat a KB schema change (not a data refresh) as something that requires a new agent version.

### Gaps
- None of the vendor docs reviewed explains what happens to a Bedrock Agents version when an associated knowledge base is re-synced or a Lambda action group changes. The likely answer is that only the association is snapshotted, not the KB data or Lambda code, but this is not confirmed.
- I found no primary-source schema listing every field in a Foundry agent version or an Agentforce committed version.
- Whether Foundry or Agentforce attach eval results to a specific version was not confirmed.

---

## 2. How do the major platforms version agents?

### Takeaway
There are two dominant patterns:
1. **Immutable numbered versions plus a movable pointer.** The pointer is called an alias (Bedrock), an endpoint (AgentCore), an application or deployment (Foundry), a label (Langfuse), a tag or environment (LangSmith), an alias (MLflow) or an environment (Braintrust).
2. **Commit and activate with a single live version** (Agentforce, Copilot Studio solutions).

Vertex AI Agent Engine is an outlier: it updates deployments in place, with no visible revision model. OpenAI is moving prompt versioning back into application code.

### Cited Findings

**AWS Bedrock Agents (Classic)**
- Every agent starts with a mutable working draft (`DRAFT`) and a test alias `TSTALIASID` that points to it. To deploy, you create an alias, which can auto-create the next numbered version (1, 2, 3, …), or point an alias at an existing version. — [AWS: Deploy an agent](https://docs.aws.amazon.com/bedrock/latest/userguide/deploy-agent.html)
- Calling `UpdateAgentAlias` without a `routingConfiguration` makes Bedrock create a new version automatically and attach it to the alias. — [AWS: Deploy an agent](https://docs.aws.amazon.com/bedrock/latest/userguide/deploy-agent.html)
- Rollback means pointing the alias back at an earlier version: "you can change an alias to point to a previous version of your agent if there are changes that you need to revert quickly." — [AWS: Deploy an agent](https://docs.aws.amazon.com/bedrock/latest/userguide/deploy-agent.html)
- There is a kill switch: setting the alias's `aliasInvocationState` to `REJECT_INVOCATIONS` pauses the agent, and `ACCEPT_INVOCATIONS` resumes it, with no IAM changes. — [AWS: Deploy an agent](https://docs.aws.amazon.com/bedrock/latest/userguide/deploy-agent.html)
- The service is now in maintenance mode (no new customers). — [AWS: agents-deploy](https://docs.aws.amazon.com/bedrock/latest/userguide/agents-deploy.html)

**AWS Bedrock AgentCore Runtime**
- Version 1 is created automatically, and every update creates a new immutable version.
- The `DEFAULT` endpoint always follows the latest version. Named endpoints (for example `production-endpoint`) are pinned to a version and must be moved explicitly with `update_agent_runtime_endpoint(agentRuntimeId, endpointName, agentRuntimeVersion)`.
- Endpoint states: `CREATING`, `CREATE_FAILED`, `READY`, `UPDATING`, `UPDATE_FAILED`.
- Listing APIs: `ListAgentRuntimeVersions`, `ListAgentRuntimeEndpoints`.
- Source: [AWS: AgentCore Runtime versioning](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agent-runtime-versioning.html)

**Microsoft Foundry Agent Service** (doc dated 2026-06, labelled "legacy publishing experience"; a newer publishing model exists)
- Each edit creates a new immutable agent version.
- Publishing creates an ARM **Agent Application** resource with a stable URL, an auth policy and its own Entra agent identity. It also creates a child **Deployment** that references `{"agentName", "agentVersion"}`.
- The application's `trafficRoutingPolicy` is described as a routing table, but "Currently, an Agent Application supports one active deployment, directing 100% of the traffic". Publishing an update sends 100% of traffic to the new version.
- Deployment `state` values: `Starting`, `Running`, `Stopping`, `Failed`, `Deleting`, `Deleted`, `Updating`. Deployments can be started and stopped.
- Deleting the application does not delete agent versions.
- Source: [Microsoft Learn: Agent applications](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/agent-applications)

**Google Vertex AI Agent Engine**
- Updates are in place, via `client.agent_engines.update(...)` or REST `reasoningEngines.patch` with an `update_mask`, and take "a few seconds to a few minutes".
- Search found no documented named revisions, rollback or traffic splitting. — [Google Cloud: Manage deployed agents](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/manage)

**OpenAI**
- Reusable prompt objects (`v1/prompts`, with an ID and version used in the Responses API) are being shut down on 30 November 2026.
- The new guidance is to keep prompts as versioned code helpers with typed parameters, pass them through `instructions` and `input`, and handle versioning and rollback through git history, PR review, release tags and feature flags, with evals in the deploy pipeline.
- Source: [OpenAI prompting guide](https://developers.openai.com/api/docs/guides/prompting)

**LangSmith (LangChain)**
- Every prompt save is a commit with a hash.
- Tags point to exactly one commit and can be moved. The reserved environment tags are `staging` and `production`, and they are set through a promotion flow.
- Prompts are pulled with `pull_prompt("name:production")` or `pull_prompt("name:a1b2c3d4")`.
- Environment rollback uses a history of the environment pointer.
- A commit webhook sends `prompt_id`, `prompt_name`, `commit_hash`, `created_at`, `created_by` and `manifest` (one webhook per workspace; can be skipped with `skip_webhooks`).
- Source: [LangSmith: Manage prompts](https://docs.langchain.com/langsmith/manage-prompts)

**MLflow Prompt Registry**
- Versions are immutable, with a `commit_message`.
- Aliases (for example `production`) are mutable. `@latest` is reserved.
- URIs take the form `prompts:/name/2` or `prompts:/name@production`.
- Tags can be set at the prompt level or the version level. Model config is mutable (see section 1).
- Source: [MLflow Prompt Registry](https://mlflow.org/docs/latest/genai/prompt-registry/)

**Langfuse**
- Version numbers are assigned automatically. `latest` is maintained automatically, and other labels are free-form (for example `staging`, `production`, tenant names, `prod-a`/`prod-b`).
- Fetching with no label returns `production`. Passing both `label` and `version` returns HTTP 400. A missing label returns 404 with **no fallback**, unless an SDK fallback prompt is configured.
- Endpoint: `GET /api/public/v2/prompts/{name}`.
- Protected labels (Enterprise) stop `viewer` and `member` roles from moving them.
- Source: [Langfuse prompt version control](https://langfuse.com/docs/prompt-management/features/prompt-version-control)

**Braintrust**
- Every save creates a version with a unique ID, and apps get the latest version by default.
- Code can pin a version. Alternatively, versions are mapped to named **environments** and loaded with `loadPrompt({environment})`. `invoke()` does not accept an environment parameter.
- Suggested pattern: use latest in development and staging, and pin in production.
- Source: [Braintrust prompt versions](https://www.braintrust.dev/docs/evaluate/prompts/versions); [Braintrust environments](https://www.braintrust.dev/docs/guides/environments)

**Salesforce Agentforce**
- Workflow: draft, then **Commit Version** (locks the metadata snapshot), then **Activate**. "Only one version can be live, so activating a new one automatically switches off the old one."
- Agentforce DX (CLI or VS Code) can activate or deactivate an agent (`--api-name` flag). To change topics or actions, the agent must be deactivated.
- Testing Center runs batch tests, recommended in a sandbox. Builder event logs are kept for 7 days.
- (Search-result summaries of Salesforce pages.) — [Trailhead: new Agentforce Builder](https://trailhead.salesforce.com/content/learn/modules/new-agentforce-builder-quick-look/explore-the-new-agentforce-builder); [Agentforce DX: Manage an agent](https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-manage.html); [Agentforce Testing API](https://developer.salesforce.com/docs/ai/agentforce/guide/testing-api.html)

**Microsoft Copilot Studio**
- Versioning happens through Power Platform ALM. You develop in an unmanaged solution in a Dev environment, export it as **managed**, and import it into Test and Prod.
- Managed solutions lock components and support rollback and versioning.
- Pipelines and git integration handle source control.
- Agents left in the default solution cannot be exported.
- (Search summaries; Microsoft Learn ALM page not opened directly.) — [Microsoft Learn: Copilot Studio ALM](https://learn.microsoft.com/microsoft-copilot-studio/guidance/alm); [Agent Academy: creating a solution](https://microsoft.github.io/agent-academy/recruit-nextgen/03-creating-a-solution/)

### Inferences
- The most transferable model for ALOFT is Bedrock Classic and AgentCore: a **mutable draft**, **immutable auto-numbered versions** and **named pointers** (aliases or endpoints) that callers bind to. A `DEFAULT`/`latest` pointer follows new versions, while `production` only moves when someone explicitly promotes.
- Copying Foundry's separation of a stable *application/endpoint* (with its own identity and RBAC) from the *version* it serves would fit ALOFT's enterprise auth needs.
- Since OpenAI and the git-centric camp have moved away from server-side prompt registries, ALOFT's own store (Postgres/Prisma) should be the system of record for agent versions. It should not depend on any vendor's prompt object.

### Gaps
- **Humanloop, PromptLayer and Dify:** the searches returned nothing on their release labels or versioning. I recall reports that Humanloop was sunset after its 2025 acquisition, but I could not confirm this, so it should not be cited.
- **Vertex AI Agent Builder / Agent Engine:** no evidence of version or revision objects. It may exist in newer docs not surfaced by search.
- **Bedrock `routingConfiguration`:** it is a list of version entries, but whether it ever supported weighted splits across versions was not confirmed from primary docs fetched here.

---

## 3. Lifecycle and state models

### Takeaway
In practice the lifecycle is **draft → immutable version (committed or numbered) → bound to an environment pointer (staging or production) → replaced or deactivated**. "Staging" and "production" are almost always **mutable labels on immutable versions**, not states stored on the version itself. No platform reviewed uses semantic versioning for agents: versions are monotonically increasing integers or commit hashes.

### Cited Findings
- **Bedrock Classic:** `DRAFT` (mutable), then numbered versions 1…n (immutable), then aliases. `TSTALIASID` is fixed to `DRAFT`. Alias invocation state is `ACCEPT_INVOCATIONS` or `REJECT_INVOCATIONS`. — [AWS: Deploy an agent](https://docs.aws.amazon.com/bedrock/latest/userguide/deploy-agent.html)
- **AgentCore:** versions V1…Vn. Endpoints include `DEFAULT` (tracks latest) and custom names like `PROD`, with endpoint states `CREATING`, `READY`, `UPDATING`, `UPDATE_FAILED`, `CREATE_FAILED`. — [AWS: AgentCore versioning](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agent-runtime-versioning.html)
- **Agentforce:** draft, then committed (locked), then active or inactive. Only one active version at a time, and a new draft can branch from a committed version. — [Trailhead: Agentforce Builder](https://trailhead.salesforce.com/content/learn/modules/new-agentforce-builder-quick-look/explore-the-new-agentforce-builder)
- **Foundry:** an agent version, then publishing creates an application and a deployment, with deployment states `Starting`, `Running`, `Stopping`, `Failed`, `Deleting`, `Deleted`, `Updating`. — [Microsoft Learn: Agent applications](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/agent-applications)
- **LangSmith** reserves the environment tags `staging` and `production` and sets them through a promotion flow, separate from free-form tags. — [LangSmith: Manage prompts](https://docs.langchain.com/langsmith/manage-prompts)
- **Langfuse** uses `latest` (automatic), `production` (the default fetched) and custom labels. — [Langfuse](https://langfuse.com/docs/prompt-management/features/prompt-version-control)
- **What triggers a new version:**
  - Bedrock and Foundry: any change to the definition. Foundry gives examples like "updating the prompt or adding tools". — [Microsoft Learn](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/agent-applications)
  - AgentCore: changes to the protocol, container image or network settings, but **not** endpoint changes. — [AWS: AgentCore versioning](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agent-runtime-versioning.html)
  - Bedrock Classic: also when an alias update omits `routingConfiguration`. — [AWS](https://docs.aws.amazon.com/bedrock/latest/userguide/deploy-agent.html)
  - Braintrust: every save. — [Braintrust](https://www.braintrust.dev/docs/evaluate/prompts/versions)
  - MLflow: changing the template does, but changing the model config does **not**. — [MLflow](https://mlflow.org/docs/latest/genai/prompt-registry/)

### Inferences
- A recommended ALOFT state model:
  - **Version records:** `DRAFT` (one per agent, mutable), then `VERSION n` (immutable), with an optional `deprecated` or `archived` flag.
  - **Separate pointer table:** `AgentAlias {name: draft|staging|production|custom, agentVersionId, routing[], invocationState, protected}`.
- A version's status ("in production") should be **derived** from which aliases point to it, not stored as a field. This avoids two sources of truth.
- Use integer versions plus a content hash. Semantic versioning adds judgement calls about what counts as "breaking" for prompts, and no surveyed platform uses it. A "breaking" flag is still useful for changes to the output schema or tool contracts, because pinned automations depend on those.
- To avoid version explosion, only **publish/commit** should create versions, not every autosave. Agentforce's "Commit Version" and Bedrock's alias-driven creation both work this way. Every-save versioning (Braintrust, Foundry) suits prompt registries but creates noise for full agent snapshots.

### Gaps
- I found no explicit "deprecated" or "sunset" state on agent versions in any platform, beyond deleting versions or aliases.

---

## 4. Promotion, canary and A/B rollouts, shadow mode, rollback, and pinning callers

### Takeaway
Rollback by **repointing an alias or label to an earlier immutable version** is universal and instant. Built-in percentage canaries or A/B splits between agent versions are **not** generally available on the managed agent platforms: Foundry explicitly supports only 100% routing to one deployment, and Agentforce allows one live version. A/B is usually done with labels and client-side routing (Langfuse `prod-a`/`prod-b`), or with feature flags in code (OpenAI's guidance). Callers either pin an exact version (Braintrust production, AgentCore named endpoints) or follow a pointer.

### Cited Findings
- **Rollback by pointer:**
  - Bedrock: repoint the alias to a previous version. — [AWS](https://docs.aws.amazon.com/bedrock/latest/userguide/deploy-agent.html)
  - Langfuse: move the `production` label back. — [Langfuse](https://langfuse.com/docs/prompt-management/features/prompt-version-control)
  - LangSmith: "rollback icon" on an environment with a rollback history, "The environment pointer will update to that commit." — [LangSmith](https://docs.langchain.com/langsmith/manage-prompts)
  - MLflow: swap the alias "for A/B tests or rollbacks without changing application code". — [MLflow](https://mlflow.org/docs/latest/genai/prompt-registry/)
- **Emergency stop without rollback:** Bedrock `aliasInvocationState=REJECT_INVOCATIONS` — [AWS](https://docs.aws.amazon.com/bedrock/latest/userguide/deploy-agent.html); Foundry deployment stop/start and `isEnabled` on the application — [Microsoft Learn](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/agent-applications).
- **No canary in Foundry today:** "Currently, an Agent Application supports one active deployment, directing 100% of the traffic … to that deployment." The `trafficRoutingPolicy` field exists, which suggests weighted routing is planned. — [Microsoft Learn](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/agent-applications)
- **Agentforce:** activating a new version automatically deactivates the old one, so there is no concurrent split. — [Trailhead](https://trailhead.salesforce.com/content/learn/modules/new-agentforce-builder-quick-look/explore-the-new-agentforce-builder)
- **A/B via labels:** Langfuse suggests experiment labels such as `prod-a` and `prod-b` (the client chooses which to fetch) and compares per-version metrics in the Metrics tab. — [Langfuse version control](https://langfuse.com/docs/prompt-management/features/prompt-version-control); [Langfuse link to traces](https://langfuse.com/docs/prompt-management/features/link-to-traces)
- **Pinning vs following:**
  - Braintrust: "Pinning a version in production code means later saves don't affect your application until you update the pin". Suggested: latest in dev and staging, pinned in prod. — [Braintrust](https://www.braintrust.dev/docs/evaluate/prompts/versions)
  - AgentCore: `DEFAULT` follows latest, named endpoints are pinned. — [AWS](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agent-runtime-versioning.html)
  - Langfuse: callers can fetch `version=3` (pinned) or `label=production` (following). — [Langfuse](https://langfuse.com/docs/prompt-management/features/prompt-version-control)
- **Failure mode when a pointer is missing:** Langfuse returns 404 if no version has the requested label and does not fall back, unless the SDK has a fallback prompt configured. — [Langfuse](https://langfuse.com/docs/prompt-management/features/prompt-version-control)
- **Promotion gating via evals:**
  - Agentforce Testing Center runs batch tests (a Testing API exists). — [Agentforce Testing API](https://developer.salesforce.com/docs/ai/agentforce/guide/testing-api.html)
  - OpenAI recommends evaluation checks in the deployment process for prompt changes. — [OpenAI prompting guide](https://developers.openai.com/api/docs/guides/prompting)
- **Promotion events:** LangSmith fires a webhook on every commit, which can trigger CI or evals. — [LangSmith](https://docs.langchain.com/langsmith/manage-prompts)
- **Protected promotion:** Langfuse protected labels (Enterprise) mean only `admin` and `owner` can move `production`. — [Langfuse](https://langfuse.com/docs/prompt-management/features/prompt-version-control)

### Inferences
- **Automations and workflows should pin an exact version by default.** Interactive chat surfaces can follow `production`. Pinned callers need upgrade prompts or notifications when their version is deprecated, and they should be blocked from being silently retargeted, especially when the output schema changes.
- A canary or A/B rollout in ALOFT can be built from an alias `routing: [{versionId, weight}]` with sticky assignment per conversation or user (hashing the session ID). This is the shape implied by Bedrock `routingConfiguration` and Foundry `trafficRoutingPolicy`.
- **Shadow mode** (running a candidate version on copied production inputs without returning its output) was not documented by any platform reviewed. ALOFT would need to build it, for example by replaying logged production inputs against the candidate offline and running evals.
- Promotion to `production` should require a passing eval run attached to that exact version ID, plus an approver role (protected alias).

### Gaps
- No primary documentation was found for built-in canary, shadow or percentage rollouts in Bedrock Agents, Vertex Agent Engine, Copilot Studio or Agentforce.
- Whether the Bedrock Classic `routingConfiguration` ever supported more than one version was not confirmed.

---

## 5. Traceability: recording the agent version on every run, audits, approvals and diffs

### Takeaway
LLMOps tools link each generation or trace to the exact prompt version and aggregate metrics per version. The OpenTelemetry GenAI conventions define agent-level span attributes, but they are still in "Development" stability, and the exact name of the version attribute is unclear. Built-in diffs cover configuration and content only. Behavioural diffs come from comparing eval results between versions.

### Cited Findings
- **Langfuse** links a prompt version to generations (`prompt=` in Python, `{ prompt }` in JS, `propagate_attributes(prompt=...)` to cover several generations, plus integration keys such as `langfuse_prompt`). Per version it tracks median latency, input and output tokens, cost, score, generation count, and first and last timestamps. "Only generation observations are linked to the prompt", and fallback prompts create no link. — [Langfuse: Link prompts to traces](https://langfuse.com/docs/prompt-management/features/link-to-traces)
- **Langfuse version diff:** a "Changes v2 → v5" dialog shows content and config diffs. — [Langfuse](https://langfuse.com/docs/prompt-management/features/prompt-version-control)
- **LangSmith commit webhook** records `commit_hash`, `created_by` and `created_at` for each change, which gives an audit trail. — [LangSmith](https://docs.langchain.com/langsmith/manage-prompts)
- **MLflow** commit messages and version-level tags provide change rationale and metadata. It also claims integration with Tracing, Evaluation and Monitoring (details not shown on that page). — [MLflow](https://mlflow.org/docs/latest/genai/prompt-registry/)
- **OpenTelemetry GenAI semantic conventions:**
  - The definitions moved to the separate `semantic-conventions-genai` repository, and the old opentelemetry.io page is no longer maintained. — [OTel GenAI agent spans (moved notice)](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/)
  - Agent attributes (`gen_ai.agent.*`) are at "Development" stability. Operations include `create_agent`, `invoke_agent`, `invoke_workflow` and `execute_tool`. One secondary blog names a version attribute `gen_ai.agent_version`, but it is unverified and possibly misspelled. — [OpenObserve blog](https://openobserve.ai/blog/opentelemetry-genai-semantic-conventions/); [Greptime blog 2026-05-09](https://greptime.com/blogs/2026-05-09-opentelemetry-genai-semantic-conventions)
- **Approvals and audit through platform RBAC:**
  - Foundry requires the Foundry Project Manager role to publish and Foundry User to invoke, scoped per application. — [Microsoft Learn](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/agent-applications)
  - Langfuse protected labels restrict who can promote. — [Langfuse](https://langfuse.com/docs/prompt-management/features/prompt-version-control)
  - Copilot Studio uses managed solutions plus pipelines (search summary). — [Microsoft Learn: Copilot Studio ALM](https://learn.microsoft.com/microsoft-copilot-studio/guidance/alm)
- **Agentforce Builder** keeps event logs for only 7 days, so long-term traceability needs separate storage. — [Trailhead (search summary)](https://trailhead.salesforce.com/content/learn/modules/new-agentforce-builder-quick-look/explore-the-new-agentforce-builder)

### Inferences
- Every ALOFT run and trace row should store:
  - `agentId`, `agentVersionId` (or number) and `configHash`
  - the alias it was resolved through (for example `production`), so incidents can tell "pointer moved" apart from "version changed"
  - the **resolved model ID returned by the provider** (the response model, not only the requested one)
  - tool versions, KB index or sync IDs, and the guardrail version used

  The version should also be emitted as an OTel span attribute on `invoke_agent`. Without the alias, a bad answer can be mapped to a version but not explained.
- Diffs should come in two layers:
  1. A structured configuration diff over the snapshot JSON: prompt text diff, model and parameter changes, tools added or removed, schema changes.
  2. A behavioural diff: the same eval dataset run against both versions, comparing scores, latency, cost and failure cases. Langfuse's per-version metric aggregation is a production-side version of this.
- An audit log should record who created each version, who moved each alias, from which version to which, why (commit message), and the linked eval run and approver.

### Gaps
- The exact, current OTel attribute name for agent version (`gen_ai.agent.version` vs `gen_ai.agent_version`) could not be confirmed from the primary spec.
- No platform reviewed documents a built-in "behavioural diff" feature beyond side-by-side eval or experiment comparisons.

---

## 6. Common pitfalls

### Takeaway
The main pitfalls are:
- mutable state hiding inside an apparently fixed version (editing in place, mutable model config, floating model aliases)
- pointers silently following "latest"
- identity and permission changes on publish
- dependencies retiring underneath a pinned version (model snapshots, deprecated APIs)
- too many versions when every save becomes a deployable version

### Cited Findings
- **In-place updates leave no rollback target:** Vertex Agent Engine updates a deployed agent in place via `reasoningEngines.patch`. — [Google Cloud: Manage deployed agents](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/manage)
- **"Latest"-following pointers:** AgentCore's `DEFAULT` endpoint auto-advances on every update. — [AWS](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agent-runtime-versioning.html). Braintrust apps get the latest version by default unless pinned. — [Braintrust](https://www.braintrust.dev/docs/evaluate/prompts/versions). A Bedrock alias update without `routingConfiguration` implicitly cuts a new version. — [AWS](https://docs.aws.amazon.com/bedrock/latest/userguide/deploy-agent.html)
- **Mutable configuration inside a "version":** MLflow model config can be changed without a new version. — [MLflow](https://mlflow.org/docs/latest/genai/prompt-registry/)
- **Unpinned model aliases:** undated model names move to newer models and change behaviour. Pinned snapshots reduce drift but do not guarantee identical outputs, and pinned snapshots get retired (reported retirements on 11 December 2026). — [vincentschmalbach.com](https://www.vincentschmalbach.com/model-alias-vs-versioned-model-id/); [privatedevops.com](https://privatedevops.com/news/openai-retires-gpt-5-o3-snapshots-december-2026) (secondary sources)
- **Vendor feature deprecation under a versioning scheme:** OpenAI `v1/prompts` shuts down on 30 November 2026, and Bedrock Agents Classic is in maintenance mode. — [OpenAI](https://developers.openai.com/api/docs/guides/prompting); [AWS](https://docs.aws.amazon.com/bedrock/latest/userguide/agents-deploy.html)
- **Identity and permission break on publish:** in Foundry, tool calls that worked in the project fail after publishing because the identity changes. — [Microsoft Learn](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/agent-applications)
- **Missing-label outage:** Langfuse returns a 404 with no fallback if a label is removed. — [Langfuse](https://langfuse.com/docs/prompt-management/features/prompt-version-control)
- **Must deactivate to edit:** in Agentforce, changing topics or actions requires deactivating the agent, so without a draft/commit flow you get downtime. — [Agentforce DX: Manage an agent](https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-manage.html)
- **Non-exportable default container:** Copilot Studio agents left in the default solution cannot be moved between environments. — [Agent Academy](https://microsoft.github.io/agent-academy/recruit-nextgen/03-creating-a-solution/) (search summary)

### Inferences
Guardrails for ALOFT:
- Make published versions write-once at the database level, for example with a Prisma middleware or a DB trigger that rejects updates when `status != DRAFT`.
- Reject floating model IDs at publish time; require a dated or ARN model ID, or a pinned Databricks served-model version.
- Snapshot tool schemas by value.
- Store a content hash so that a "new version" with an identical hash is deduplicated, which limits version explosion.
- Create versions only on explicit publish.
- Never allow deleting a version that an alias or a pinned automation still references.
- Keep a fallback (last known good version) for pointer resolution failures.
- Monitor provider model-retirement notices against all pinned model IDs in active versions.

### Gaps
- I found no quantitative, primary-source data on how often prompt or model drift caused production incidents. The evidence is anecdotal or from vendors.
