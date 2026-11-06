# ALOFT vs general AI assistants (Grok, Claude Duet)

**Audience:** Product and engineering leadership  
**Status:** Positioning note (2026-11-01)  
**Related:** [creating-agents.md](../creating-agents.md), [data-access-control-design.md](../data-access-control-design.md), [business-ai-studio/IMPLEMENTATION_STATUS.md](../business-ai-studio/IMPLEMENTATION_STATUS.md), [01-product-capability-map.md](../business-ai-studio/01-product-capability-map.md)

---

## 1. Executive summary

Grok (xAI) and Claude Duet (Anthropic) are strong **general-purpose AI assistants** focused on conversation and **personal productivity**—open chat, and in Duet’s case proactive help across connected apps such as email and calendar.

ALOFT already offers **similar assistant capabilities** through **Inspector** and **catalog agents**, backed by **LLM Lite** (which can route to Grok and other models). On top of that, ALOFT provides **business-focused capabilities** that general assistants are not built to replace: governed access to company data (Databricks and the semantic layer), saved dashboards, **Agent Lab** (commission domain agents), **FOER memory** and teach mode, **knowledge bases**, **Automate** workflows, and the **data estate / harvest** pipeline—all in one signed-in product.

With **Microsoft 365 and other connectors added where there is a clear business need** (see §5), ALOFT can also support email, calendar-aware workflows, and more **proactive** assistance **inside the same governance model**, rather than as a separate consumer app.

Once **planned** work lands—RBAC and data access, tool and agent controls, sharing (team/org), live automation, connector handlers, and operational visibility—ALOFT is positioned to be a **more complete solution for Synergy’s needs** than a standalone Grok or Duet subscription: **general AI assistance plus business intelligence and automation in one place**.

This document compares **products**, not “ALOFT vs the Grok model.” We may call **Grok as a model** through LLM Lite while still building ALOFT as the platform.

---

## 2. What each product is

| Product | Primary user | Primary job |
|---------|--------------|-------------|
| **Grok (xAI bot)** | Individuals; X users | General chat, reasoning, coding; optional real-time/X context depending on product tier |
| **Claude Duet** | Professionals / small business (US research preview) | Proactive agent: briefs, background tasks, connected apps (e.g. Gmail), approve-before-send |
| **ALOFT D360** | Synergy / maritime analytics org | Governed data Q&A, BI, commissioned agents, memory on work, automation, estate operations |

References (external, not maintained by this repo):

