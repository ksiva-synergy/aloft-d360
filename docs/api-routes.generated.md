# Generated API route list

**Generated:** 2026-10-31
**Total:** 188 route handlers

## By prefix

### `/api/access/*` (3)

- `/api/access/assignments`
- `/api/access/permissions`
- `/api/access/roles`

### `/api/agent-lab/*` (98)

- `/api/agent-lab/agents`
- `/api/agent-lab/agents/chat`
- `/api/agent-lab/agents/chats`
- `/api/agent-lab/agents/chats/[id]`
- `/api/agent-lab/construction`
- `/api/agent-lab/construction/class`
- `/api/agent-lab/context/data-score`
- `/api/agent-lab/context/estate`
- `/api/agent-lab/context/estate-briefing`
- `/api/agent-lab/context/estate/facets`
- `/api/agent-lab/context/estate/harvest`
- `/api/agent-lab/context/estate/preview-columns`
- `/api/agent-lab/context/estate/run-scheduled`
- `/api/agent-lab/context/estate/scan-coverage`
- `/api/agent-lab/context/estate/schedule`
- `/api/agent-lab/context/estate/sync-knowledge`
- `/api/agent-lab/context/jobs`
- `/api/agent-lab/context/jobs/[id]`
- `/api/agent-lab/context/jobs/[id]/children`
- `/api/agent-lab/context/jobs/[id]/kick`
- `/api/agent-lab/context/jobs/[id]/logs`
- `/api/agent-lab/context/jobs/[id]/objects`
- `/api/agent-lab/context/jobs/[id]/retry-failed`
- `/api/agent-lab/context/jobs/active`
- `/api/agent-lab/context/jobs/cockpit`
- `/api/agent-lab/context/jobs/dates`
- `/api/agent-lab/context/jobs/kick-queued`
- `/api/agent-lab/context/jobs/launch`
- `/api/agent-lab/context/jobs/plan`
- `/api/agent-lab/context/jobs/queued`
- `/api/agent-lab/context/jobs/summary`
- `/api/agent-lab/context/jobs/trigger`
- `/api/agent-lab/context/mappings`
- `/api/agent-lab/context/mappings/[id]`
- `/api/agent-lab/context/mappings/export`
- `/api/agent-lab/context/mappings/run`
- `/api/agent-lab/context/objects`
- `/api/agent-lab/context/objects/[id]`
- `/api/agent-lab/context/objects/[id]/confirm-semantic`
- `/api/agent-lab/context/objects/[id]/enrich`
- `/api/agent-lab/context/objects/[id]/refresh`
- `/api/agent-lab/context/objects/[id]/reharvest-all`
- `/api/agent-lab/context/objects/[id]/resolve-pii`
- `/api/agent-lab/context/objects/scanned`
- `/api/agent-lab/context/objects/scanned/facets`
- `/api/agent-lab/context/pipeline/continue`
- `/api/agent-lab/context/pipeline/intent`
- `/api/agent-lab/context/process`
- `/api/agent-lab/context/silo/links`
- `/api/agent-lab/context/silo/links/[id]`
- `/api/agent-lab/context/silo/scan`
- `/api/agent-lab/context/sources`
- `/api/agent-lab/context/sources/[id]`
- `/api/agent-lab/context/sources/[id]/coverage`
- `/api/agent-lab/context/sources/[id]/harvest`
- `/api/agent-lab/context/sources/[id]/inventory`
- `/api/agent-lab/context/sources/[id]/refresh`
- `/api/agent-lab/flows`
- `/api/agent-lab/flows/[id]`
- `/api/agent-lab/flows/[id]/publish`
- `/api/agent-lab/flows/[id]/versions`
- `/api/agent-lab/flows/agent-try`
- `/api/agent-lab/flows/agents`
- `/api/agent-lab/flows/catalog`
- `/api/agent-lab/flows/copilot`
- `/api/agent-lab/flows/simulate`
- `/api/agent-lab/marcus/reflections`
- `/api/agent-lab/marcus/reflections/[id]`
- `/api/agent-lab/memory/[id]`
- `/api/agent-lab/memory/[id]/curate`
- `/api/agent-lab/memory/browse`
- `/api/agent-lab/memory/canary-status`
- `/api/agent-lab/memory/cluster`
- `/api/agent-lab/memory/job-health`
- `/api/agent-lab/memory/keeper-summary`
- `/api/agent-lab/memory/leaderboard`
- `/api/agent-lab/memory/purge-session`
- `/api/agent-lab/memory/runs`
- `/api/agent-lab/memory/runs/[id]`
- `/api/agent-lab/memory/sessions`
- `/api/agent-lab/memory/signatures`
- `/api/agent-lab/memory/stats`
- `/api/agent-lab/memory/synthesize`
- `/api/agent-lab/memory/topic-map`
- `/api/agent-lab/memory/trace/[id]`
- `/api/agent-lab/ops/evals`
- `/api/agent-lab/ops/prompts`
- `/api/agent-lab/runs`
- `/api/agent-lab/runs/[sessionId]`
- `/api/agent-lab/studio/insights`
- `/api/agent-lab/workbench/chat`
- `/api/agent-lab/workbench/commission`
- `/api/agent-lab/workbench/generate-title`
- `/api/agent-lab/workbench/handoff`
- `/api/agent-lab/workbench/sessions`
- `/api/agent-lab/workbench/sessions/[id]`
- `/api/agent-lab/workbench/test-run`
- `/api/agent-lab/workbench/tools`

