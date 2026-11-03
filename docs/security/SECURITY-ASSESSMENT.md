# ALOFT D360 — Security Assessment (2026-11-01)

**Scope:** `aloft-ui-redesign` working tree. This covers the Next.js 16.4.2 API (190 `route.ts` handlers), `src/proxy.ts`, `src/lib/**`, the Vite SPA (`web/`), `packages/`, `prisma/`, `scripts/`, `infra/`, both Dockerfiles, `.github/workflows/` and `next.config.ts`.

**Method:** a static, evidence-based review: grep and manual reading of the code paths, plus `npm audit` (full and `--omit=dev`). There was no dynamic testing, no testing against any deployed environment, and no network scanning. Findings F1–F3 were re-verified by hand against source and `node_modules/next-auth`.

**Machine-readable register:** [findings.json](./findings.json).

> This report does not claim the application is secure. Areas listed in §11 were not assessed, or were assessed only partially.

> **Remediation status (2026-11-04):** see §12. All findings have code or config fixes except the zod 4 upgrade (D1), which is deferred. Regression tests: `src/app/api/__tests__/security-hardening.test.ts`.

---

## 1. Executive summary

**Authentication is strong.**
- `src/proxy.ts` requires a NextAuth JWT on every `/api/**` route except `/api/auth/*` and `/api/health`.
- Entra SSO uses tenant-pinned OIDC with next-auth state/PKCE/nonce, and accounts are linked by `oid`.
- `resolveAuth` validates Entra Bearer tokens via JWKS (aud/iss/exp).
- Containers run as non-root, CI uses GitHub OIDC with branch-scoped trust, and no secrets are committed.

**Authorization is the main weakness.** The proxy only proves that *some* tenant user is signed in. Every Entra user in the tenant is auto-provisioned as `member` (`src/lib/rbac.ts:205`). Of the 190 handlers:
- 87 check only that a session exists.
- 26 do no auth check of their own and rely on the proxy.
- 10 use an ownership guard that by default only logs (`INSPECTOR_AUTH_ENFORCE` unset).

As a result, an ordinary member can:
- read and delete other users' workbench sessions by spoofing the `x-user-id` header (**F1, High**);
- rewrite the org-wide memory rules that are injected into every user's LLM system prompt (**F2, High**, stored prompt injection);
- publish catalog agents without admin review (**F3**);
- read or poison other users' query results (**F5**);
- trigger costly harvest, ECS and Bedrock workloads that are meant for platform admins only (**F7**).

**Current security confidence: Moderate-Low** for multi-user integrity and confidentiality *inside* the tenant. It is **Moderate-High** against anonymous external attackers, given the proxy gate, assuming infrastructure behaves as configured.

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 2 (F1, F2) |
| Medium | 7 (F3–F8, F10) + D1 |
| Low | 6 (F9, F11–F16) |
| Info | 1 (F17) |

---

## 2. Attack surface inventory

### Entry points
| Surface | Notes |
|---|---|
| `/api/**` (190 handlers) | Gated by `src/proxy.ts` (`getToken` = cookie **or** `Authorization: Bearer <next-auth JWE>`) |
| `/api/auth/*` | NextAuth (AzureAD + optional Credentials provider) |
| `/api/health` | Public; returns `{ok:true}` only |
| Static SPA (`web/`) | Vite build, served by Next; `sourcemap: false` |
| ECS harvester (`Dockerfile.harvester`, `scripts/context/orchestrator.ts`) | Launched by API via `RunTask`; argv is server-generated |
| GitHub Actions (`ecr-push.yml`, `oidc-diagnose.yml`) | OIDC → AWS; push to main/develop + manual dispatch |

### Route authorization classes (all 190)
| Class | Count |
|---|---|
| Public by design | 2 |
| Role/permission enforced (`requireRole`, `requirePermission`, pipeline-operator gate) | 33 |
| AuthN + per-object/permission checks (`resolveAuth`, `authenticateSession`, `getAgentOpsAuth`) | 30 |
| Ownership guard, always enforced | 2 |
| Ownership guard, **observe-only by default** | 10 |
| **Session check only** — no role/object authZ | 87 |
| **No handler auth** — proxy only | 26 |

The route lists for the high-risk classes are in [findings.json](./findings.json) → `routeInventory`.

