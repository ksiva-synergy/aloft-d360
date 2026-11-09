# Simplified data access model (option 3)

Status: **S1 built 2026-11-08** (engine only; nothing calls it yet). Decisions A1–A6 accepted as recommended (user, 2026-11-08). Replaces the separate Data map, Labels and Column access concepts with one model. Nothing here is built yet.
Related: [data-access-architecture.md](data-access-architecture.md) (current table-level design), [pii-protection-backlog.md](pii-protection-backlog.md) (column protections, requests, AI-proofing), [section-access.md](section-access.md) (which screens a person can open; unchanged).

## 1. Why simplify now

Today an admin has to understand nine ideas to answer "who can see this?":

| # | Today | Where |
|---|---|---|
| 1 | Departments | Data map |
| 2 | App-role data grants (Member, Admin…) | Data map |
| 3 | Person grants | People |
| 4 | Grant levels: Discover / Query / Export / Block | Data map |
| 5 | Labels: Confidential / Restricted on catalogs, schemas, tables | Labels |
| 6 | Clearance per person | People |
| 7 | Protections (data tags) on columns | Column access |
| 8 | Access groups, separate from departments | Column access |
| 9 | Tag grants (Exact values / Totals only) and owners | Column access |

Two of them do the same job twice:
- **Departments and access groups** are both "a named set of people".
- **Labels and clearance** and **protections** are both "this data is sensitive; only some people may see it". They follow different rules (a clearance ladder versus named groups).

**Timing:** `ACCESS_MODE` is `off`. Dev holds (read-only count, 2026-11-08): 2 departments with **0 members**, 2 grants (both department, query, allow), 1 label, **0 clearances**, 1 protection on 53 columns, 0 access groups, 0 tag grants. Nothing is enforced and almost nothing is configured, so this is the cheapest moment to change the model.

## 2. What the major platforms do (research, 2026-11-08)

| Platform | Pattern |
|---|---|
| Databricks Unity Catalog ABAC | Governed **tags** on data; **policies** attached high up (catalog) mask columns or filter rows by tag; GA. In-product **Request access** on permission errors, routed to destinations set on the object and inherited down the hierarchy (preview). |
| Snowflake | **Classification** tags sensitive columns; a masking policy bound to a **tag** protects every column with that tag automatically. |
| Google BigQuery | **Policy tags** in a taxonomy on columns; **Fine-Grained Reader** sees real values, **Masked Reader** sees masked values, others are denied. |
| Immuta | **Subscription** policies decide who can use a source, **data** policies shape what they see, with **request and approval** routed to data owners; auto-approval for low-risk sources. |
| ABAC literature | Role-per-combination designs cause "role explosion"; tags on data plus a few people attributes scale better, if the tags are well governed. |

Common ground: **one tag-based idea for sensitivity** (no separate ladder), **groups of people** as the main grantee, **masking rather than hiding**, **in-product requests routed by ownership**, and **time-bound access**.

## 3. The simplified model: two ideas and one flow

### 3.1 Groups (people)

One concept for "a set of people". It replaces departments and access groups.

- A group has a **name**, **members** (optional end date each) and an **approver** (one is enough).
- Built-in groups, computed rather than edited, following the app-role ladder exactly as role grants do today: **Everyone** (all roles, including Read only), **Members** (Member and above) and **Admins** (Admin and above). Custom roles keep working as built-in groups of their holders. These replace app-role data grants. (Corrected during S1: today a Member grant does not cover Read-only people, so two built-ins were not enough.)
- Access can still go to **one person** directly. That covers exceptions and approved requests; groups are the normal case.
- Later: sync members from Entra groups.

### 3.2 Access: who can open which data (table level)

"*Group or person* can **use** *catalog / schema / table*." It replaces Data map grants.

- **One level, Use** (read rows, charts, dashboards), plus an **Allow export** switch. "Discover" goes away: every signed-in person can see table and column **names** and types, never values, so they can find data and request it (Databricks does the same with BROWSE plus Request access).
- Access on a catalog covers its schemas and tables; access on a schema covers its tables.
- **Block** stays for exceptions ("everyone in Marine except this table") but moves under an Advanced option.
- Deny by default: no access means no rows.

### 3.3 Protections: which sensitive data inside (column or whole table)

"*Compensation* is sensitive; only *Payroll team* sees the values." It replaces Labels, clearance and column tags.

- A protection has a **name** (shown to people without access: "you don't have access to Compensation data"), **who can see it** (groups or people, at **Exact values** or **Totals only**) and an optional **two approvals** flag.
- It applies to **columns** (salary, email) or to a **whole table, schema or catalog** ("Confidential finance").
- Without access:
  - a protected **column** comes back masked (`•••`); filtering or sorting by it is refused;
  - a protected **table** is refused, and its name stays visible with **Request access**.
