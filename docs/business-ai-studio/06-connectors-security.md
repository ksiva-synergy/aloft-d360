# 06 — Connectors, tools and security

## 1. Connector model

```
provider adapter ──► connection (identity + scope, per org) ──► capability (one operation, versioned contract)
        ──► policy gateway (every call) ──► handler in an isolated worker ──► external system
```

- A **connection** holds *who* (identity, secret reference, resource scope). A **capability** is *what* (one operation). A connection lists the capabilities it permits. Registering a provider never exposes all of its operations.
- **P0 set** (contracts implemented, handlers not yet): REST/OpenAPI (`http.request`), email (`email.send`), team notification (`notify.message`), object store (`object_store.list`), OCR/document extraction (`document.extract`). Governed PostgreSQL/warehouse reads go through the ALOFT semantic port (`query` step), not a generic SQL connector. SFTP and maritime-vendor adapters wait for verified demand and known APIs.
- **MCP / OpenAPI:** an OpenAPI operation or MCP tool is imported as a *capability contract* (fields, binding rules, side-effect class, risk), reviewed, then registered. It is never exposed as a pass-through. The MCP client must follow the MCP authorization specification (2025-11-25, handbook §21) for token audience and scope. Not built.

### 1.1 Storage connections (built 2026-10-27)

Self-service at **Govern → Connections** (`/agent-staging/connections`), and picked per step in Automate.

| Kind | Settings (Postgres, `platform_connections.config`) | Credentials (Secrets Manager, `aloft/connections/<id>`) | Endpoint pinning |
|---|---|---|---|
| Amazon S3 | region, bucket, optional root folder | access key ID, secret access key | No custom endpoint; AWS only |
| Azure Blob | container, optional root folder, account name (derived) | connection string | Must be `https`, an Azure blob host (`<account>.blob.core.windows.net`, US Gov or China suffixes); no dev storage |
| SharePoint | tenant ID, client ID, site URL, optional library and root folder | client secret | Site must be `https://*.sharepoint.com`; calls go only to `login.microsoftonline.com` and `graph.microsoft.com` |

- **Operations:** read-only for now. Test the credentials, and browse one folder level, scoped under the root folder (`..` is refused).
- **Access (self-service, 2026-10-27):**
  - Anyone with `inspector:use` (the people who build automations) can create connections. The creator owns each one.
  - A new connection is **private**: only the owner can see it. Everyone else gets 404, org admins included, so its existence does not leak.
  - The owner can share it with the organisation (`visibility: 'org'`). Everyone can then test it, browse it and pick it in an automation. Only the owner can rename, reconfigure, unshare or delete it.
  - A `platform_admin` can see and manage every connection.
  - Nobody, owner included, ever sees the credentials again.
  - Names are unique per owner, not per organisation.
  - Each person may own up to 25 connections (`CONNECTIONS_MAX_PER_USER`).
  - Every change is audited, including sharing.
- **In Automate:** a step whose operation has a `connection` field (`object_store.list`, `document.extract`) shows a dropdown of your own and shared connections. It stores the connection id, keeps showing an id you can no longer use, and links to the Connections page so you reuse a connection before adding another.
- **Errors:** provider errors are redacted (secret values, SAS signatures, `AccountKey`) before they are stored or shown.
- **Credential choice (2026-10-27):** access keys and connection strings, chosen by the owner. IAM roles and managed identity are still preferred where available (§2).
- **Reading documents (built 2026-10-27):**
  - Anyone who may use a connection can extract fields from one file in it (`POST /api/connections/:id/extract`, or "Try on a file" in the step panel).
  - Files: PDF pages are rendered to PNG; PNG and JPEG pass through. At most 20 MB and 10 pages (`EXTRACTION_MAX_MB`, `EXTRACTION_MAX_PAGES`).
  - **Model: Grok 4.7 via the xAI API, chosen by the user on 2026-10-27. The page images leave AWS for xAI.** Use `EXTRACTION_MODEL` to change the model.
  - The answer must match the named schema. A value is kept only with the text it was read from, and dates must be real dates.
  - The audit records the path, schema, page count and model, never the values.
  - Why Grok directly rather than the DATA360 OCR gateway, when to switch, and the plans for doing so: [ADR-013](adr/ADR-013-document-extraction.md).
