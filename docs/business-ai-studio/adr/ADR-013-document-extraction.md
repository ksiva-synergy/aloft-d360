# ADR-013 — Document extraction: Grok directly now, the DATA360 OCR gateway later

**Status:** Accepted (provisional) · **Date:** 2026-10-27 · **Decided by:** the product owner, in the Automate build session

## Context

Automate needs to read fields from documents, for example "check every seafarer's certificates against the crew table". The documents are in S3, Azure Blob or SharePoint, reached through the storage connections (§1.1 of [06](../06-connectors-security.md)).

Two ways to extract exist:

1. **Grok directly, built in ALOFT.**
   - `src/lib/extraction/` renders PDF pages to images and sends them all in one call to Grok 4.7.
   - The answer must match a named schema, and a value is kept only together with the text it was read from.
   - Status: built and tested, and checked live on 2026-10-27 (details under Evidence).
2. **The DATA360 OCR gateway**, a separate application in the `DATA360Portal_ReactJS` repo (backend: `backend/api/routes/ocr.js`; read at commit `559314c`). It already does:
   - **Projects and setup:** projects ("entities") per document type, a field analyzer that proposes fields from sample files, and AI prompts through its LiteLLM provider settings.
   - **Getting files in:** ingestion from S3, Azure Blob, ADLS, SFTP and SharePoint, including Graph change notifications.
   - **Volume:** a job queue (`dbo.OCRJobs`) with a separate worker (`ocr-worker.js`) that scales from 0 to N on Azure Container Apps.
   - **People:** a human review queue.
   - **Getting results out:** export to Databricks and SQL databases.
   - **A token API per project** (`ocrent_<entityId>_<secret>`, with scopes such as `documents:read` and `documents:write`). It covers upload, batch upload, status, jobs, results, `/records/query`, `/schema`, `/changes`, webhooks and export.

Databricks was also considered for bulk extraction and analysis. It suits work an engineer owns and schedules. It does not suit business users building their own checks with approvals and messages, which is Automate's purpose.

## Options

| | A. Grok directly (built) | B. Gateway, per-project token as a connection | C. Gateway, ALOFT as an integration client |
|---|---|---|---|
| What ALOFT does | Downloads the file, renders it, calls Grok | Calls the gateway's token API for one project | Creates and configures gateway projects for users, then as B |
| Who sets up a document type | A developer adds a schema in code (or, planned, the user defines fields in the step) | Someone creates the project in the DATA360 portal and copies its token into ALOFT | The user, inside ALOFT |
| Gateway changes | None | None | New login, guards, ownership table, tests |
| Entra admin work | None | None | Two app registrations, an app role, admin consent |
| Review queue, stored searchable records, ingestion, volume | No | Yes | Yes |
| Network | ALOFT → xAI | ALOFT (AWS) → gateway (Azure) over HTTPS | Same as B |
| Where page images go | xAI (outside AWS) | Wherever the gateway's LiteLLM routes them | Same as B |

## Decision

**Use A (Grok directly) now.** It is the simplest option for the current need, a few documents at a time. Keep B and C documented here and build them only when a trigger under "Revisit when" is met.

The product owner chose Grok 4.7 over Bedrock Claude, knowing that the page images leave AWS for xAI. `EXTRACTION_MODEL` changes the model without code changes.

## Consequences

- No dependency on the gateway's availability, network path or tokens.
- New document types need either a code change (`src/lib/extraction/schemas.ts`) or the planned user-defined fields in the step.
- There is no human review queue and no store of extracted records. Results live only in the automation run, or as a step's sample response.
- The design is not for large volumes: at most 10 pages and 20 MB per file, and one Grok call per document (about 3k input tokens per page). For each caps a step at 1000 items.
- Moving to B later does not undo anything. `document.extract` keeps its contract, and only the handler changes from "Grok directly" to "send to gateway project, wait, read results".

## Evidence

- **Live check against xAI** on a made-up three-page certificate rendered from PDF:
  - result: 11 of 12 fields correct, each with page and source text, in 11 s for about 9.1k input tokens;
  - the date of birth `02/07/1985` came back empty because day and month are ambiguous;
  - text cut off the page came back as "not found", not guessed.
- **Tests:**
  - `src/lib/extraction/__tests__/*`;
  - `src/app/api/connections/__tests__/extract.routes.test.ts`;
  - `src/lib/connections/__tests__/providers-read.test.ts`;
  - `src/views/agent-lab/flows/__tests__/TryExtraction.test.tsx`.
- **Gateway facts:** from reading `DATA360Portal_ReactJS` at `559314c`:
  - routes in `backend/api/routes/ocr.js` and `backend/api/routes/ocrIngestion.js`;
  - the worker in `backend/ocr-worker.js`;
  - auth in `backend/middleware/auth.js`;
  - the API specification in `doc2/OCR_DATA_ACCESS_API.md`.
  - Its `doc2/OCR_MODULE.md` is partly out of date; the code is the reference.

## Revisit when

Any one of these:

- **Volume:** more than a few hundred documents per run or per day, or the need to watch a folder and process new files automatically.
- **Review:** people must check and correct extracted values before they are used.
- **History:** extracted data must be kept and searched across runs, for example "all certificates expiring this quarter" without re-reading files.
- **Existing projects:** a document type is already set up in the gateway and should be reused rather than redefined.
- **Data residency:** page images must not leave AWS, or must go only through the gateway's approved model providers.

---

## Appendix 1 — Plan for option B (gateway, per-project token as a connection)

No gateway changes. Rough size: small.