- [Claude Duet product page](https://claude.com/product/claude-duet)
- [Claude Duet getting started](https://support.claude.com/en/articles/17631495-get-started-with-claude-duet)

---

## 3. Honest comparison

### 3.1 Where capabilities overlap

| Capability | Grok / Duet | ALOFT today |
|--------------|-------------|-------------|
| Natural-language Q&A | Yes | **Inspector**, agent chat, workbench test |
| Multi-step tool use | Product-dependent | Agent loop (SQL, schema, charts, KB search, etc.) |
| Choice of “smart” model | Grok-only / Duet fixed model | **LLM Lite** + per-feature and role policy |
| Background / proactive work | **Duet core**; Grok limited | Mostly **user-initiated**; digests/alerts possible (§5) |
| Personal app connectors (inbox, calendar) | **Duet** | Not equivalent today; SharePoint **file** connection exists; M365 mail/calendar **proposed** (§5) |
| Consumer mobile / voice UX | Strong | Web product; not a Duet-style personal app |

**Fair statement:** ALOFT covers the **workplace “ask AI and act on tools”** pattern. It does **not** today replicate Grok’s **consumer/X product** or Duet’s **full proactive personal-assistant UX**.

### 3.2 What ALOFT adds (general assistants do not provide as a platform)

| Area | ALOFT |
|------|--------|
| **Company data** | Read-only SQL chokepoint, **semantic layer** (governed metrics), connection to **Databricks** |
| **BI** | Dashboard builder, shared dashboards, semantic charts |
| **Agents** | Workbench **commission** → **agent catalog**, dedicated agent chat, Automate “Ask AI” steps |
| **Learning** | FOER memory, teach mode, org/personal rules by **agent class** |
| **Documents** | Knowledge bases, chunk search, agent bindings |
| **Automation** | **Automate** (flows): policy, simulation, Copilot editing, capability gateway |
| **Data estate** | Harvest tiers, catalog, mapper, jobs |
| **Enterprise** | **Entra SSO**, RBAC, audit hooks, cost/tool logs (see [databricks-auth-and-usage.md](../databricks-auth-and-usage.md)) |

### 3.3 Where general assistants are ahead (today)

| Area | Grok / Duet | ALOFT |
|------|-------------|--------|
| Zero-setup general chat | Excellent | Requires org app, data estate context |
| Proactive morning brief / nudges | **Duet** | Not shipped; optional roadmap (§5) |
| Personal email/calendar automation | **Duet** connectors | Planned via capability/connectors, not parity yet |
| Simplicity for non-data users | High | Higher power, higher setup |

---

## 4. What ALOFT has today (feature inventory)

Grounded in the current codebase and [IMPLEMENTATION_STATUS.md](../business-ai-studio/IMPLEMENTATION_STATUS.md).

### 4.1 Assistant and AI

- **Inspector** — chat over warehouse + tools; teach mode; export; semantic context  
- **LLM Lite** — unified model gateway; Govern → Models feature mapping  
- **Agent Lab** — workbench commission, catalog agents, agent chat by slug  
- **Models** — Grok, Bedrock, Azure routes via gateway (environment-dependent)

### 4.2 Data and analytics

- **Semantic layer** — models, entities, dimensions, measures; governed vs candidate  
- **Dashboards** — build, share (private/org/shared roles)  
- **Data estate** — harvest jobs, object pages, lineage-related UX  

### 4.3 Memory, knowledge, agents

- **FOER / platform memory** — phases, HARD_RULEs, personal vs org visibility  
- **Knowledge bases** — personal/org scope; agent links  
- **Agent catalog** — definitions, versions, workbench-tagged agents  

### 4.4 Automation and integrations

- **Automate (flows)** — templates, simulate, explain, policy, Copilot, publish (store on dev; live runs **partial / planned**)  
- **Capability gateway** — email, notify, HTTP, S3 list, OCR (**contracts**; live handlers environment-dependent)  
- **Connections** — S3, Azure Blob, **SharePoint** (files); private/org share  

### 4.5 Operations

- **History**, sessions, bandit/boost signals (Inspector)  
- **agent_cost_log**, tool invocation logging, agent-ops build plan  
- **Admin** spend views (where enabled)

---

## 5. Planned and proposed (not all shipped)

These align with existing design docs; they are **not** a commitment to match Grok or Duet feature-for-feature.

### 5.1 Already on the roadmap (in-repo plans)

| Theme | Source | Intent |
|-------|--------|--------|
| **RBAC + data access** | [data-access-control-design.md](../data-access-control-design.md) | Data roles, grants, labels, tier Databricks SPs, authorize() on paths |
| **Tool and agent control** | ADR-005, agents `AGENT_TOOLS`, access doc | Per-agent tools, semantic-first, fail-closed where designed |
| **Sharing** | KB schema (`team`), connections pattern, capability map C22 | Agents and KB: private / team / org |
| **Live Automate** | ADR-003, IMPLEMENTATION_STATUS M3–M5 | Schedules, webhooks, approvals, run history, live connectors |
| **Agent ops UI** | [agent-ops-build-plan.md](../agent-ops-build-plan.md) | Traces, failures, developer visibility |
| **Eval gates** | Studio 08, commissioned-agent notes | Tests before catalog **live** |

### 5.2 Microsoft 365 and proactive assistance (proposed direction)

Leadership direction: **add Microsoft 365 and other connectors as needed** so users can work with **email and calendar** and receive **proactive assistance within ALOFT**, under the same **approval and policy** model as Automate (capability contracts + gateway), not as an ungoverned side channel.

| Item | Today | Proposed approach |
|------|--------|-------------------|
| **SharePoint files** | Connection type exists | Extend usage in flows/agents as needed |
| **Outlook mail / calendar** | Not integrated | New **capability contracts** (read/draft/send with approval); Graph API + Entra app permissions; align with [06-connectors-security.md](../business-ai-studio/06-connectors-security.md) |
| **Proactive briefs** | No Duet-equivalent | **Ops/product digests**: harvest status, failed jobs, agent errors, spend; optional user-subscribed alerts—not necessarily personal inbox triage unless scoped and approved |
| **Approve before send** | Flow approval steps; Duet-style per-message approve | Reuse **approval + gateway** pattern for any M365 send capability |

**Dependencies:** security review, Entra admin consent, data classification (mail/calendar often **Confidential/Restricted**), and completion of Phase 0 access controls in the data-access design.

---

## 6. Positioning vs Amazon Bedrock AgentCore (brief)

**AgentCore** is AWS infrastructure for **many teams’ agents on AWS** with central IT gates—not a replacement for ALOFT’s product surface. Overlap with AgentCore themes (model gateway, tool policy, eval) is largely addressed by **planned in-app** work (LLM Lite, capability gateway, access control). See internal review notes; no separate AgentCore adoption doc in this file.

---

## 7. Summary answers for stakeholders

**Can ALOFT do what Grok and Duet do?**  
**Partially for the overlap:** workplace chat, reasoning, and tool-using agents—**yes**, via Inspector and Agent Lab, with models including Grok through LLM Lite. **Full parity** with Grok’s consumer/X experience or Duet’s proactive personal-app assistant—**no today**; selective features can be added via connectors and digests if product prioritises them.

**Can ALOFT do more for our business?**  
**Yes.** Governed data, semantic BI, estate harvest, commissioned agents, organisational memory, knowledge bases, and Automate are **in scope for ALOFT**, not for Grok/Duet as primary products.

**What should we invest in next?**  
Deliver **planned governance and automation** (§5.1); treat **M365 and proactive assistance** (§5.2) as a **follow-on product decision** with security and data-classification gates—not a reason to adopt a separate general-assistant product as the main platform.

---

## 8. Revision history

| Date | Change |
|------|--------|
| 2026-11-01 | Initial positioning doc from product/engineering review (Grok, Claude Duet, AgentCore context). |