### Sensitive assets
- Databricks warehouse data, reached through one shared service principal (`docs/data-access-control-design.md`).
- Bedrock and ECS spend.
- Org memory rules and HARD_RULEs, which are injected into prompts.
- The agent catalog, including published agents and their tools.
- User sessions and query results.
- The User/role tables.
- Secrets Manager `aloft/*`.

### Trust boundaries
1. Browser → proxy: authentication only.
2. Proxy → handler: per-handler authorization, applied inconsistently.
3. Handler → LLM: memory, agent instructions and tool configs become trusted prompt content.
4. Handler → ECS/Databricks/Bedrock: a shared service identity.
5. CI → AWS: OIDC.

---

## 3. Security architecture assessment

**Existing controls that work**
- The proxy gate covers every API route except auth and health.
- `resolveAuth`/`authenticateSession` validate Entra JWKS and re-check `isUsable`.
- `canManageRole` prevents role escalation on role assignment and user delete.
- Flows, connections, knowledge, runs, agent chats and dashboards have correct per-object checks.
- Databricks SQL is forced read-only and single-statement (`src/lib/databricks/execute.ts:126`).
- Connection secrets live in Secrets Manager and are never returned to clients.
- All `$queryRawUnsafe` calls are parameterized or use constants.
- Uploads use `safeFileName`, `Content-Disposition: attachment` and `nosniff`.
- Writes to users and roles are audited, and login events are recorded.

**Missing or weak controls (architectural)**
1. **No central authorization layer.** Each handler chooses its own pattern from 6 different auth helpers, and 113 handlers have no role or object check.
2. **Identity is derived inconsistently.** `getServerSession` reads cookies only, while the proxy also accepts Bearer tokens. Header fallbacks (`x-user-id`) exist.
3. **Session ownership is a feature flag** (`INSPECTOR_AUTH_ENFORCE`) rather than a default.
4. **LLM-context integrity is not protected.** Org memory, agent instructions and tool configs, all of which reach the prompt, are writable by any member.
5. **No rate limiting or quotas** on LLM, harvest or credentials-login endpoints.
6. **No security response headers** (CSP, frame-ancestors, HSTS).
7. **Revocation lag:** the JWT lasts 8 h and the proxy does not re-check `isUsable`.

---

## 4. Vulnerability register

Status key: **C** = confirmed by code; **U** = plausible but unverified (needs environment access).

| ID | Sev | Conf | CWE | Title | Location | Status |
|---|---|---|---|---|---|---|
| F1 | High | 9 | 290/639 | `x-user-id` header spoofing → read/delete any user's workbench sessions | `src/app/api/agent-lab/workbench/sessions/route.ts:17,93-100` | C (manually re-verified) |
| F2 | High | 8 | 285/1427 | Any member can edit/approve/retire/delete org memory rules injected into all prompts; purge any session trace | `agent-lab/memory/[id]/curate/route.ts`, `memory/[id]/route.ts`, `memory/purge-session/route.ts`; sink `src/lib/memory/retrieve.ts` | C (manually re-verified) |
| F3 | Med-High | 8 | 863 | Catalog review `approve` publishes any agent; no auth; `author` spoofable | `src/app/api/catalog/agents/[id]/review/route.ts:20-45` | C (manually re-verified) |
| F4 | Medium | 8 | 915/285 | Tool catalog writable by any member; mass assignment (`data: body`) | `catalog/tools/route.ts:38-47`, `catalog/tools/[id]/route.ts:21-55` | C |
| F5 | Medium | 8 | 639 | Studio results IDOR (read + inject results into any session) | `src/app/api/studio/results/route.ts:22-53,55+` | C |
| F6 | Medium | 8 | 285/639 | Session ownership observe-only unless `INSPECTOR_AUTH_ENFORCE=true` (10 routes incl. construction, export, chat) | `src/lib/inspector/session-auth.ts:122-139` | C (prod value U) |
| F7 | Medium | 8 | 285/400 | Harvest/ECS/Bedrock jobs triggerable by members, bypassing `pipeline-access` gate; no LLM quotas | `agent-lab/context/sources/[id]/harvest`, `objects/[id]/reharvest-all`, `inspector/boost/*`, `semantic/[modelId]/blueprint` … | C |
| F8 | Medium | 7 | 269 | `admin` can suspend `platform_admin` (status branch skips `canManageRole`) | `src/app/api/users/[id]/route.ts:94-113` | C |
| F9 | Low-Med | 8 | 639 | Chart DELETE IDOR | `src/app/api/inspector/charts/[chartId]/route.ts:44-63` | C |
| F10 | Medium | 7 | 307 | Credentials login on by default; no throttle/lockout; bypasses Entra MFA | `src/lib/auth-credentials.ts:10`, `src/lib/auth.ts:100-115` | C (prod value U) |
| F11 | Low-Med | 8 | 613 | Disabled/downgraded users keep access ≤ 8 h on routes using the proxy or `getServerSession` | `src/lib/auth.ts:243-292`, `src/proxy.ts` | C |
| F12 | Low | 6 | 918 | Internal URL built from request Host, with cookie forwarding | `agent-lab/context/silo/scan/route.ts:66-70`, `silo/links/[id]/route.ts:97` | U |
| F13 | Low | 9 | 1021/693 | No CSP / X-Frame-Options / HSTS / Referrer-Policy | `next.config.ts:25-30` | C |
| F14 | Low/Info | 8 | 862 | Telemetry/catalog metadata readable by all; `marcus/reflections/[id]` PATCH open | audit-log, inspector/performance, digest, … | C |
| F15 | Low | 8 | 489 | `NEXT_PUBLIC_ENABLE_DEV_TAB` overrides a server-side role gate | `src/lib/agent-ops/role-gate.ts:3` | C (prod value U) |
| F16 | Low | 8 | 1357/494 | Actions pinned to mutable tags; images not digest-pinned; `npm install tsx` outside lockfile; `:latest` deploy tag | `.github/workflows/*`, `Dockerfile*`, `infra/beanstalk/Dockerrun.aws.json:4` | C |
| F17 | Info | 7 | 209 | 17 routes echo `err.message` to clients | e.g. `databricks/connections/[id]/execute`, `jobs/launch` | C |
| D1 | Medium | 7 | 1395 | Prod deps: `zod@3.25.76` (memory DoS; fix ≥4.6.6), `fast-uri@3.1.3` via ajv (host confusion), `brace-expansion`, `source-map-js` | `package-lock.json` | C (reachability U) |