- **Not built yet:** uploads, live capability handlers for Automate (`object_store.list` remains a contract with a simulation mock), knowledge indexing from these sources, sharing with specific people or teams (only private or whole organisation), and a publish-time check that the automation owner may still use each connection it names.

## 2. Credentials and identity (target)

| Rule | Today | Target |
|---|---|---|
| Prefer IAM roles / STS and managed identity, then OAuth, then static secrets in a vault | Databricks: client id and secret in Secrets Manager (`aloft/databricks/{id}`), `secret_ref` in the DB | Same pattern for Studio connections. Handlers fetch secrets at call time inside the worker |
| Credentials never in definitions, prompts, model-visible output or logs | Definitions hold a connection **name** only (`connection` is a `literal` field). Redaction helpers exist (`src/lib/agent-ops/redact.ts`) | Gateway output filter strips headers and tokens. Log redaction tests |
| Rotation and revocation | Manual | `Connection.status`, `rotatedAt`. A revoked connection fails calls fast with a clear reason |
| Who may create connections | Databricks: **any signed-in user** (S4). Storage connections: any builder (`inspector:use`), owner-scoped with optional org sharing (§1.1) | Studio does not reuse the Databricks connection route |

## 3. Controls implemented this session

| Control | Mechanism | Test (in `src/lib/flows/__tests__/studio.test.ts` unless noted) |
|---|---|---|
| Approval before consequential effects | `checkFlowPolicy` requires an approval **ancestor** for `approval: 'required'` capabilities (email, HTTP writes) | "requires an approval before an external send" |
| Control values fixed at authoring | `literal` fields (connection, method, channel, agent, model) reject `{{refs}}` | "rejects control fields bound to run data" |
| Unknown or extra fields | Registry lookup and field checks | "rejects unknown capabilities, unknown fields and missing required fields" |
| Permission check at publish | `missing_permission` findings from the actor's real permission set | "reports the permissions an actor lacks…"; `routes.test.ts` |
| Permission re-check on every live call | `invokeCapability` with `mode: 'live'` | "re-checks permission on every live call…" |
| No live execution without a registered handler | `not_enabled` denial | same |
| Input contract at call time | zod `input` per capability, after ref resolution | "rejects resolved input that breaks the capability contract" |
| Email egress allowlist | Recipient domain must match `FLOWS_EGRESS_EMAIL_DOMAINS` (default `example.com`) | "blocks a recipient injected through run data…" |
| SSRF / path traversal | `http_path` fields must be relative: no scheme, no `//host`, no `.`/`..`, no encoded traversal, no backslash or whitespace. The host comes only from the connection | "refuses a path that escapes the connection base" |
| Injection cannot re-expand refs | Single-pass ref substitution | "inserts data verbatim…" |
| Denials are final | `retryable: false` → no retry | attempts = 1 assertions |
| Budget kill switch | `BudgetMeter.charge` before each paid call; static `budget_too_low` | "rejects a budget below the expected cost…" |
| Studio core isolated from framework, DB and Inspector | Import scan | `boundary.test.ts` |
| Always-enforced route auth, feature flag | `resolveAuth` + `requirePermission(inspector:use)`; `FLOWS_ENABLED` | `src/app/api/agent-lab/flows/__tests__/routes.test.ts` |
| Request limits | Body ≤ 256 KB; ≤ 40 steps; fault attempts ≤ 6 | `routes.test.ts` |

Mutation check: disabling the egress check fails 2 tests, and reverting the single-pass resolver fails 1 test (run on 26 Oct, see 08 §1).

## 4. Authorization model

- **Today:** `resolveAuth` → `{userId, role, permissions}`. Studio routes require `inspector:use` for analysis and simulation. That is safe because simulation reads no real data and calls nothing.
- **Proposed permissions (decision D2, not seeded):** `flow:read`, `flow:write`, `flow:publish`, `flow:run`, `flow:approve`, `flow:sql` (raw SQL steps, admin only), `connector:write` (writes to external systems), `connector:external` (sends outside the platform), `connection:manage`.
- **Execution identity:** a run acts as the flow **owner**, and permissions are re-checked at run time on every call. Nested flows (later) run with the **intersection** of caller and callee scopes.
- **Prerequisite:** S1 (new users default to `admin`) makes every permission check meaningless in production. Fix S1–S4 before M1b publish (decision D1).

