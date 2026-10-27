# Data access control, safety and policy — what the application needs

Status: **proposal** (2026-10-26). Nothing in this document is implemented.
Method: static reading of this repository on 2026-10-26, building on the 24 October audit ([business-ai-studio-current-state.md](audits/business-ai-studio-current-state.md), "the audit"). No tests were run, and no database, AWS account or Databricks workspace was queried. Statements marked **verified** were read in source today; **inference** follows from source but was not observed running; **unverified** cannot be known from the repository.

Related: [flows-architecture.md](flows-architecture.md) §12 (Flows depends on this), [flows-design.md](flows-design.md).

---

## 1. Goal

Administrators decide, from inside ALOFT, **who can see which data and do what with it**, and the application enforces that everywhere data can be read, stored, derived, shared, exported or sent to a model. Every decision is auditable.

The rest of this document answers four questions:

1. Where does data flow today, and how is each path protected? (§3)
2. What must be fixed before any access model means anything? (§4)
3. What is the target model, and how is it enforced on each path? (§5–§10)
4. Which written policies does the organisation need, and what is the build order? (§11–§14)

Each item is tagged **[M] mandatory** (the feature is unsafe or meaningless without it), **[S] should have** (soon after the first release), or **[G] good to have** (when a need appears).

## 2. Principles

1. **Deny by default.** No grant, no access. Today a signed-in user can reach almost everything.
2. **One decision point.** All code asks one function; no route invents its own rule.
3. **Enforce on the server, at the data path.** Hiding a button is a convenience, not a control.
4. **Derived data inherits sensitivity.** A profile, a memory rule, a cached result, a dashboard, an export or an LLM prompt built from sensitive data is sensitive.
5. **The app decides; Databricks bounds.** ALOFT applies fine-grained rules; service principals per tier stop a bug in ALOFT from reaching data outside the tier.
6. **Least privilege for people and machines.** Platform administration does not imply data access. Background jobs get only what their job needs.
7. **Everything auditable.** Every grant change, every denial, every sensitive read and every export is recorded.
8. **Safe rollout.** Observe, then enforce, so the change does not lock out legitimate users.

## 3. Current state: every data path

**Baseline (verified):** the Next.js proxy requires a signed-in NextAuth session for all `/api/**` routes except auth and health ([vite-migration/PROGRESS.md](vite-migration/PROGRESS.md), `src/proxy.ts`). Of 158 route files, about 106 call `getServerSession`, and only about 11 use a permission helper (`requirePermission` and similar). Permissions are feature-level (`inspector:use`, `user:*`, `role:*`, `audit:read`, `llm:payload:read`, … in [rbac.ts](../src/lib/rbac.ts)); there is no data-level permission. So in practice: **signed in = can read everything ALOFT can read.**

