# Sharing Databricks Genie with the whole organization

**Who this is for:** Business leaders, HR, finance, operations—anyone who needs to understand whether people **without a Databricks login** can still use Genie.  
**Who should read the technical appendix:** IT, data platform, security, and product.  
**Date:** November 2026  
**Status:** Planning guide (not a vendor guarantee)

---

## The short answer

| Question | Plain answer |
|----------|----------------|
| Can we email everyone a Genie link and they just use it? | **No.** Genie inside Databricks always requires a **Databricks sign-in** (or sign-in through an embedded page that still uses Databricks identity). |
| Can people **without** Databricks accounts ask questions in natural language? | **Yes, but only through your own application** (for example **ALOFT D360**). They log in with **company SSO** (Microsoft Entra). Your **backend** talks to Genie on their behalf. |
| Is that the same as “everyone sees all data”? | **No.** Without careful design, everyone might see **the same** data the integration account can read. **Security and data teams must define** who sees what. |
| Is Genie free for everyone? | **Not automatically.** Databricks bills **AI usage** and **SQL warehouse** time. Promotions and rules differ for **named Databricks users** vs **backend (service) accounts**. Finance and Databricks account teams should confirm your contract. |

---

## Three ways people can use Genie (simple picture)

```
┌─────────────────────────────────────────────────────────────────┐
│  Option A — Databricks website                                  │
│  User → opens Databricks → signs in → opens Genie               │
│  Needs: Databricks account + permission to use Genie + data     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Option B — Genie embedded in a portal (iframe)                 │
│  User → your intranet page → still signs in WITH DATABRICKS     │
│  Needs: same as Option A (Databricks login on that screen)      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Option C — Your app (recommended for “no Databricks login”)    │
│  User → ALOFT (or custom app) → company SSO only                │
│  App server → Genie API (usually as a service account)          │
│  Needs: IT builds integration + security model (see below)      │
└─────────────────────────────────────────────────────────────────┘
```

**For organization-wide access without Databricks logins, Option C is the realistic path.**

---

## What “no Databricks access” really means

People often mean one of two things:

| What they mean | What actually works |
|----------------|---------------------|
| “They don’t use the Databricks **website** or SQL notebooks.” | **Option C** fits: they only see **your** app. |
| “They have **no Databricks user** and **no license** at all.” | Still possible with **Option C**, but your app’s backend uses a **Databricks service account**. You must **control data in your app**, not rely on Databricks knowing each person’s row-level rights (unless you add per-user OAuth—see appendix). |
| “They should only see **their** vessel / region / cost center.” | **Not automatic** with Option C. Requires **approved views**, **app roles**, and/or **per-user Databricks OAuth** (each person then needs a Databricks identity). Data governance must sign off. |

---

## What the organization must decide (non-technical checklist)

Before rolling Genie out widely, leaders should agree on:

1. **Who is allowed to ask questions?** (All staff, managers only, analysts only, etc.)
2. **Which business areas?** Genie works best on **small, curated** datasets (on the order of **a handful to a few dozen approved tables or views per topic**), not “every table in the warehouse.”
3. **What data is in scope?** (Fleet, crew, finance—often **separate Genie agents** per area.)
4. **How strict is row-level security?** (Can two users with the same app role see the same answers?)
5. **Who pays?** Questions consume **AI credits** and **warehouse compute**; heavy use adds cost.
6. **Who fixes wrong answers?** Data stewards maintain **definitions, examples, and tests**—Genie is not “set and forget.”

---

## Recommended approach for Synergy-style rollout

This aligns with the internal Genie enterprise assessment and ALOFT platform direction.

| Step | What happens | Who |
|------|----------------|-----|
| 1 | Pick **2–3 business topics** (for example maintenance, crew compliance, vessel costs). | Business + data owners |
| 2 | Data team publishes **approved views** (not raw messy tables). | Data engineering |
| 3 | Create **one Genie agent per topic** (each with a small, documented dataset). | Databricks admins |
| 4 | Expose Genie **inside ALOFT** (chat that calls Genie in the background) **or** a dedicated internal portal with company SSO. | Product + IT |
| 5 | Map **app roles** to **which agents** a user may open (routing). | Security + product |
| 6 | Pilot with **real questions**, measure **accuracy, speed, cost**, and **permission tests**. | All |

**ALOFT already gives** company SSO, chat UX, dashboards, and agents. **Genie can sit behind** that experience so most users never open Databricks.