- A column or table can carry more than one protection; a person needs all of them.
- **Totals only** means `sum`, `avg`, `count`, `stddev` and `variance` (and their variants). `min`, `max`, `median`, `percentile`, `first`/`last`, `any_value`, `max_by`/`min_by` and list functions (`collect_list`, `array_agg`, …) return individual values, so they need Exact values (review C2, 2026-11-09). Known limit: two totals over groups that differ by one person reveal that person's value.
- Joining a group that holds a protection is a protection grant. The group's owners (or a platform admin) add members, but an end date (at most 365 days, or the protection's own limit) is required, and the addition is audited as `access.protection.granted_via_group` (review C4; owners keep this right by decision on 2026-11-09).
- Views the app generates inherit every protection of their source table as a whole-path protection (review C5, phase 1). Other views are not yet covered.

### 3.4 One request flow

Every refusal and every mask offers **Request access**, filled in with what was refused (the Databricks pattern). It goes to:

1. the approver of the **protection**, for protected data; else
2. the approver of the **access** (the group that owns that catalog, schema or table, inherited from above); else
3. platform admins.

Requests default to **30 days**. **Auto-approve** can be switched on per access rule for low-risk, unprotected data (the Immuta pattern), so most "can I use this table?" requests need no human. Everything is recorded in the append-only history already built (`access_request_events`).

### 3.5 The decision, in one place

```text
1. Can open the table?
     Block on the path for the person or any of their groups → no
     Use on the path (or a parent) for the person, a group, Everyone or Admins → yes
     otherwise → no                                  → "Request access to <table>"
2. Table or a parent protected?  the person needs every protection on it → else refused
3. For each column used:
     protected and the person lacks it → output: masked; filter, sort, join: refused
4. Run; mask; log the decision.
```

Platform admins see **all data** (Use + export on every path, past any Block, every protection at Exact values). This replaced D3 ("platform admins get nothing automatically") on 2026-11-09 at the user's request. Nobody gives access to themselves.

## 4. What the admin sees

One **Data access** page with four tabs instead of six:

| Tab | Purpose |
|---|---|
| **Data** | The estate tree (catalog → schema → table → **columns**). Each row shows "Used by: Marine, Everyone" and any 🔒 protections. Select rows to **give access** or **protect**. One place for both levels (option 2). |
| **Protections** | The list built on 2026-11-08: names first, then their columns and tables, who can see them, and **New protection**. |
| **People & groups** | Groups with approvers and members; for each person, "what can this person see?" with a **Why?**. |
| **Requests & log** | Pending requests to approve, history (30 / 60 / 90 days), decisions. |

Removed: the Labels tab, clearance controls, the department-only Data map lists, and the Discover / Query / Export picker.

## 5. Mapping from today (migration)

| Today | Becomes |
|---|---|
| Department (with members) | Group with the same members; approver = the platform admin who runs the migration until changed |
| Access group | Group (the same table) |
| Grant to a department, person or role | Access for the group, person, **Everyone** (Member / Read only role) or **Admins** (Admin role) |
| Level discover | Dropped (names are visible to everyone) |
| Level query | Use |
| Level export | Use + Allow export |
| Block | Block (Advanced) |
| Label Confidential / Restricted on a path | Protection named "Confidential" / "Restricted" applied to that path |
| Clearance Confidential / Restricted for a person | That person given the matching protection(s) directly; Restricted clearance also gives Confidential |
| Protection (data tag) on columns | Unchanged |
| Tag grant | Unchanged ("who can see") |

On dev today that is 2 departments (no members), 2 grants, 1 label and no clearances, so the migration moves almost nothing. The migration is additive first (new tables and columns alongside), then switches reads, then removes the old screens. No `DROP` in this phase; old tables are retired in a later, separately approved step.

## 6. Data model changes (additive)