### Key finding detail

**F1: `x-user-id` spoofing**
```ts
const session = await getServerSession(authOptions);           // cookie only
const userId = session?.user?.id ?? request.headers.get('x-user-id') ?? 'anonymous';
```
The proxy's `getToken` also accepts `Authorization: Bearer <session JWE>` (`node_modules/next-auth/jwt/index.js:83-85`). An attacker therefore sends their own token as a Bearer header with **no cookie**. The proxy lets the request through, `session` is null, and `x-user-id` decides whose sessions are listed (GET) or deleted (DELETE). Victim user IDs leak through `GET /api/catalog/agents` (`owner_id`) and other listings.

**F2: stored cross-user prompt injection**

`POST /api/agent-lab/memory/{id}/curate {action:'edit', ruleText}` checks only that a session exists and that the row belongs to the org. It can overwrite a `HARD_RULE` or an org-visible bullet. `src/lib/memory/retrieve.ts` then places that bullet in every user's system prompt as a trusted rule. Retire, approve, DELETE and purge-session also let a member silently remove guardrails or destroy trace evidence.

**F3: governance bypass**

The review POST has no auth and takes `author` from the request body. `status:'approve'` sets `agent_catalog.status='published', is_head=true`. Combined with fork (allowed for members) and workbench edits, a member can publish an agent with arbitrary instructions or tools to everyone. `agents/chat` then runs it by slug.

The remaining findings are detailed in [findings.json](./findings.json) (attack scenario, impact, fix and regression test for each).

---

## 5. Authentication and authorization assessment
- **OIDC:** AzureAD provider with a tenant-specific `wellKnown`. next-auth applies state, PKCE and nonce. There is no custom `redirect` callback (same-origin default), and `callbackUrl` is hard-coded, so there is no open redirect. Accounts are linked by `oid`, and an email collision raises `AccountLinkRequiredError`, which prevents nOAuth-style takeover.
- **Cookies:** next-auth defaults: HttpOnly, SameSite=Lax, and Secure plus the `__Secure-` prefix when `NEXTAUTH_URL` is https. *Production `NEXTAUTH_URL` was not verified.*
- **Bearer:** Entra RS256 tokens are validated (JWKS, aud, iss, exp). Minor: ID tokens are accepted because `aud == clientId`.
- **Sessions:** stateless JWT lasting 8 h with no server-side revocation (F11). The role is refreshed only on `trigger` events.
- **Password login:** bcrypt cost 12. It is on by default with no lockout or rate limit (F10).
- **Authorization:** see §2. The issues are horizontal IDOR (F1, F5, F6, F9), vertical/function-level gaps (F2, F3, F4, F7, F14) and a privilege-hierarchy gap (F8).