### `/api/audit-log/*` (1)

- `/api/audit-log`

### `/api/auth/*` (1)

- `/api/auth/[...nextauth]`

### `/api/backfill/*` (1)

- `/api/backfill/agent-lab/bandits`

### `/api/catalog/*` (8)

- `/api/catalog/agents`
- `/api/catalog/agents/[id]`
- `/api/catalog/agents/[id]/diff/[otherId]`
- `/api/catalog/agents/[id]/fork`
- `/api/catalog/agents/[id]/review`
- `/api/catalog/agents/[id]/versions`
- `/api/catalog/tools`
- `/api/catalog/tools/[id]`

### `/api/connections/*` (5)

- `/api/connections`
- `/api/connections/[id]`
- `/api/connections/[id]/browse`
- `/api/connections/[id]/extract`
- `/api/connections/[id]/test`

### `/api/dashboard/*` (1)

- `/api/dashboard/summary`

### `/api/databricks/*` (5)

- `/api/databricks/connections`
- `/api/databricks/connections/[id]`
- `/api/databricks/connections/[id]/execute`
- `/api/databricks/connections/[id]/test`
- `/api/databricks/connections/[id]/tool`

### `/api/health/*` (1)

- `/api/health`

### `/api/inspector/*` (48)

- `/api/inspector/boost/dispatch`
- `/api/inspector/boost/results`
- `/api/inspector/boost/run-suite`
- `/api/inspector/boost/score`
- `/api/inspector/charts`
- `/api/inspector/charts/[chartId]`
- `/api/inspector/chat`
- `/api/inspector/chat-models`
- `/api/inspector/dashboards`
- `/api/inspector/dashboards/[dashboardId]`
- `/api/inspector/dashboards/[dashboardId]/collaborators`
- `/api/inspector/dashboards/[dashboardId]/data`
- `/api/inspector/dashboards/[dashboardId]/draft`
- `/api/inspector/dashboards/[dashboardId]/restore`
- `/api/inspector/dashboards/[dashboardId]/share`
- `/api/inspector/dashboards/[dashboardId]/versions`
- `/api/inspector/dashboards/[dashboardId]/widgets/[widgetId]/data`
- `/api/inspector/digest`
- `/api/inspector/export`
- `/api/inspector/memory/rules`
- `/api/inspector/memory/rules/[ruleId]`
- `/api/inspector/memory/rules/[ruleId]/promote`
- `/api/inspector/performance`
- `/api/inspector/semantic/[modelId]/archive`
- `/api/inspector/semantic/[modelId]/authoring-meta`
- `/api/inspector/semantic/[modelId]/authoring-preview`
- `/api/inspector/semantic/[modelId]/blueprint`
- `/api/inspector/semantic/[modelId]/blueprint/refine-item`
- `/api/inspector/semantic/[modelId]/contributions`
- `/api/inspector/semantic/[modelId]/definitions`
- `/api/inspector/semantic/[modelId]/definitions/[definitionId]`
- `/api/inspector/semantic/[modelId]/disambiguation-rank`
- `/api/inspector/semantic/[modelId]/drafts`
- `/api/inspector/semantic/[modelId]/intents`
- `/api/inspector/semantic/[modelId]/promote`
- `/api/inspector/semantic/[modelId]/resolve-intent`
- `/api/inspector/semantic/[modelId]/review`
- `/api/inspector/semantic/[modelId]/submit`
- `/api/inspector/semantic/candidates`
- `/api/inspector/semantic/entities-catalog`
- `/api/inspector/semantic/lineage`
- `/api/inspector/semantic/models`
- `/api/inspector/semantic/my-contributions`
- `/api/inspector/semantic/my-drafts`
- `/api/inspector/sessions`
- `/api/inspector/teach`
- `/api/inspector/teach/candidates`
- `/api/inspector/teach/session/[sessionId]`

### `/api/knowledge/*` (8)

- `/api/knowledge`
- `/api/knowledge/[id]`
- `/api/knowledge/[id]/agents`
- `/api/knowledge/[id]/agents/[agentId]`
- `/api/knowledge/[id]/documents`
- `/api/knowledge/[id]/documents/[docId]`
- `/api/knowledge/[id]/qa`
- `/api/knowledge/search`

### `/api/policies/*` (2)

- `/api/policies`
- `/api/policies/[id]`

### `/api/sessions/*` (3)

- `/api/sessions`
- `/api/sessions/[id]`
- `/api/sessions/[id]/actions`

### `/api/studio/*` (1)

- `/api/studio/results`

### `/api/users/*` (2)

- `/api/users`
- `/api/users/[id]`
