# ADR-007 — Secrets, connector isolation and egress

**Status:** Proposed (needed before M5 live connectors) · **Date:** 2026-10-26

## Context

Databricks credentials already live in AWS Secrets Manager, and the DB holds only `secret_ref` (`src/lib/databricks/secrets.ts`). Studio connectors will add REST APIs, email, Teams and object stores. The gateway already enforces an email-domain allowlist and relative HTTP paths, and connection, method and channel are literal fields. Network-level egress control does not exist yet.

## Decision (proposed)

1. **Identity order:** IAM role / STS (S3, SES), then OAuth client credentials or delegated OAuth (Microsoft Graph for Teams and email), then static API keys in Secrets Manager. The `Connection` row stores `authMode`, `secretRef` and `resourceScope`, never a secret value.
2. **Handlers run in the flows worker** (ADR-003), not in the web container. The worker task role gets only the secrets and buckets its connections reference.
3. **Egress:** application allowlists (implemented for email, and for paths relative to a connection base URL), plus a network allowlist for the worker (security group + NAT, or an egress proxy with per-connection hosts). Block link-local and metadata addresses at the proxy as defence in depth.
4. **Redirects:** HTTP handlers do not follow redirects across hosts. The OAuth token audience must match the connection's resource.
5. **Logs:** handlers never log headers or bodies by default. When enabled, they log redacted bodies through `redact.ts`. Add a test that fails if a known secret string appears in a captured log.

## Revisit when

A connector needs user-delegated identity (acting as the signed-in user rather than a service). That requires a token store with consent and revocation, which is a separate design.