- `access_groups`: add `kind` (`group` | `builtin`) and `entra_group_id`. Copy departments in, with their members.
- `access_grants`: allow `principal_type = 'group'`; add `allow_export` (boolean). Keep existing rows readable during the switch.
- `access_column_tags` → generalise to **protected paths**: add `path_depth` so a protection can sit on a catalog, schema or table (empty `column_name`) as well as a column. Alternatively a sibling table `access_path_protections`. Decide in build.
- `access_tags`: add `approver` fallback (the protection's own approver for requests).
- Request routing reads protection → access owner → platform admins.

## 7. Plan

| Step | Scope | Exit |
|---|---|---|
| **S1. Engine** ✅ 2026-11-08 | `src/lib/access/engine.ts`: `canOpen` (Use / export, Block, bootstrap), `decideColumnUse`, whole-path and column protections, built-in groups, `fromLegacy()` mapping. Tests: `src/lib/access/__tests__/engine.test.ts`. | Met: on 3,000 random rule sets each, old and new engines agree on >200,000 table decisions and every column decision; each outcome type is exercised; a deliberately broken engine fails the test. |
| **S2. Migration** ✅ applied on dev 2026-11-08 | Migration `20261108_simplified_access` (new tables `access_rules`, `access_path_protections`; `access_groups.migrated_from_department_id`). Pure mapping `src/lib/access/migrate-plan.ts`; loader `src/lib/access/model-store.ts`; scripts `scripts/access/simplified-model-dry-run.ts` (read-only) and `scripts/access/simplified-model-migrate.ts` (plan by default; `--apply --approver=<email>` inserts, idempotent). | Met before applying: dev dry run 0 differences on 101,070 decisions, today and after a simulated copy; 2,000 random worlds agree end to end. Applied on dev (user approval): 2 groups (approver senthilnathan.s), 2 rules, protection Restricted on `system`; the dry run against the real new tables shows 0 differences on 101,070 decisions; a re-run copies nothing; old tables unchanged. Other environments still need the migration and the copy. |
| **S3. Screens** ✅ 2026-11-08 | Runtime reads switched to the new tables (`authorize.ts`, `visibility.ts`, knowledge-sync samples) through `getAccessModel` (cached per policy version). New APIs: `data-tree`, `data-tree/columns`, `rules` (PUT), `path-protections`, `person`. Four tabs: **Data** (`DataView`), **Protections** (`ColumnAccessView`, also lists whole-path protections), **People & groups** (`PeopleGroupsView`), **Requests & log** (`AccessLogView`; requests come in S4). Users drawer shows a read-only summary. Old tabs (Data map, Labels, People, Setup guide) removed from the page; their components and APIs remain until the old tables are retired. | Admin tasks covered by the four tabs; 1,411 tests pass; read-only smoke test on dev passed. |
| **S4. Requests** ✅ 2026-11-08 (auto-approve, housekeeping job, in-app notices added; see CHANGELOG) | `src/lib/access/requests.ts` (routing: protection → owners of groups holding it, two-approval tags add a platform admin; path → owners of groups whose Use covers it; fallback platform admins; never the requester; duplicate and 24 h cool-down limits; approval grants the person directly with an end date). APIs `requests` (GET mine / inbox / history ≤ 90 days; POST ask) and `requests/[id]` (GET history; POST approve with narrower level / shorter time, reject, ask_info, info_given, cancel; two approvals). Append-only events. Screens: **My data access** (`/my-access`, user menu; what I can see, ask form with `?tag=` / `?path=` prefill, my requests) and **Requests & log** tab (To approve, history 30 / 60 / 90 + CSV, decision log). Refusal messages link to `/my-access?path=…`. | Routing checked on dev (read-only). Not yet: auto-approve, expiry / escalation job, notifications, a Request button inside chat answers for masked columns (comes with masking, E8-T5). |
| **S5. Shadow, pilot, enforce** 🟡 built, not switched on | Column masking in the query path (`sql-columns.ts` parser, `column-guard.ts`, `COLUMN_ACCESS_MODE=off/shadow/enforce`), AI access note + answer rules, describe_schema value stripping, export refusal, replay script, Column check health panel. Manual test guide: `manual-test-guide.md`. | Replay on dev: parser reads 98.1% of 155 past AI queries, 0.13 ms p50. Next: run in shadow for a week, review health gates, pilot, enforce. |

The column masking engine (E8-T5) and AI-proofing (E10) are unchanged and fit into S1 and S5.

## 8. Decisions needed

| # | Question | Recommendation |
|---|---|---|
| A1 | May every signed-in person see table and column **names** (never values)? | Yes, so they can find data and request it. Labelled tables were hidden before (D2); under this model a protected table's name is visible but refused. |
| A2 | Keep direct access for one person, or groups only? | Keep both; groups are the normal case, people are for exceptions and approved requests. |
| A3 | Keep Block? | Yes, under Advanced. |
| A4 | Auto-approve unprotected table requests? | Allowed per access rule, off by default. |
| A5 | Built-in **Everyone** and **Admins** groups instead of app-role data grants? | Yes. |
| A6 | Entra group sync? | Later; the model allows it. |

## 9. Sources

- Databricks: [ABAC overview](https://docs.databricks.com/aws/data-governance/unity-catalog/abac), [row filter and column mask policies](https://learn.microsoft.com/en-us/azure/databricks/data-governance/unity-catalog/abac/policies), [GA announcement](https://www.databricks.com/blog/abac-row-filtering-and-column-masking-policies-governed-tags-and-data-classification-are-now), [access request destinations](https://docs.databricks.com/aws/data-governance/unity-catalog/manage-privileges/access-request-destinations)
- Snowflake: [sensitive data classification](https://docs.snowflake.com/en/user-guide/classify-intro), [tag-based masking](https://www.snowflake.com/en/blog/protect-sensitive-data-tag-based-masking/)
- Google BigQuery: [mask column data](https://docs.cloud.google.com/bigquery/docs/column-data-masking)
- Immuta: [subscription policies](https://documentation.immuta.com/2023.4/write-policies/reference-guides/subscription-policies), [request app](https://documentation.immuta.com/saas/knowledge-base/implementation/marketplace/getting-started-with-marketplace), [how Immuta does policy](https://www.immuta.com/blog/how-immuta-does-policy-a-practical-guide-to-governed-data-access/)
- Role explosion and ABAC: [Databricks community: mastering ABAC](https://community.databricks.com/t5/technical-blog/mastering-databricks-abac/ba-p/126062) (vendor sources; directional)