1. **ALOFT setting `OCR_GATEWAY_URL`** (admin, per environment). Users never type a URL, which stops anyone pointing ALOFT at an internal address.
2. **New connection kind "OCR project"** under Govern → Connections:
   - settings: project (entity) ID and a project API token with read and, if needed, upload scope;
   - the token goes to Secrets Manager (`aloft/connections/<id>`) like the other credentials;
   - Test calls `GET /api/ocr/entities/{id}/api/schema`;
   - private or shared, as for the other connections.
3. **Steps (capabilities):**
   - **Send for extraction** (write): `POST …/api/documents` or `/documents/batch`, then poll `…/documents/{id}/status` or `/jobs/{jobId}`. Works with For each.
   - **Get document fields** (read): `GET …/documents/{id}/results`.
   - **Query extracted records** (read): `POST …/records/query` with filters; returns rows. This is the data source for checks such as the seafarer mismatch report.
4. **Copilot** reads `/schema` for each available OCR project, so it uses real field names.
5. **Ad-hoc extraction:** one project, `aloft_adhoc`, created once in the DATA360 portal, with its token added as a shared connection. ALOFT records which user sent which document and shows each user only their own.
6. **Later, with the run engine:** gateway webhooks or `GET …/api/changes` can start an automation ("when a new certificate is extracted, check it").
7. **Before starting, confirm:**
   - ALOFT (AWS ECS) can reach the gateway (Azure) over HTTPS;
   - the gateway's IP allowlist, if any, includes ALOFT's outbound (NAT) addresses.

## Appendix 2 — Plan for option C (ALOFT creates gateway projects for users)

Only if users must create and configure document types inside ALOFT rather than in the DATA360 portal. Rough size: medium, across two repositories.

**Why it needs more:** every project-setup route in the gateway uses `verifyToken` from `backend/middleware/auth.js`. That is a JWT signed with one shared `JWT_SECRET` and carrying just `{ userId }`, so there is no service-to-service login.

**Do not** give ALOFT `JWT_SECRET`. With it, ALOFT could create a login for any portal user and change every project.

Separately: `backend/gen-token.js` contains a hard-coded secret (`'change-me-to-a-strong-random-string'`). Check that no environment runs with that value.

**Microsoft Entra ID** (tenant admin, once per environment):

- The gateway app registration exposes an API (Application ID URI, e.g. `api://data360-ocr-gateway-dev`) with an app role `OCR.Integration`, allowed for applications only.
- An ALOFT client app registration gets that application permission, with admin consent. It uses a certificate (preferred) or a client secret of at most 12 months, with a named owner for rotation.
- If ALOFT and the gateway are in different tenants, the setup changes; resolve that first.

**Gateway changes** (new branch in `DATA360Portal_ReactJS`):

- **Middleware `verifyIntegrationClient`.** It reuses the JWKS check that SSO already does (`jwks-rsa` with `MICROSOFT_TENANT_ID` in `backend/api/routes/sso.js`). A request passes only if:
  - the token is for this gateway (`aud`) and from the tenant (`iss`);
  - `roles` includes `OCR.Integration`;
  - it is an app token (`idtyp = app`);
  - the calling app (`azp`) is on an allowlist.
- **A separate route group, `/api/ocr/integration/...`**, rather than loosening `verifyToken`. It reuses the existing handlers for:
  - `POST /entities` and deactivation;
  - `analyze-fields`, `field-analyzer/runs/:runId/refine` and `field-analyzer/apply`;
  - `field-configs/bulk`;
  - `tokens`;
  - `members`;
  - later, ingestion and export settings.
- **Guards the gateway enforces itself:**
  - the project key always starts with `aloft_` (added server-side);
  - a create-only table `OCRIntegrationEntities(EntityId, ClientId, CreatedFor, CreatedAt)`, and the client may touch only those projects;
  - a required `X-On-Behalf-Of: user@company.com` header, stored as creator and written to the audit log;
  - quotas, e.g. 20 projects per person and 200 per client, and a rate limit per client.
- **Settings:** `OCR_INTEGRATION_AUDIENCE`, `OCR_INTEGRATION_ALLOWED_CLIENT_IDS`, `OCR_INTEGRATION_ENTITY_PREFIX=aloft_`, plus the quota limits.
- **Tests** must show:
  - user tokens, tokens without the role and apps not on the allowlist are rejected;
  - another client's project is unreachable;
  - the prefix is forced;
  - the quota holds.

**ALOFT changes:**

- **Platform settings:** gateway URL, tenant ID, gateway App ID URI, client ID. The certificate or secret goes in Secrets Manager (`aloft/ocr-gateway/client`).
- **Token handling:** client-credentials sign-in (scope `api://…/.default`), cached until expiry.
- **Table `ocr_projects`:** gateway project ID, name, owner, visibility, using the same ownership model as connections; one create-only migration. Per-project `ocrent_` tokens are created through the integration API and kept in Secrets Manager.
- **"New OCR project" screen:**
  1. name and goal;
  2. upload 1–3 samples;
  3. the field analyzer proposes fields;
  4. review, edit or refine them;
  5. apply;
  6. optionally connect a source and export.
- **Then the option B steps and Copilot schema awareness.**

**Operations:**

- **Instant cut-off:** remove ALOFT's client ID from the allowlist, or disable its Entra app.
- **Cost:** attributed per project and per on-behalf-of user.
- **Environments:** dev ALOFT talks only to the dev gateway, with separate app registrations.

**Decisions needed before starting C:**

1. same tenant;
2. certificate or secret;
3. quotas;
4. who in ALOFT may create OCR projects;
5. permission to change the gateway repo;
6. the dev gateway URL.