---

## What users experience (Option C — through ALOFT)

1. User opens **ALOFT** and signs in with **work email** (same as other internal apps).
2. User opens **“Ask data”** (or a domain-specific assistant).
3. User types a question in plain English.
4. The app picks the **right topic agent** (maintenance vs finance, etc.).
5. User sees an **answer, table, or chart**—not the Databricks screen.
6. If the question is outside their allowed topics, the app **refuses or redirects**—by design.

Users do **not** need to know what Databricks or Genie are.

---

## Risks to explain to leadership (honest, simple)

| Risk | Why it matters |
|------|----------------|
| **Over-broad data access** | If the backend uses one shared Databricks account, answers may include data some users should not see. |
| **Wrong but believable numbers** | AI can misread filters or joins; curated views and testing reduce this—not eliminate it. |
| **Cost surprises** | Many users asking many questions increases AI and warehouse bills. |
| **Too many tables in one agent** | Quality drops; Databricks limits how many assets one agent can use—domains must stay focused. |
| **Duplicate tools** | Genie **plus** ALOFT Inspector on the same data without a plan wastes money and confuses users. |

---

## FAQ for colleagues

**Can we share Genie like a SharePoint link?**  
No for anonymous access. Yes for **a link to your app** that already enforces login and permissions.

**Do we have to buy Databricks for every employee?**  
Not necessarily for **Option C**, but you still pay for **Databricks usage** on the backend and need **licensing aligned to your contract**. Confirm with your Databricks account team.

**Is ALOFT required?**  
No vendor rule requires ALOFT—but **something** must provide SSO, routing, and audit. ALOFT is the natural choice if that is already the analytics platform.

**Can Genie replace ALOFT?**  
No. Genie answers questions over approved data. ALOFT is the wider platform (dashboards, agents, catalog, automation). See [aloft-vs-databricks-genie-executive-brief.md](./aloft-vs-databricks-genie-executive-brief.md).

---

## Appendix — For IT and data platform (slightly more detail)

### Access models (from Databricks integration patterns)

| Model | User needs Databricks login? | Data permissions follow… |
|-------|------------------------------|-------------------------|
| Genie in Databricks UI | **Yes** | Each user’s Databricks data access |
| Embedded Genie (iframe) | **Yes** (on embed) | Each user’s Databricks data access |
| Custom app + **user OAuth** to Databricks | **Yes** (linked identity) | Each user’s Databricks data access |
| Custom app + **service principal** | **No** (app SSO only) | **The service account’s** access—unless you add app-layer filters and scoped views |

For **organization-wide** rollout **without** provisioning hundreds of Databricks users, teams often start with **service principal + scoped views + app roles**. That is **faster to roll out** but **weaker on automatic row-level security** until user OAuth or mirrored grants are implemented.

### Technical limits to plan around (per Genie agent)

Examples from product documentation (verify on your Databricks version):

- About **50** tables, views, or metric views per agent  
- Separate agents for separate business domains; an **orchestrator** in your app chooses the agent  
- AI consumption and SQL warehouse time billed separately  

### Security rules of thumb

- Never put Databricks secrets in a web browser or mobile app.  
- Keep authentication and “who may ask what” on the **server**.  
- Run **negative tests** (users who must **not** see sensitive data).  
- Log questions and outcomes for audit (your app + Databricks usage tables).

### Official Databricks references (for technical staff)

- [Create and manage a Genie Agent](https://docs.databricks.com/aws/en/genie-agents/set-up)  
- [Embed a Genie Agent in an external app](https://docs.databricks.com/aws/en/genie-agents/embed)  
- [Genie conversation API](https://docs.databricks.com/aws/en/genie-agents/conversation-api)  
- [How Genie Agent data access works](https://docs.databricks.com/aws/en/genie-agents/concepts)  

---

## One paragraph you can paste into an email

> We can make **natural-language data questions** available to staff who **do not use Databricks**, by offering Genie **through our internal analytics application** (ALOFT) with **company single sign-on**. People will **not** get a separate Databricks login unless we choose that model. This is **not** a public link—it requires **IT integration**, **approved datasets per business area**, and **clear rules on who sees what**. We should start with a **small pilot**, measure **accuracy and cost**, then expand. Data and security teams must approve before wide rollout.

---

*Internal planning document. Promotions, limits, and pricing change; confirm with Databricks and finance before commitments.*