| # | Path | What data | Protection today | Gap |
|---|---|---|---|---|
| P1 | Inspector chat → `execute_tool` / semantic chart | Live warehouse rows | Login; read-only single statement ([databricks/execute.ts](../src/lib/databricks/execute.ts)); session ownership check **observe-only** unless `INSPECTOR_AUTH_ENFORCE=true` ([session-auth.ts](../src/lib/inspector/session-auth.ts)) | No data grants; model can issue any read-only SQL the shared principal can run |
| P2 | Semantic query (`executeSemanticQuery`) | Live rows via governed definitions | Governed models only on default path; other users' drafts blocked ([semantic/execute.ts](../src/lib/semantic/execute.ts)) | No per-user grant on models, no row filters, no column masks |
| P3 | CSV export (`/api/inspector/export`) | Up to **100,000 rows** per call ([export-limits.ts](../src/lib/databricks/export-limits.ts)) | Login; read-only; `guardInspectorChat` (observe-only by default) | **Accepts SQL from the browser** (verified, route body `sql`). Any signed-in user can bulk-export anything the shared principal reads |
| P4 | `/api/databricks/connections` (+ execute) | Credentials and live rows | Login only | Audit **S4 (P0)**: any user can add a connection with a client secret and run SQL as it. Still open today |
| P5 | Dashboards (`/api/inspector/dashboards/**`) | Live rows per widget | Per-dashboard roles owner/editor/viewer; visibility `private` / `org` / `shared` (verified) | `org` visibility lets every org user run the widgets' queries with the shared credential, regardless of what data they could otherwise see |
| P6 | Data Estate browse (catalog, object pages, lineage) | Copy in Aurora: names, comments, **column profiles with `top_k` values, min, max, patterns**, semantic descriptions, embeddings | Login | Profiles hold real values. `top_k` is removed only after T2 enrichment, where an **LLM decides** `pii_flag` ([enrich.ts](../src/lib/context/enrich.ts) `scrubPiiTopK`); `min`/`max`/`patterns` are kept even for PII columns. Anyone signed in can browse |
| P7 | Harvester (ECS) | Metadata and samples | Runs as one connection's service principal; whatever it can read is profiled | Scope is "everything visible to the token" (`SHOW CATALOGS` in [databricks-adapter.ts](../src/lib/context/databricks-adapter.ts)); no approved-schema list |
| P8 | Agent memory (FOER / teach) | Rules learned from sessions | `visibility` `org` (default) or `personal` ([memory/retrieve.ts](../src/lib/memory/retrieve.ts)) | A rule learned from a sensitive session becomes org-wide context for everyone. Audit **S13**: memory injected into prompts without delimiter hardening. Audit **S8**: purge without owner check |
| P9 | Knowledge base (`knowledge_chunks`) | Document text and embeddings | `org_id` only | No per-source or per-document access |
| P10 | Workbench sessions | Transcripts, drafts | Login | Audit **S2 (P0)**: any user can read and write any session by id. Still open today |
| P11 | Studio results (`studio_query_results`) | Stored SQL and **rows** | Login | Audit **S9**: returned by client-supplied session id |
| P12 | Agents (`agent_catalog`, use / commission) | Prompts; tool access | Login | No "who may use this agent"; agent-use route allows `describe_schema` + `execute_tool` only (good, hardcoded) |
| P13 | LLM providers | Prompts that include query results, schema, memory | Server-side credentials | Code supports **xAI** (`hasXaiCredentials`) and **Azure OpenAI** (`providers/foundry-chat.ts`, `AZURE_OPENAI_ENDPOINT`) in addition to Bedrock, i.e. data may leave AWS. No rule says which data may go to which provider |
| P14 | Logs: `tool_invocation_log`, `agent_turn_log`, `llm_calls` | SQL text, tool I/O, payloads | `execute_tool` outputs reduced to counts/columns ([agent-ops/redact.ts](../src/lib/agent-ops/redact.ts)); key-name redaction ([redact.ts](../src/lib/redact.ts)); 90-day retention for tool log ([agent-ops-retention.mjs](../scripts/agent-ops-retention.mjs)) | `traceLlmCall` is not called anywhere (verified), so payload logging is dormant today; if switched on, values are not redacted, only keys. No retention for sessions, studio results, memory |
| P15 | Roles and policies admin | Who has which role | `requirePermission` on some routes | Audit **S1 (P0)**: new users are created as `admin` (`DEFAULT_ROLE = 'admin'`, verified) and `admin` can assign `platform_admin`. Audit **S3 (P0)**: policy create/update/delete without role check (verified: no check in `policies` handlers) |
| P16 | Flows (planned) | All of the above, unattended | n/a | Must not ship before this model exists (see [flows-architecture.md](flows-architecture.md) §12) |

**The headline:** the semantic layer and the read-only SQL guard are real and good. Everything around them assumes every signed-in user is trusted with all data, and because of S1 most users are in fact administrators.

## 4. Fix first: open holes (Phase 0) — all [M]

These come from the audit and were re-checked today where noted. An access model on top of them is meaningless, because any user can make themselves an admin or read another user's session.