## 6. API and data security assessment
- **Injection:** no exploitable SQL injection was found. Raw SQL is parameterized or interpolates constants, and Databricks access is read-only and single-statement. No `eval` or `new Function` on user input. The harvester `spawn` uses argv and `shell:true` only for local Windows development.
- **SSRF:** connection providers allow-list or validate hosts, and model-config test uses a fixed base URL. F12 remains a residual risk.
- **XSS:** `dangerouslySetInnerHTML` is used only for static CSS. There is no CSP for defence-in-depth (F13).
- **CSRF:** JSON POST/PATCH/DELETE plus SameSite=Lax gives low risk. GET handlers were not exhaustively checked for side effects.
- **CORS:** none configured, so same-origin only.
- **Mass assignment:** F4 (`catalog/tools`).
- **Excessive data exposure:** F14, plus `memory/browse` returning personal bullets and `sourceSessionIds` without a visibility filter (this enables F5/F6).
- **Rate limiting:** none, anywhere.
- **Data isolation:** single tenant. Warehouse access goes through one shared principal with no per-user grants, which is a known design limitation documented in `docs/data-access-control-design.md`.

## 7. Infrastructure and dependency findings
- **Containers:** non-root (`USER nextjs`, `USER node`). `.dockerignore` excludes `.env*` and no secrets are baked in. Images are not digest-pinned (F16).
- **ECS:** secrets come in through `valueFrom` from Secrets Manager. `secrets-policy.json` is scoped to `secret:aloft/*`, but `task-definition.json:42` references `secret:ALOFT-…`, which falls outside that scope. That is a functional mismatch, not a vulnerability; please confirm.
- **CI:** OIDC with no static keys, `permissions: id-token: write, contents: read`, no `pull_request_target`, and trust scoped to the main/develop refs. Actions are tag-pinned rather than SHA-pinned (F16). The deploy policy uses `Resource:"*"` for ECR auth/push, EB and describe actions; it could be scoped to the specific ARNs.
- **npm audit** (1046 dependencies):

  | Scope | Critical | High | Moderate | Low |
  |---|---|---|---|---|
  | All | 0 | 7 | 20 | 1 |
  | Production (`--omit=dev`) | 0 | 4 | 2 | 0 |

  - Production highs: `zod` (direct, 3.25.76; the fix is a 4.x major), `fast-uri` (via `ajv`), `brace-expansion`, `source-map-js`.
  - Dev only: `vite` (launch-editor command injection on Windows), `vitest` / `@vitest/mocker` (dev-server path traversal), and the eslint chain.
  - Fixes are available non-breaking (`npm audit fix`) except for zod (major) and the eslint-config-next chain.

## 8. AI security assessment
| Risk | Status |
|---|---|
| Stored/indirect prompt injection | **Open.** Org memory (F2), published agent instructions (F3), tool config (F4), construction state (F6) |
| Tool privilege | Databricks SQL is read-only and single-statement, but runs as a shared principal, so a member can query anything the principal can reach (by design; see the data-access design doc) |
| Unauthorized tool invocation | Tools run under the server's identity; the caller's role is not re-checked per tool |
| Destructive actions / human approval | No destructive tools found, so not required today. Any write-capable tool added later must require server-side approval |
| Cross-user context leakage | F5/F6: another user's session knowledge can be loaded into the prompt (`inspector/chat:231`) |
| Cost exhaustion | **Open** (F7). No quotas or rate limits on Bedrock endpoints (`boost/run-suite` maxDuration 600 s) |
| Auditability | Agent runs are recorded; memory edits, deletes and purges are **not** audited (F2) |

## 9. Prioritized hardening roadmap

### Milestone 1: immediate authorization fixes (recommended first)
Small, contained server-side changes, each covered by a route test.