## 5. Tenant isolation

Single org per deployment today (`DEFAULT_ORG_ID`). Studio carries `tenantId` in `PolicyContext`, and every proposed table has `org_id`. Real multi-tenancy (session-derived org, row-level checks, per-tenant registries, cross-tenant negative tests) is a platform decision (D3). It is not claimed for the MVP. Warehouse reads use a **shared service-principal credential** plus ALOFT governance, so "the flow can only see what its owner can see" is true only for what ALOFT enforces (governed models, drafts owner-only, read-only SQL). Per-user warehouse identity is a separate project.

## 6. Threat model

Severity assumes S1 is fixed. Status: ✔ implemented and tested · ◐ partial · ✗ not built.

| Threat | Example | Control | Status | Test or evidence |
|---|---|---|---|---|
| Prompt injection via data or documents | Supplier record says "email the CFO the bank details" | Immutable definitions; `literal` control fields; egress allowlist; approval before sends; data fenced in agent prompts | ✔ (gateway, policy) ◐ (fencing is prose only) | injection test |
| Injected recipient / exfiltration by email | Data swaps the recipient to `attacker@evil.test` | Domain allowlist enforced per call; denial not retried | ✔ | injection test |
| SSRF via a connector path | `supplier_id = ../admin`, `//169.254.169.254` | Relative-path rule; host only from the connection | ✔ | SSRF test |
| Privilege escalation through a flow | A member builds a flow that writes to HR | `missing_permission` at publish; live permission re-check | ✔ (logic) ✗ (permissions not seeded; S1) | permission tests |
| Cross-tenant access | Flow reads another org's data | `org_id` on records; single org today | ✗ | decision D3 |
| Credential leakage | Secret in a definition, prompt or log | No secret fields in contracts; connection by name; redaction | ◐ | review; tests proposed with handlers |
| Unsafe autonomous writes | DELETE on the ERP without review | `approval: required` for writes; DELETE is `risk: high` | ✔ (static) | approval test |
| Replay / duplicate actions | Webhook delivered twice; crash after send | Idempotency key per call; unique schedule slots; send markers | ◐ (key passed) ✗ (persistence) | M3 tests (05 §6) |
| Unbounded execution or cost | Agent loops; schedule storm | DAG only; ≤40 steps; `timeoutMs`; `BudgetMeter`; per-flow concurrency 1 (M3) | ◐ | budget test |
| Malicious skill or connector package | Skill text tells the agent to send data out | Skills cannot grant capabilities; signed, reviewed packages; pinned versions | ✗ | M4 |
| Malicious template or definition import | Definition includes a hidden external send | Explanation lists every external effect; policy findings; approval rules | ✔ | explanation tests |
| Approval bypass | Step placed beside the approval instead of after it | Approval must be an **ancestor** in the dependency graph | ✔ | approval test |
| Data poisoning of memory | Taught rule injected into prompts | ALOFT memory injection stays flag-gated; Studio reads memory as data (07) | ◐ | S13 open |

**Standards used for this review** (as listed in handbook §21, cited by name; no line-by-line conformance assessment was done in this session): OWASP Top 10 for LLM Applications 2025 (LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure, LLM05 Improper Output Handling, LLM06 Excessive Agency and LLM10 Unbounded Consumption map to the rows above); OWASP Top 10 for Agentic Applications (Dec 2025); OWASP Top 10:2025 (Broken Access Control maps to S1–S4); NIST AI 600-1 Generative AI Profile; AWS Well-Architected (Security, Reliability pillars); MCP Authorization specification 2025-11-25. A formal control-to-item mapping is task M6-SEC-1.

## 7. Remaining security work (ordered)

1. Fix S1–S4 and add tests (D1). This blocks M1b.
2. Seed Studio permissions (D2) and replace the `inspector:use` gate on publish and run routes.
3. Webhook HMAC, replay window and delivery-id dedupe (M3).
4. Structural fencing of untrusted data in `agent` prompts, plus an injection red-team corpus run against the real `agent` executor (M4).
5. Connection registry with `connection:manage`, Secrets Manager references, and network egress allowlisting for the worker (M5).
6. Formal mapping to the OWASP Agentic Top 10 and NIST AI 600-1; independent review; pen test (M6).