| ID | Fix | Re-checked 2026-10-26 |
|---|---|---|
| S1 | Default role for new users becomes `readonly` (or "no data access"); add a rank check so nobody can assign a role above their own; **review every existing user**, since current users were created as `admin` | Still open |
| S2 | Owner checks on workbench session GET/PATCH | Still open |
| S3 | Admin-only on policy create/update/delete and catalog create/fork | Still open |
| S4 | Admin-only on Databricks connections create/test/execute | Still open |
| S5 | Turn `INSPECTOR_AUTH_ENFORCE` on once S2 lands | Not re-checked |
| S6 | Check `isUsable` and refresh role on ordinary requests, so suspension and demotion apply before the 8-hour JWT expires | Not re-checked |
| S7 | Remove the `NEXT_PUBLIC_ENABLE_DEV_TAB` override from the server-side role gate | Still open |
| S8, S9 | Owner checks on memory purge and studio results | Not re-checked |
| P3 | Export takes a **server-held query reference** (the last executed statement of the caller's own session), not SQL from the browser | New finding |
| S12 | Fix `rejectUnauthorized: false` on the advisory-lock Postgres client | Not re-checked |
| CI | Run the unit tests in CI so an auth regression cannot ship (audit: CI builds and deploys without tests) | Not re-checked |

**Acceptance:** a non-owner gets 403 on another user's session, purge and studio results; a `member` cannot create a connection, policy or role change; a new user is not `admin`; export rejects raw SQL from the client; existing admins still work.

## 5. Target model

### 5.1 Identity and roles

Two kinds of role, kept separate:

- **Platform roles [M]** (exist today): `platform_admin`, `admin`, `member`, `readonly`. They control **features and administration**. They do **not** grant data.
- **Data roles [M]** (new): control **which data**. Starting set (adjust to your organisation):

| Data role | Typical holder | Can see |
|---|---|---|
| `data_viewer` | Executives, operations | Dashboards and governed models marked Internal |
| `analyst` | Analysts | Ask questions on Internal models; create dashboards and flows |
| `analyst_confidential` | Finance | Adds Confidential models (for example cost, budget) |
| `analyst_restricted` | Payroll, HR | Adds Restricted models (wages, crew personal data) |
| `fleet_manager` | Fleet leads | Internal models with a **row filter** on their fleet or vessels |
| `data_steward` | Data owners | Classify data, approve harvest scope and grants for their domain, author semantic definitions |
| `estate_operator` | Platform operations | Launch and monitor harvest jobs; sees metadata, not samples |
| `security_auditor` | Compliance | Read audit logs and access reports; **no data** |

Rules:
- A user can hold several roles; effective access is the union of grants, then reduced by any explicit deny.
- **[S]** Map roles to **Entra ID groups**, so HR or IT changes take effect without ALOFT admin work. Keep manual assignment for exceptions.
- **[S]** Separation of duties: the person who grants Restricted access cannot approve their own request; `platform_admin` does not get data roles automatically.

### 5.2 Resources and sensitivity labels

**Resources [M]** that grants can point to:

| Resource | Examples |
|---|---|
| Semantic model, entity, measure, dimension | `vessel_cost`, `crew_wages.amount` |
| Warehouse scope | catalog, schema, table (for raw SQL and harvest scope) |
| Estate object / column | object pages and profiles |
| Knowledge source | a document collection |
| Agent | a commissioned agent |
| Flow | a saved flow (Phase 2 of Flows) |
| Dashboard | already has its own owner/editor/viewer roles; keep and connect them |

**Sensitivity labels [M]:** one label per resource, set by a data steward, with a default for unlabelled data.

| Label | Meaning | Example | Default handling |
|---|---|---|---|
| Public | Fine to share outside | Vessel names, ports | Any role |
| Internal | Normal business data | Voyages, fuel | Default for unlabelled governed data |
| Confidential | Commercial or financial | Budgets, supplier prices | Needs `analyst_confidential` or higher |
| Restricted | Personal or regulated | Wages, crew identity, medical | Needs `analyst_restricted`; masked elsewhere; never to non-approved LLM providers |

- **[M]** Unlabelled **raw** warehouse tables are treated as Restricted until classified, so new data does not leak by default.
- **[M]** Reuse the existing estate `pii_flag` as a **suggestion** that a steward confirms; it is LLM-inferred and must not be the only control.
- **[S]** Column-level labels (a model can be Internal while one column is Restricted).
- **[G]** Purpose labels (for example "payroll processing only").

### 5.3 Grants

A grant is one row: **who** (role or user) may do **what** (`read`, `query`, `export`, `use`, `author`, `approve`, `administer`) on **which resource**, with optional **conditions**:

| Condition | Purpose | Tier |
|---|---|---|
| Row filter | Restrict rows, for example `fleet_id IN (:user.fleets)` | [S] |
| Column mask | Hide, null, hash or bucket a column (`wage` → band) | [S] |
| Expiry | Time-limited access | [S] |
| Max rows / export limit | Stop bulk extraction | [M] for export |
| Purpose / justification | Required text for Restricted access | [G] |

Design notes:
- **[M]** Grants are data in the database, edited from the app, versioned, and audited (before and after values).
- **[M]** Explicit **deny** overrides allow (needed for exceptions).
- **[S]** Row filters use **declared user attributes** (fleet, vessel list, region) maintained in the app or synced from Entra, not free SQL typed by an admin.
- **[S]** The existing `policy_entry` table (with `enforcement` `warn`) can hold global rules (provider rules, export limits), but grants deserve their own typed table; do not overload `policy_entry`'s untyped `config` JSON for grants.

### 5.4 The decision point [M]

One module, for example `src/lib/access/authorize.ts`:

```
authorize(principal, resource, action, context) →
  { allow: false, reason, requestable: boolean }
| { allow: true, rowFilters: [...], columnMasks: [...], tier: 'internal'|'confidential'|'restricted', limits: {...} }
```

- **principal**: user (with roles, attributes, status) or a machine principal (harvester, flow run "as owner").
- **context**: surface (`inspector`, `dashboard`, `export`, `flow`, `agent`, `estate`), session id, purpose.
- Pure function over loaded grants plus a small cache; cache invalidated on grant, role or label change. **[M]** A revoked grant takes effect within a defined time (proposal: 60 seconds).
- **[M]** Every deny is logged with reason. **[S]** Every allow on Restricted data is logged.
- **[S]** `explain(principal, resource)` powers "why can't I see this?" and the admin "view as user" preview.
- **[M]** Unit tests per rule type; property tests that deny always wins over allow.

### 5.5 Enforcement on every path [M unless marked]

| Path (from §3) | Enforcement |
|---|---|
| P2 Semantic query | Before compiling: `authorize` on the model and every referenced entity, measure and dimension. The compiler **injects row filters** and **applies column masks** in the generated SQL. Run on the tier's service principal (§6). |
| P1 Inspector raw SQL (`execute_tool`) | Allowed only with a `raw_sql` grant on named schemas. Before execution, parse the statement's table references and check each against grants; reject if any is unknown or not granted. Run on the tier's principal. Without the grant, the model only gets semantic tools. Row filters cannot be reliably applied to arbitrary SQL, so raw SQL on row-filtered data is **not allowed** for roles that have row filters. |
| P3 Export | Same check as the query it exports, plus an `export` action and per-role row limits; server-held query reference only; audit every export with row count. [S] watermark the file name or header with user and time. |
| P4 Connections | Administer action only (`platform_admin`); credentials never returned to the client. |
| P5 Dashboards | Each widget's query is authorized **as the viewer** (viewer's rights, not the owner's), so sharing a dashboard never widens access. A widget the viewer cannot see renders as "no access" instead of failing the whole dashboard. Sharing a dashboard that contains Confidential or Restricted widgets warns the sharer. |
| P6 Estate browse | `read` on estate objects by label. Profiles: `top_k`, `min`, `max`, `patterns` shown only to roles cleared for the object's label; for Restricted columns, never stored (§5.7). Metadata (names, types) can be visible more widely than values. |
| P7 Harvester | Separate principals for metadata and profiling (§6). Profiling scope is a **steward-approved list of schemas** stored in the app; anything else is metadata only. |
| P8 Memory | Each memory rule carries the **highest label of the data it was learned from** (requires recording which models/tables a session touched). Retrieval filters by the caller's clearance in addition to `visibility`. Restricted-derived rules are personal only. Wrap injected memory in delimited, quoted blocks marked as untrusted (audit S13). |
| P9 Knowledge base | Each knowledge source has a label and grants; retrieval filters chunks by the caller's grants **before** ranking, so restricted text never enters a prompt. |
| P10–P11 Sessions, studio results | Owner-only by default (Phase 0), plus label of the data shown in them; an admin reading another user's transcript is an audited break-glass action. |
| P12 Agents | `use` grant per agent. An agent's tools run with the **caller's** rights, never with extra rights of its own. |
| P13 LLM providers | Provider allowlist per label (§8). |
| P14 Logs | Logs that contain data inherit its label; only `security_auditor` and `platform_admin` read them; payload logging stays off, or values are redacted by label before write. |
| P16 Flows | Each run authorizes **as the owner at run time**; revoked access stops scheduled runs; outputs carry the highest label of their inputs. |

### 5.6 Admin experience in the app [M unless marked]

- **Roles screen:** list roles, members, grants; add and remove members.
- **Data access screen:** pick a role or user → see and edit grants per resource, with labels shown.
- **Classification screen** (stewards): set labels on models, entities, columns, estate objects, knowledge sources; review `pii_flag` suggestions.
- **Harvest scope screen** (stewards): approve schemas for profiling.
- **[S] View as user:** see what a given user can access, and simulate a change before saving.
- **[S] Access requests:** users request access from a "no access" message; the resource's steward approves; grants can be time-limited.
- **[G] Access reviews:** periodic campaigns where owners confirm or remove access.
- Every screen writes `writeAudit` entries with before and after.

## 6. Service principals (Databricks side) [M]

ALOFT already authenticates to Databricks with OAuth machine-to-machine credentials per connection (`auth_type = oauth_m2m`, secret in AWS Secrets Manager; [token-client.ts](../src/lib/databricks/token-client.ts)). Each principal below is one more connection record using the same mechanism.

| Principal | Used by | Databricks rights (to confirm with your Unity Catalog admin) |
|---|---|---|
| `sp-estate-metadata` | Harvest structural tier | Metadata only on all catalogs (browse / `USE CATALOG` / `USE SCHEMA`), **no `SELECT`** |
| `sp-estate-profile` | Harvest profiling tiers | `SELECT` on steward-approved schemas only |
| `sp-query-internal` | Inspector, dashboards, flows for Internal data | `SELECT` on Internal schemas or views |
| `sp-query-confidential` | Same, Confidential | Adds Confidential schemas |
| `sp-query-restricted` | Same, Restricted | Restricted schemas only; used only when `authorize` returns tier `restricted` |
| `sp-admin` | Platform administration (testing connections) | Minimal; **no** blanket data access |

- **[M]** The query path selects the principal from `authorize(...).tier`. Today `resolveToolCatalogEntry('')` returns a single connection for everyone; that becomes tier-based.
- **[M]** No user ever receives a Databricks token.
- **[S]** A separate SQL warehouse per principal to cap cost and isolate load.
- **[S]** Unity Catalog **row filters and column masks** on Restricted tables as a second line under ALOFT's own masks.
- **[G]** Per-user identity pass-through (each user's own Databricks identity). Strongest, but a large platform project; consider only if auditors require it.
- Limit: anyone with direct warehouse access bypasses ALOFT entirely. That is governed in Databricks, not here.

## 7. Derived data and label propagation [M]

This is the part most often missed. Data rarely leaks from the query that read it; it leaks from what was **made from** it.

- **Rule:** any stored artefact gets the **highest label of its inputs**: estate profiles, cached results (`studio_query_results`), dashboard snapshots, memory rules, flow outputs, exports, chat transcripts, LLM logs.
- **Mechanism:** the query path returns the tier it ran at; callers that store results record it next to the stored row. Session transcripts track the highest tier touched.
- **Restricted columns:** never store `top_k`, `min`, `max` or `patterns` in estate profiles; store only null rate and distinct estimate. Apply at profiling time, not as a later scrub, so there is no window of exposure.
- **Embeddings** of Restricted text are Restricted; do not embed Restricted values for search (the estate embed code already checks `isPii`; extend it to labels).
- **[S]** Downgrading a label is a steward action that is audited and does not retroactively declassify derived artefacts.

## 8. AI-specific safety [M unless marked]

1. **Provider allowlist per label.** For example: Restricted → Bedrock models in your AWS region only; Confidential → Bedrock; Internal → Bedrock, or xAI / Azure OpenAI if approved. Enforced in the provider factory (`src/lib/inspector/providers/factory.ts`) using the session's highest tier. The organisation must decide whether xAI or Azure OpenAI may receive any business data at all (§11).
2. **Context minimisation.** Send the model only what it needs: masked columns stay masked in prompts; row caps on results passed to the model; no samples of Restricted columns in schema descriptions.
3. **Prompt-injection containment.** Data and memory enter prompts as clearly delimited, quoted, untrusted blocks; tools that act (export, notify, write) are never callable as a direct result of text found in data without the user's explicit request or an approval step; agent tools are allowlisted per agent.
4. **Tool rights = caller's rights.** The model never holds more access than the user who triggered it.
5. **[S] Output checks.** Before showing or storing a model answer, check it does not contain values from columns the user is not cleared for (cheap check: masked column values never present in the context, so they cannot be echoed).
6. **[S] Model and prompt change control.** Changing a system prompt or model for an agent that touches Restricted data needs review.
7. **[G] Evaluation set for leakage.** Prompts that try to extract restricted data or override instructions, run on every model or prompt change.

## 9. Audit, monitoring and incident response

- **[M]** Audit events (using existing `writeAudit`): `access.grant.created|changed|removed`, `access.role.assigned|removed`, `access.denied`, `access.label.changed`, `data.export`, `data.restricted.read`, `breakglass.used`, `harvest.scope.changed`, `connection.changed`.
- **[M]** Audit log readable by `security_auditor`, append-only, retained per policy (§10).
- **[S]** Reports: who can access Restricted data; grants expiring; users with no login in 90 days; largest exporters.
- **[S]** Alerts: export above a threshold; burst of denials from one user; break-glass use; new connection created; label downgraded.
- **[S]** Break-glass: time-boxed, reason required, notifies security, fully audited.
- **[M]** Incident runbook: how to revoke a user immediately (suspend + session invalidation, see S6), rotate a service principal secret, find what a user accessed in a period.

## 10. Retention and deletion [S, M for Restricted]

| Data | Proposal |
|---|---|
| Audit log | ≥ 1 year (confirm with compliance) |
| Tool / turn logs | 90 days (exists for tool log) |
| Session transcripts, studio results | 180 days, or per policy; Restricted-touched sessions shorter |
| Exports | Not stored server-side beyond the download |
| Memory rules | Reviewed when sources are deleted; Restricted-derived rules expire |
| LLM payload logs | Off by default; if on, label-redacted and ≤ 30 days |

**[M]** A deletion request (for example a crew member's personal data) must reach derived copies: profiles, memory, knowledge chunks, cached results.

## 11. Written policies the organisation needs

The application enforces policy; it cannot invent it. Each policy needs an owner and a decision before the related phase.

| Policy | Must say | App enforces via | Tier |
|---|---|---|---|
| Data classification | The four labels, examples, who classifies, default for new data | Labels, unlabelled = Restricted for raw | [M] |
| Access control | Who approves access per label, separation of duties, default role for new users | Roles, grants, approvals | [M] |
| Raw SQL | Who may use raw SQL, on which schemas, why | `raw_sql` grants | [M] |
| Export | Who may export, limits, where files may go | Export action, limits, audit | [M] |
| AI usage | Which providers may receive which labels; whether xAI and Azure OpenAI are allowed; no Restricted data to external providers | Provider allowlist | [M] |
| Retention | Periods per data type, deletion requests | Retention jobs | [S] |
| Access review | Frequency, who reviews | Review campaigns | [S] |
| Incident response | Who to call, revoke steps, notification duties | Runbook, audit queries | [M] |
| Acceptable use | What users may not do (sharing exports, prompting for others' data) | Login notice, audit | [S] |

## 12. Build plan

### Phase 0 — close the holes [M]
§4 in full. Prerequisite for everything else.

### Phase 1 — deny by default with model-level grants [M]
1. Tables: data roles, grants, labels, user attributes; seed the starting roles; migration of existing users to explicit roles.
2. `authorize()` with cache, deny logging, tests.
3. Enforce on the semantic path (P2), dashboards as viewer (P5), export (P3), Inspector raw SQL gated (P1), connections (P4), sessions owner-only (P10–P11).
4. Service principals per tier (§6); tier-based connection selection.
5. Labels on semantic models and estate objects; unlabelled raw = Restricted.
6. Admin screens: roles, data access, classification.
7. Provider allowlist per label (§8.1).
8. Audit events (§9) and the incident runbook.

**Exit:** a `data_viewer` cannot query, export or see a Restricted model through any path (Inspector, dashboard, export, estate, memory, agent); every denial is logged; revoking a grant takes effect within the target time.

### Phase 2 — fine-grained and derived data [S]
Row filters and column masks in the semantic compiler; user attributes (fleet, vessels); label propagation to memory, knowledge base, cached results and estate profiles (§7); profiling never stores values for Restricted columns; view-as-user preview; access requests with approval and expiry; Entra group sync; Unity Catalog masks on Restricted tables.

### Phase 3 — operations and assurance [S/G]
Access reviews, reports and alerts, break-glass, retention jobs, leakage evaluation set, output checks, purpose-based access, compliance exports.

### Dependency on Flows
Flows' `query` step must not reach production before Phase 1 exit criteria are met ([flows-architecture.md](flows-architecture.md) §12).

## 13. Testing

| Test | Proves |
|---|---|
| Matrix test: for each data role × each path (P1–P16) × each label | Allowed paths return data; denied paths return 403 or "no access", never data |
| Row filter test | A fleet manager's results contain only their fleet, including in totals and charts |
| Mask test | Masked columns never appear in results, exports, prompts or logs |
| Derived-data test | A memory rule learned from a Restricted session is not retrieved for a `data_viewer` |
| Dashboard sharing test | Sharing a Restricted dashboard org-wide does not reveal Restricted widgets to viewers |
| Revocation test | Access stops within the target time, including for an existing session and a scheduled flow |
| Privilege escalation tests | A user cannot grant above their own rights; cannot approve their own request |
| Provider test | A Restricted session cannot be routed to a non-approved provider |
| Injection test | Text in data or memory cannot trigger an export or change tools |
| Regression in CI | All of the above run on every change |

## 14. Rollout

1. Phase 0 fixes, then a **role review** of existing users (most are `admin` today because of S1).
2. Ship Phase 1 in **observe mode**: `authorize` runs everywhere, logs what it would deny, and allows. Review the logs for one to two weeks with stewards. The repository already used this pattern for `INSPECTOR_AUTH_ENFORCE`.
3. Fix grants based on the logs; communicate to users; switch to **enforce** per surface (estate first, then dashboards, Inspector, export).
4. Keep a fast rollback switch per surface during the first weeks.

## 15. Decisions needed

| # | Decision | Needed by | Proposal |
|---|---|---|---|
| 1 | Who owns data classification and approves access per domain? | Phase 1 | Named data steward per domain |
| 2 | Default role for new users | Phase 0 | `readonly`, no data role |
| 3 | Granularity of first release | Phase 1 | Model-level + labels; rows and masks in Phase 2 |
| 4 | Raw SQL: who and where | Phase 1 | Data stewards on approved schemas only; nobody on Restricted |
| 5 | May xAI, Azure OpenAI (or any provider outside AWS) receive business data? | Phase 1 | No for Confidential and Restricted; decide for Internal |
| 6 | Entra groups as source of roles? | Phase 2 | Yes, with manual exceptions |
| 7 | Who has Unity Catalog admin rights to create principals and grants? | Phase 1 | Name the owner; it gates §6 |
| 8 | Which catalogs and schemas are Confidential and Restricted? | Phase 1 | Steward-supplied list |
| 9 | Retention periods | Phase 3 | §10 proposals |
| 10 | Dashboards evaluated with viewer's rights (proposed) or owner's rights? | Phase 1 | Viewer's rights |

## 16. Limits of this document

- Static reading only; nothing was run. Findings S5, S6, S8, S9, S12 and CI were not re-checked today.
- Deployment settings (for example whether `INSPECTOR_AUTH_ENFORCE` is on, whether the Entra app is limited to a group) are **unverified**.
- Unity Catalog privilege names in §6 need confirmation by your Databricks administrator.
- Legal and regulatory requirements (for example data protection law applying to crew data) are not assessed here and should be reviewed by compliance.