| # | Fix | Files | Test |
|---|---|---|---|
| 1 | **F1:** remove the `x-user-id` fallback; return 401 when there is no session (use `authenticateSession()`, which handles both cookie and Bearer) | `agent-lab/workbench/sessions/route.ts` | Bearer + `x-user-id: victim` → 401; victim rows untouched |
| 2 | **F2:** org/HARD_RULE bullets: edit, approve, retire and delete require admin or a curator permission; personal bullets require `created_by === user`; purge-session requires session owner or `SESSION_READ_ALL`; write audit rows | `memory/[id]/curate`, `memory/[id]`, `memory/purge-session` | Member edits an org bullet → 403; owner → 200; audit row written |
| 3 | **F3:** `requireRole(admin)` on review POST; `author` taken from the session; block self-approval | `catalog/agents/[id]/review/route.ts` | Member approve → 403; admin approve records the session author |
| 4 | **F6:** make ownership enforcement the default (`INSPECTOR_AUTH_ENFORCE !== 'false'`), keeping an emergency opt-out | `src/lib/inspector/session-auth.ts` | User B with A's sessionId → 403 when the env var is unset |
| 5 | **F5:** `guardSessionRead` on studio results GET and POST | `studio/results/route.ts` | Cross-user → 403/404 |

- **Compatibility risk:** F6 may expose legitimate flows that relied on the logging-only behaviour, such as admin support or shared sessions. Check the existing observe-mode logs for would-be denials before flipping the default.
- **Rollback:** each fix is per-route and revertable. F6 keeps an env opt-out.

### Milestone 2: foundational authorization
- **F7:** apply `denyUnlessEstatePipelineOperator` to every route that enqueues or launches harvest, ECS or LLM batch work, and add per-user quotas on Bedrock routes.
- **F4:** catalog tools writes become admin-only, with a zod allow-list of fields.
- **F8:** add the `canManageRole` check to the user status branch.
- **F9:** charts DELETE requires owner or admin.
- **F14:** add role checks to telemetry routes.
- Add a lint/test guard that fails CI when a `route.ts` exports a mutating handler without one of the approved auth helpers (see §10).

### Milestone 3: session and application hardening
- **F10:** default `ENABLE_CREDENTIALS_LOGIN=false` in production, or add per-account/IP throttling and lockout.
- **F11:** re-check `isUsable` and the role in the proxy (with a short cache), or migrate session-only routes to `authenticateSession`.
- **F13:** add security headers in `next.config.ts` (`frame-ancestors 'none'`, CSP in report-only mode first, HSTS, `nosniff`, `Referrer-Policy`).
- **F15:** stop using the `NEXT_PUBLIC_` flag in server-side authorization.
- **F12:** use a configured internal base URL.
- **F17:** return generic error messages.

### Milestone 4: supply chain and infrastructure
- **D1:** run `npm audit fix` for the non-breaking fixes; plan the zod 4 migration.
- **F16:** SHA-pin actions, digest-pin images, put `tsx` in the lockfile, deploy immutable tags.
- Scope the deploy IAM `Resource:"*"` statements.
- Add Dependabot/Renovate.

### Milestone 5: long-term security engineering
- Central `withAuth(handler, {permission, owner})` wrapper.
- Threat-model review for any new agent tool.
- Quarterly authorization regression sweep.
- Incident runbook for memory and agent tampering.

## 10. Security test plan
| Layer | Check | Tooling (repo-appropriate) |
|---|---|---|
| Route authorization regression | Per-finding tests above (vitest route tests already exist, e.g. `src/app/api/connections/__tests__`) | vitest |
| Auth-helper coverage guard | Script/test that parses every `src/app/api/**/route.ts` and fails if a POST/PATCH/PUT/DELETE export lacks `requireRole`, `requirePermission`, `resolveAuth`, `authenticateSession`, `guard*` or `denyUnless*` (with an explicit allow-list) | vitest + `fs`/regex or ts-morph |
| Identity spoofing | Assert no handler reads `x-user-id` / `x-user-*` headers | grep-based test |
| Dependencies | `npm audit --omit=dev --audit-level=high` in CI | npm + GitHub Actions |
| Secrets | gitleaks pre-commit or CI step | gitleaks |
| SAST | CodeQL (JS/TS) on PRs | GitHub CodeQL |
| Headers | Integration check of response headers on `/` and `/api/health` | `web/e2e` smoke script |
| Manual | Two test identities (member, admin) plus platform_admin, run against staging only, covering F1–F9 | — |

## 11. Coverage and limitations
**Tested:** static review of all 190 route handlers, classified by auth pattern, with about 40 read in full. Also reviewed: auth/RBAC libs, the proxy, the memory/LLM injection path, the Databricks execution path, the harvester launch, connection providers, file upload/download, Dockerfiles, workflows, the infra JSON, `next.config.ts` and the Vite config; grep for XSS sinks, raw SQL, `child_process`, `eval` and secret patterns; plus `npm audit`.

