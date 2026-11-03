# ALOFT D360 vs Databricks Genie — Executive brief

**Audience:** Technology, Product, Finance, Data Governance  
**Date:** 2 November 2026  
**Related:** Internal assessment *Databricks Genie Enterprise Assessment 2026*; positioning note [aloft-vs-general-ai-assistants.md](./aloft-vs-general-ai-assistants.md)

---

## Bottom line

**Genie and ALOFT solve different problems.** Genie is Databricks’ natural-language analytics over a **small, curated** set of tables (up to **50 per agent**). **ALOFT D360** is Synergy’s **full analytics and AI platform**: chat over data, dashboards, semantic KPIs, custom agents, data-estate cataloging, memory, and automation—in one branded application.

**Recommendation:** Do **not** treat Genie as a replacement for ALOFT. Treat Genie as an **optional engine** for narrow, steward-owned domains if a pilot proves clear accuracy or time-to-market wins. **Keep ALOFT** as the user experience, identity layer, and long-term platform. Close ALOFT’s NL-SQL gaps (verified examples, value matching, benchmarks) in parallel with any Genie pilot.

---

## What Genie is good at

| Strength | Why it matters |
|----------|----------------|
| **Turnkey “ask data”** on a few approved views | Fast pilot if domains are small and stewards live in Databricks |
| **Per-user data access** (with user OAuth) | Warehouse permissions follow the person, not a shared service account |
| **Built-in tuning kit** | Example SQL, benchmarks, entity/value matching, “trusted” answers for approved queries |
| **Clear limits** | 50 assets per agent forces good domain design |

**Constraints leadership should remember:** Large estates need **many Genie agents plus a router** in your app—not one agent for everything. **Service-principal** API access does **not** give per-user row security unless you design views and isolation. **Cost** is consumption-based (AI usage + SQL warehouse time), with different rules for named users vs service principals after current promotions.

---

## What ALOFT is good at

| Strength | Why it matters |
|----------|----------------|
| **One Synergy product** | Inspector, dashboards, Agent Lab, Automate, estate jobs—already invested |
| **Whole data estate** | Automated catalog and search across tables without the 50-table cap per copilot |
| **Governed KPIs** | Semantic layer favors **correct metrics or clear refusal**, not silent wrong numbers |
| **Control** | Choice of models, AWS/Azure hybrid, audit and agent ops on your stack |

**Gaps to acknowledge honestly:** ALOFT does not yet ship Genie-equivalent **verified query libraries**, **value/entity matching**, or a **production benchmark scorecard**. Row-level warehouse access aligned to each user is **planned**, not fully delivered. Fixing catalog quality issues and those gaps is required before claiming parity with Genie on ad hoc questions.

---

## Side-by-side (one page)

| Question | Genie | ALOFT D360 |
|----------|-------|------------|
| Primary purpose | NL analytics copilot in Databricks | Enterprise analytics + AI platform |
| Table scope | Up to 50 assets per agent | Full estate via harvest; agents discover via search |
| Dashboards & sharing | Databricks AI/BI | In-app dashboards and roles |
| Custom business agents | One agent ≈ one data domain | Agent Lab catalog and workflows |
| Best for KPIs | SQL + curated examples | Semantic layer (when modeled) |
| Best for ad hoc SQL chat | Strong if stewards curate agents | Improving; needs verified examples + eval |
| User experience | Databricks UI, iframe, or API | Native Synergy application (Entra SSO) |
| Data permissions | Strong with **per-user OAuth** | App login today; **per-user warehouse ACL in roadmap** |

---

## Decision guide

| If the goal is… | Lean toward… |
|-----------------|--------------|
| One branded product for analytics, agents, and operations | **ALOFT** (continue invest) |
| Prove NL Q&A on 2–3 domains in ~4 weeks with Databricks tooling | **Genie pilot** (narrow scope) |
| Strict “each user only sees their rows” in the warehouse | **Genie with user OAuth**, or **ALOFT after data-access program**—not Genie via service principal alone |
| Lowest duplicate spend | **Avoid** full Genie UI **and** full ALOFT Inspector for the same domains without a router strategy |

**Suggested path**

1. **4-week Genie pilot** on 2–3 curated domains (as in the Genie assessment)—measure accuracy, security, cost per 100 answers.  
2. Run the **same question set in ALOFT Inspector**—compare gaps by type (KPI vs exploratory SQL).  
3. **Decide architecture:** ALOFT-only, Genie-as-backend behind ALOFT, or **hybrid** (KPIs via semantic layer in ALOFT; ad hoc domains via Genie API).  
4. **Fund ALOFT** on verified queries, value grounding, and benchmarks if the pilot shows Genie wins on ad hoc but ALOFT wins on product and KPIs.

---

## Answer for the boardroom

**Is Genie “better”?**  
Better as a **focused Databricks copilot** on small, curated domains—with the right identity and stewardship model.

**Is ALOFT “better”?**  
Better as **Synergy’s operating system** for data, dashboards, agents, and the estate—provided we finish governance and NL-SQL quality work already on the roadmap.

**Do we pick one?**  
Not necessarily. **ALOFT stays the platform.** Genie is a **candidate component** where a measured pilot justifies it—not a platform swap.

---

*Planning document only; not a vendor quote or commitment to build or buy.*