**Not assessed or unknown (requires access):**
- Production env values: `INSPECTOR_AUTH_ENFORCE`, `ENABLE_CREDENTIALS_LOGIN`, `NEXT_PUBLIC_ENABLE_DEV_TAB`, `NEXTAUTH_URL`.
- ALB/nginx Host-header handling (F12) and TLS configuration.
- Entra app assignment restrictions (whether all tenant users can sign in).
- Deployed IAM roles, S3 bucket policies, security groups and RDS encryption/backups (only the repo JSON was reviewed).
- The 87 session-only routes were not each read line by line, so GET handlers with side effects may exist.
- `packages/` and `web/src` were checked by grep only.
- `scripts/` beyond the harvester launch path.
- Dependency reachability analysis.
- No dynamic or penetration testing was performed.

**False positives ruled out:**
- Raw SQL in `queue.ts`/`retrieve.ts` (constants only).
- `spawn` with `shell:true` (local development, constant arguments).
- Connections SSRF (host allow-list).
- Knowledge download XSS/traversal.
- `dangerouslySetInnerHTML` (static CSS).
- `callbackUrl` open redirect.
- Role escalation through `users` POST/PATCH role.
- Inspector memory promote (gated).
- Dashboards (gated).
- The AWS key in tests (documentation example key).
- Placeholder DB URLs in templates and docs.

---

## 12. Remediation status (2026-11-04)

| # | Status | Fix | Regression test |
|---|--------|-----|-----------------|
| F1 | Fixed | `workbench/sessions` GET/DELETE use `authenticateSession()` only | `F1 workbench sessions identity` |
| F2 | Fixed | `src/lib/memory/curation-access.ts`; curate/delete/purge/trace/browse gated; curation audited | `F2 memory curation` |
| F3 | Fixed | Review status changes admin-only, no self-approval, server-derived author, audited | `F3 catalog review` |
| F4 | Fixed | Tool catalog writes admin-only with zod allow-list; GET `orderBy` allow-listed | `F4 tool catalog writes` |
| F5 | Fixed | `studio/results` GET/POST/PATCH use `guardSessionRead` | `F5 studio results PATCH` |
| F6 | Fixed | `INSPECTOR_AUTH_ENFORCE` enforces unless set to `false` | existing inspector auth tests |
| F7 | Fixed | Harvest routes: platform_admin; LLM batch/boost/enrich/job logs: admin; blueprint: member | `F7 expensive batch routes` |
| F8 | Fixed | Status/profile edits respect `canManageRole`; no self status change | `F8 user status changes` |
| F9 | Fixed | Chart delete owner/admin; chart POST requires session, ignores `createdBy` | `F9 chart delete` |
| F10 | Mitigated | Per-account lockout (5/15 min, per instance) and dummy bcrypt compare | `F10 credentials throttling` |
| F11 | Fixed | JWT role/status re-checked every 5 min; revoked tokens get 401 at the proxy | — (needs integration test) |
| F12 | Fixed | Internal URL from `NEXTAUTH_URL` | — |
| F13 | Fixed (baseline) | Frame, CSP `frame-ancestors`/`base-uri`/`object-src`, nosniff, Referrer-Policy, HSTS, Permissions-Policy | — |
| F14 | Fixed | audit-log `audit:read`; performance/bandits admin; digest member; reflections owner-only | `F14 marcus reflections` |
| F15 | Fixed | Server uses `hasAgentOpsRole`; dev-tab flag is UI-only | `F15 agent ops gate` |
| F16 | Fixed | Actions SHA-pinned, base images digest-pinned, `tsx@4.23.1` | — |
| F17 | Fixed | Generic messages in catch-alls; streaming chat errors mapped by `clientStreamError` with a log reference | `client-stream-error.test.ts` |
| D1 | Partial | `npm audit fix`; prod now zod (high) + minimatch (moderate) | — |

**Residual risk and follow-ups**
- Upgrade zod to 4.x (GHSA-mrhx-c7xc-m3w5); `openai` also depends on zod, so test together.
- Move the login lockout to a shared store (DB/Redis) for a cluster-wide limit.
- Roll out a full script/style CSP in Report-Only mode first.
- Enable Dependabot for `docker` and `github-actions` so the pins are refreshed.
- Confirm production env values listed in §11, especially that nothing sets `INSPECTOR_AUTH_ENFORCE=false`.
