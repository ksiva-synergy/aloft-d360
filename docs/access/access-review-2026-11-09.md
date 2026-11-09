# Data access review — 2026-11-09

**Scope:** the simplified access model ([simplified-access-model.md](simplified-access-model.md)) as enforced in this app: decision engine, model loader, SQL table and column guards, every warehouse query path, requests and approvals, group and protection APIs, and the visibility cache.
**Readers:** engineers working on `src/lib/access/**` and the people who decide access policy.
**Status:** C1–C4, H1–H7 and four medium items are fixed and tested. C5 is fixed for views the app generates only. See [Fix status](#fix-status). The rest of this document is the original review, kept as written.

## Fix status

Updated 2026-11-09, same day as the review. Tests: `npx vitest run src/lib/access src/app/api/access src/lib/dashboards src/lib/semantic src/lib/inspector src/app/api/inspector src/components/access src/components/inspector`. Result: 808 passed and 2 failed. The 2 failures are in `RequestsViews.test.tsx` ("My data access") and were failing before this work. Not tested in a running app.

| ID | Status | What changed | Tests |
|----|--------|--------------|-------|
| C1 | ✅ Fixed | [sql-tables.ts](../../src/lib/access/sql-tables.ts): `readSources` reads every source after FROM or JOIN, including comma lists. `fromClauseCommas` catches `, table` after a join condition. `TABLE x` is checked. `LATERAL VIEW`, `PIVOT`, `TABLESAMPLE` and table functions are refused. The scan covers the whole statement, so sub-queries and CTE bodies are read too. `IS [NOT] DISTINCT FROM` and Delta `VERSION/TIMESTAMP AS OF` are not misread. | `sql-tables.test.ts` (7 new), `authorize-sql.test.ts` |
| C2 | ✅ Fixed | [sql-columns.ts](../../src/lib/access/sql-columns.ts): new `TOTALS_SAFE` set (sum, avg, count, count_if, approx_count_distinct, stddev*, variance*). A column inside any other aggregate (min, max, median, collect_list, max_by, …) counts as output, so "Totals only" masks or refuses it. | `sql-columns.test.ts` (17 new) |
| C3 | ✅ Fixed | [model-store.ts](../../src/lib/access/model-store.ts): bootstrap is open only with `ACCESS_BOOTSTRAP_OPEN=true` **and** no rules. The count uses all stored rules, so archiving a group doesn't reopen anything. Missing access tables now refuse everything and are reported. | `migrate-plan.test.ts` (updated) |
| C4 | 🟡 Narrowed | [members/route.ts](../../src/app/api/access/groups/[id]/members/route.ts): if the group holds an active protection grant, an end date is required (at most 365 days or the protection's own limit), and `access.protection.granted_via_group` is audited. **Group owners can still add members** (user's decision, 2026-11-09). So an owner can still hand out the group's protection, but only for a limited time and with an audit record. "Nobody adds themselves" still applies. | `column-access-routes.test.ts` (4 new) |
| C5 | 🟡 Phase 1 | [metric-views.ts](../../src/lib/semantic/metric-views.ts): before a generated view is created, every protection on its source (column or whole-path) is added as a whole-path protection on the view. **Phases 2–3 not done:** views made outside the app are still unprotected. Note that `applyMetricViews` currently has no callers. | `metric-views-access.test.ts` (3 new) |
| H1 | ✅ Fixed | [status/route.ts](../../src/app/api/access/status/route.ts) returns `columnAccessMode` and `configErrors`. The badge in [data-access.tsx](../../src/views/agent-staging/data-access.tsx) reads e.g. "Enforced · columns not masked", in amber unless both are enforced. | not tested in the UI |
| H2 | ✅ Fixed | New `viewerPrincipalRequired()` in [column-guard.ts](../../src/lib/access/column-guard.ts): table checks **or** column masking on means a real person is required. Raw dashboard SQL, semantic queries and Inspector tools no longer fall back to the system account then. | covered by dashboard and Inspector suites |
| H3 | ✅ Fixed | [config.ts](../../src/lib/access/config.ts) and `columnAccessMode()`: an unrecognised value means **enforce**, is logged once, and shows on the badge. | `authorize-sql.test.ts` |
| H4 | ✅ Fixed | [visibility.ts](../../src/lib/access/visibility.ts): the cache key is a hash of the sorted paths plus the current minute, so expiry applies within 60 s. | `visibility.test.ts` (2 new) |
| H5 | ✅ Fixed | [requests.ts](../../src/lib/access/requests.ts) `grantApproved`: approval merges with existing access, keeping export, Exact values, and the later or no end date. Expired rows aren't carried over. | `grant-approved.test.ts` (5 new) |
| H6 | ✅ Fixed | `previewPathGrant` in [engine.ts](../../src/lib/access/engine.ts), and `assertApprovalTakesEffect` in requests.ts. Approving Use under a Block returns 409 naming the Block. A whole-path protection the person lacks returns 409, unless they already have an open request for it. Auto-approve falls back to a person instead of approving something that wouldn't work. | `requests-routes.test.ts` (2 new) |
| H7 | ✅ Fixed | [widget-preview.ts](../../src/lib/dashboards/widget-preview.ts): single-widget and preview refreshes run as the viewer, for raw SQL and semantic queries. | `widget-preview*.test.ts` (updated) |
| Admin logging | ✅ Fixed | [authorize.ts](../../src/lib/access/authorize.ts): admin reads that skip name resolution are logged with reason `platform_admin_unresolved`. | `authorize-sql.test.ts` |
| Partial logging | ✅ Fixed | Every decision for a person is logged, allowed reads included. System principals are logged only when refused. **Check the decision-log table's size and retention after a week.** | `authorize-sql.test.ts` |
| Self-access via groups | ✅ Fixed | [rules/route.ts](../../src/app/api/access/rules/route.ts): non-platform-admins can't give Use to a group they belong to, or to the built-in Admins group. Narrowing (Block, none) is still allowed. | `column-access-routes.test.ts` |
| Approvers grant more than they hold | ✅ Fixed | `assertApproverCanGrant` in requests.ts: a non-admin approver can approve only up to what the groups they own hold (Totals only vs Exact values, Use vs export). It runs before the two-approval step. | `requests-routes.test.ts` (2 new) |
| Group owners approve data access | ❌ Not done | Needs a data-owner role per catalog or schema: a model and UI change. |  |
| Auto-approve is organisation-wide | ❌ Not done | This is a policy decision (self-serve for everyone is the flag's purpose). It now never auto-approves something that wouldn't work. |  |
| Renames drop protections | ❌ Not done | Needs a nightly check job. |  |
| Names visible to everyone | ❌ Not done | Decision A1 stands. |  |
| Subtraction attack on totals | 📝 Documented | Recorded in [simplified-access-model.md](simplified-access-model.md) §3.3 as a known limit. |  |
| Enforcement only in the app | ❌ Not done | Databricks Unity Catalog grants and column masks for the service principal: infrastructure work. |  |
| Edge cases (deactivated users, archive preview, expiry reminders, quoted names) | ❌ Not done |  |  |

**Before deploying:**
- Any environment that relies on "no rules = open" must set `ACCESS_BOOTSTRAP_OPEN=true`, or it will refuse unprotected data.
- An environment with a mistyped `ACCESS_MODE` will start enforcing.
- Adding a member to a group that holds a protection now needs an end date.
- Owners whose groups lack export can no longer approve export requests.

## How to read this document

Every finding uses the same headings:

- **What it is:** the problem in plain words.
- **Why it happens:** the code that causes it.
- **Example:** a concrete query or action that shows it.
- **Impact:** who can do what because of it.
- **How we'll fix it:** the change, file by file.
- **Tests:** what must be added to prove the fix.
- **Done when:** the check that closes the finding.

## Summary

The design is sound: Block wins, deny by default, and a person needs every protection on the data. The enforcement isn't. There are **five ways to read data a person shouldn't see** (C1–C5). C1 was confirmed with 21 test queries against the extractor. C2–C5 follow directly from the code cited.

**Do not set `COLUMN_ACCESS_MODE=enforce` on real HR or compensation data until C1–C4 and H3 are fixed.**

| ID | Severity | Problem | Fix in one line | Effort |
|----|----------|---------|-----------------|--------|
| [C1](#c1-comma-joins-skip-the-table-check) | Critical | Comma joins and `TABLE x` skip the table check | Read the whole FROM list; refuse what can't be read | S |
| [C2](#c2-totals-only-returns-individual-values) | Critical | "Totals only" allows `collect_list`, `max`, … | Only sum/avg/count/stddev/variance count as totals | S |
| [C3](#c3-fail-open-bootstrap) | Critical | Zero rules or missing tables opens everything | Explicit setting; missing tables fail closed | S |
| [C4](#c4-group-owners-can-hand-out-protections) | Critical | Group owners hand out protections via membership | Platform admin needed for groups holding protections | S–M |
| [C5](#c5-views-arent-protected) | Critical | Views over protected tables aren't protected | Copy protections to views; refuse unreviewed views | L |
| [H1](#h1-the-enforced-badge-ignores-column-masking) | High | "Enforced" badge ignores column masking | Show both modes | XS |
| [H2](#h2-column-masking-does-nothing-when-access_modeoff) | High | Masking off when `ACCESS_MODE=off` | Always run as the viewer | S |
| [H3](#h3-a-typo-in-the-mode-turns-enforcement-off) | High | `ACCESS_MODE=enforced` means off | Unknown value means enforce, and is reported | XS |
| [H4](#h4-the-visibility-cache-returns-the-wrong-answer) | High | Cache keyed by count of paths | Key by the paths; expire within 60s | S |
| [H5](#h5-approving-a-request-can-downgrade-access) | High | Approval overwrites wider access | Merge: keep the wider access and later end date | S |
| [H6](#h6-approvals-that-change-nothing) | High | Approved but still refused | Check the outcome before approving | M |
| [H7](#h7-single-widget-refresh-breaks-when-access-is-on) | High | Widget refresh throws | Pass the viewer | XS |

Effort: XS < 1h, S ≈ half a day, M ≈ 1–2 days, L = design work.

---

## Critical: data leaks

### C1. Comma joins skip the table check

**What it is.** Before a query runs, the app lists the tables it reads and checks the person may use each. The list is incomplete. A table named after a comma in the FROM clause, or after the `TABLE` keyword, is never checked.

**Why it happens.** `scanFromJoins` in [sql-tables.ts:90](../../src/lib/access/sql-tables.ts) uses the regex `\b(?:from|join)\s+([^\s,()]+)`, which captures one name after each `FROM` or `JOIN` and stops at the comma. Anything after the comma is ignored. `TABLE d.e.f` has no `FROM` at all, so nothing is captured and the empty list means "allowed".

**Example (all confirmed):**

| SQL | Tables checked | Should be |
|-----|----------------|-----------|
| `SELECT * FROM a.b.c t1, d.e.f t2` | `a.b.c` | `a.b.c`, `d.e.f` |
| `SELECT * FROM a.b.c, d.e.f WHERE …` | `a.b.c` | both |
| `TABLE d.e.f` | none, so allowed | `d.e.f` |
| `WITH t AS (SELECT 1) SELECT * FROM t, d.e.f` | none: `t` is a CTE and `d.e.f` is never read | `d.e.f` |

**Impact.**
- Anyone who can query one table through Inspector or a dashboard can read **any** table: `SELECT s.* FROM allowed.x.y a, secret.hr.salaries s`.
- The column guard ([column-guard.ts](../../src/lib/access/column-guard.ts)) masks protected columns only in the tables on that list, so protected columns in the unchecked table come back **unmasked**.
- The AI writes comma joins on its own, so this can happen by accident, not only on purpose.

**How we'll fix it.**
1. In [sql-tables.ts](../../src/lib/access/sql-tables.ts), replace the single capture with a FROM-list reader. After `FROM`:
   - read a name;
   - skip an optional alias (`AS x` or `x`);
   - if the next character is `,`, read another name and repeat;
   - stop at `)`, the end of the statement, or a clause keyword (`WHERE`, `GROUP`, `HAVING`, `ORDER`, `LIMIT`, `QUALIFY`, `WINDOW`, `UNION`, `INTERSECT`, `EXCEPT`, `JOIN` and its modifiers, `ON`, `USING`).
   ```ts
   // sketch
   const FROM_END = /^(?:where|group|having|order|limit|qualify|window|union|intersect|except|join|inner|left|right|full|cross|natural|semi|anti|on|using)\b/i;
   function readFromList(sql: string, at: number): { names: string[] } | { fail: string } { … }
   ```
2. Anything the reader doesn't recognise **fails closed** with `sql_unresolved`: `LATERAL VIEW`, `PIVOT`, `TABLESAMPLE`, `VALUES` in FROM, or a name it can't parse.
3. Refuse a statement that starts with `TABLE` unless the name after it is read and checked like any other.
4. Apply the same reader inside sub-queries and CTE bodies, since the nested scan reuses `scanFromJoins`.
5. Later, merge this with the tokenizer in [sql-columns.ts](../../src/lib/access/sql-columns.ts) so the table guard and column guard read SQL the same way.

**Tests** (add to `src/lib/access/__tests__/sql-tables.test.ts`):
- The four rows above.
- Three-way comma joins, with and without aliases and `AS`.
- A comma join inside a sub-query, inside a CTE body, and inside `IN (SELECT …)`.
- A comma inside a function in the SELECT list (`concat(a, b)`) must not be read as a table.
- `LATERAL VIEW explode(…)` is refused.

**Done when** every table in a comma list appears in `extractTablesForAuthorization(...).paths`, and the existing 387 access tests still pass.

### C2. "Totals only" returns individual values

**What it is.** "Totals only" (aggregate level) is meant to let someone see sums and averages over a protected column, such as total salary per department, but never one person's value. The app counts some functions as totals even though they return individual values.

**Why it happens.** The column parser marks a column as aggregated if it sits inside any function in `AGGREGATES` ([sql-columns.ts:146](../../src/lib/access/sql-columns.ts), used at line 327). That set mixes real totals with functions that return single rows or lists:
- returns a list of every value: `collect_list`, `collect_set`, `array_agg`, `string_agg`, `listagg`;
- returns one person's exact value: `min`, `max`, `min_by`, `max_by`, `first`, `last`, `first_value`, `last_value`, `any_value`, `mode`, `median`, `percentile`, `percentile_approx`, `approx_percentile`.

**Example.** A person with Compensation · Totals only runs:
- `SELECT dept, collect_list(salary) FROM hr.core.employees GROUP BY dept`: every salary, listed by department.
- `SELECT max(salary) FROM hr.core.employees WHERE dept = 'Legal'`: the highest salary in Legal, which belongs to one person.
- `SELECT max_by(name, salary) …`: who earns the most.

**Impact.** "Totals only" gives the same access as "Exact values" for anyone who knows these functions. The AI uses `max`, `min` and `median` routinely.

**How we'll fix it.**
1. In [sql-columns.ts](../../src/lib/access/sql-columns.ts), keep `AGGREGATES` for understanding query shape (GROUP BY detection), and add a second set:
   ```ts
   /** Functions whose result never reveals an individual row's value. Only these satisfy "Totals only". */
   export const TOTALS_SAFE = new Set([
     'sum', 'avg', 'mean', 'count', 'count_if', 'approx_count_distinct', 'sum_distinct',
     'stddev', 'stddev_pop', 'stddev_samp', 'std', 'variance', 'var_pop', 'var_samp',
   ]);
   ```
2. Where the parser pushes `'agg'` (line 327), push `'agg'` only for `TOTALS_SAFE` functions. A column inside `max(…)` or `collect_list(…)` is then treated as an output column, and at aggregate level the existing rules refuse or mask it.
3. Exclude `corr`, `covar_*`, `regr_*`, `kurtosis` and `skewness` for now. They can leak values with small or crafted groups. They can be added back after review.
4. Make the denial message say which function was refused and suggest `avg` or `sum`.

**Tests** (in the column-guard and sql-columns tests):
- For each removed function: refused at aggregate level, allowed at full level.
- `sum`, `avg`, `count` and `stddev` still allowed at aggregate level, with the minimum group size of 5 still added.
- A function nested inside a safe one (`sum(max(salary))`) is refused.

**Done when** none of the example queries returns individual values for a "Totals only" holder.

**Known limit even after the fix: differencing.** Two allowed queries whose groups differ by one person, for example "total salary of Legal" and "total salary of Legal excluding Ana", reveal that person's value. See [Medium](#medium-design-gaps).

### C3. Fail-open "bootstrap"

**What it is.** When the app was first installed, no access rules existed. So that nothing broke, "no rules at all" was treated as "everything open". That shortcut is still live and can turn back on.

**Why it happens.**
- [model-store.ts:77](../../src/lib/access/model-store.ts): `bootstrapOpen: rules.length === 0`. Rules belonging to archived groups are removed **before** this count.
- [model-store.ts:111–132](../../src/lib/access/model-store.ts): if the access tables don't exist (Prisma error `P2021`), the loader uses `EMPTY`, which has `bootstrapOpen: true`.

**Example.**
1. The access admin (not a platform admin) archives the last group that holds rules, or removes the last rule. Every table without a protection opens to everyone.
2. A production deploy runs before the migration `20261108`. The tables are missing, the loader falls back to `EMPTY`, and the estate is fully open with no error.

**Impact.** One routine admin action, or one missed migration, removes all table-level access control without warning.

**How we'll fix it.**
1. Add an explicit setting, `bootstrap_open` (boolean, default `false`), on the access policy row, or as `ACCESS_BOOTSTRAP_OPEN` while a table change is pending. Set it only on purpose during first setup.
2. In `buildAccessModel`, use the setting instead of `rules.length === 0`.
3. Change `EMPTY` to `bootstrapOpen: false`. When the tables are missing, log `console.error('[access] access tables missing — failing closed')` and return a status the badge can show ("Access tables missing").
4. Log every decision allowed because of bootstrap with reason `bootstrap_open`, so the open period is visible.
5. Show a banner on the Data access page while bootstrap is on.
6. **Rollout check:** before deploying, confirm every environment has at least one rule, or set the flag where the open behaviour is still wanted.

**Tests:**
- A model with zero rules and the flag off denies.
- With the flag on, it allows and logs `bootstrap_open`.
- A missing table denies.
- Archiving the last group doesn't open anything.

**Done when** the open state is reached only through the explicit setting.

### C4. Group owners can hand out protections

**What it is.** Giving someone a protection directly, such as Compensation · Exact values, needs a platform admin. A group can also hold a protection, and the group's owner can add anyone to the group. The new member then has the protection without any platform admin involved.

**Why it happens.** `POST` in [groups/[id]/members/route.ts](../../src/app/api/access/groups/[id]/members/route.ts) checks only that the caller manages the group (`requireGroupMemberManager`) and isn't adding themselves (line 36). It doesn't check whether the group holds protection grants, and the end date (`expiresAt`) is optional.

**Example.**
- Group "HR Comp" holds Compensation · Exact values. Its owner adds a colleague in Sales with no end date, and that colleague can now read every salary.
- Two owners of the same group can add each other, which defeats the "nobody adds themselves" rule.
- Adding members this way also skips the "two approvals" rule that applies to requests.

**Impact.** The protection system's strongest control, the platform-admin-only grant, can be bypassed by anyone who owns a group holding a protection.

**How we'll fix it.**
1. In the members `POST`, before the upsert, load the group's active protection grants:
   ```ts
   const held = await prisma.accessTagGrant.findMany({
     where: { org_id: orgId, principal_type: 'group', principal_id: groupId,
              OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }] },
     select: { tag_id: true, level: true },
   });
   ```
2. If `held` isn't empty and the caller isn't a platform admin, return 403: "This group gives access to protected columns (Compensation · Exact values). A platform admin must add members, or the person can request access."
3. For these groups, require `expiresAt`, even for platform admins. Allow at most 365 days; the exact limit is a policy choice.
4. Write an extra audit event, `access.protection.granted_via_group`, naming the protections, so it appears alongside direct grants.
5. UI ([PeopleGroupsView.tsx](../../src/components/access/console/PeopleGroupsView.tsx)): for non-admins, disable **Add people** on such groups with the reason, and show the protections the group carries in its header.
6. Removing members stays open to owners, because removing only narrows access.

**Tests** (route tests):
- An owner adding to a group with a protection: 403.
- A platform admin adding without an end date: 400.
- A platform admin with an end date: 201 and both audit events.
- An owner adding to a group with no protections: unchanged.

**Done when** the only ways to gain a protection all require a platform admin or an approved request.

### C5. Views aren't protected

**What it is.** Protections and rules are attached to table paths. A view is a separate path. A view that selects from a protected table carries no protection, so reading the view returns the protected columns.

**Why it happens.**
- Column protections match `table_path` exactly ([model-store.ts:53](../../src/lib/access/model-store.ts)).
- Nothing records which tables a view reads from.
- [metric-views.ts](../../src/lib/semantic/metric-views.ts) creates new views in Databricks, and these start with no protections.

**Example.** `hr.core.employee_master.salary` is protected. A view `hr.reporting.v_headcount` selects `*` from it. Anyone with Use on `hr.reporting` can run `SELECT salary FROM hr.reporting.v_headcount` and get every value unmasked.

**Impact.** Any view, including ones the app creates, can expose protected columns.

**How we'll fix it** (in phases):
1. **Phase 1, views the app creates.** When [metric-views.ts](../../src/lib/semantic/metric-views.ts) creates a view, copy each source column's protections onto the matching view column (`access_column_tags`, status `confirmed`, noted as from lineage). Refuse to create the view if lineage can't be worked out.
2. **Phase 2, existing views (interim guard).** Add a nightly job that lists views (`information_schema.views`, read with the service principal) and their source tables. If a view reads a protected table, add a path protection on the view, or mark it "needs review". Queries on views marked "needs review" are refused until a platform admin confirms the column protections.
3. **Phase 3, lineage.** Use Unity Catalog column lineage (`system.access.column_lineage`) to propagate protections automatically. Show the propagated protections in the Data tab with "from lineage".

**Tests:**
- A metric view created over a protected column carries the protection.
- A query on an unreviewed view over a protected table is refused.

**Done when** no view over a protected table can be read without the same protection.

---

## High: wrong behaviour or misleading signals

### H1. The "Enforced" badge ignores column masking

- **What it is.** The Data access page says "Enforced" while protected columns are not masked.
- **Why it happens.** [data-access.tsx:44–49](../../src/views/agent-staging/data-access.tsx) reads only `accessMode`. `COLUMN_ACCESS_MODE` defaults to `off` ([column-guard.ts:26](../../src/lib/access/column-guard.ts)) and isn't shown.
- **Impact.** Admins believe salaries are protected when they aren't.
- **How we'll fix it.**
  - Return `columnAccessMode` from [status/route.ts](../../src/app/api/access/status/route.ts).
  - Show two lines on the badge: "Tables: Enforced" and "Protected columns: Off / Shadow / Enforced", in amber when columns are off but protections exist.
- **Done when** the badge reflects both modes; add a render test for each combination.

### H2. Column masking does nothing when `ACCESS_MODE=off`

- **What it is.** Turning on `COLUMN_ACCESS_MODE=enforce` doesn't mask anything on dashboard SQL if `ACCESS_MODE` is `off`.
- **Why it happens.** With access off, [execute-raw-sql.ts:26–34](../../src/lib/dashboards/execute-raw-sql.ts) runs the query as `systemPrincipal('health')`. The column guard returns early for anything that isn't a user ([column-guard.ts:130](../../src/lib/access/column-guard.ts)).
- **Impact.** The two settings look independent, but the column setting silently depends on the table setting.
- **How we'll fix it.**
  - Always pass the viewer's principal when one exists, whatever `ACCESS_MODE` is.
  - In `runWarehouseQuery`, skip only the table check when `ACCESS_MODE=off`, and let the column guard decide from its own mode.
  - Use `systemPrincipal` only for real background jobs.
- **Tests:** with `ACCESS_MODE=off` and `COLUMN_ACCESS_MODE=enforce`, a dashboard query on a protected column comes back masked.

### H3. A typo in the mode turns enforcement off

- **What it is.** Any value of `ACCESS_MODE` the app doesn't recognise is treated as `off`, with no warning.
- **Why it happens.** [config.ts:7–11](../../src/lib/access/config.ts) returns `'off'` for anything outside `off | observe | enforce`.
- **Example.** `ACCESS_MODE=enforced`, `ACCESS_MODE=on` or `ACCESS_MODE=Enforce ` (trailing space is trimmed, but `enforced` isn't).
- **How we'll fix it.**
  - Unknown values become `enforce` (fail closed).
  - Log `console.error` once at startup.
  - Expose `configError` through the status route, so the badge says "ACCESS_MODE value 'enforced' not recognised — enforcing".
  - Do the same for `COLUMN_ACCESS_MODE` in [column-guard.ts](../../src/lib/access/column-guard.ts).
- **Tests:** unknown values for each variable give `enforce` and an error flag.

### H4. The visibility cache returns the wrong answer

- **What it is.** The cache that decides which tables and objects a person sees in lists can return another list's result.
- **Why it happens.** [visibility.ts:52](../../src/lib/access/visibility.ts) and [visibility.ts:71](../../src/lib/access/visibility.ts) build the key from the user, roles, level, policy version and **the number of paths**, not the paths. The key also has no time in it, so a rule or grant that expires stays in effect until the policy version changes.
- **Example.** One page asks about 10 paths in catalog A, and a second asks about 10 paths in catalog B. The second gets the first's answer, which can show objects from B the person can't use, or hide ones they can.
- **How we'll fix it.**
  ```ts
  const digest = createHash('sha1').update([...objectPaths].map((p) => p.toLowerCase()).sort().join('\n')).digest('base64url');
  const minute = Math.floor(Date.now() / 60_000); // expiry is honoured within 60s
  const key = `${cacheKey(principal, level, version)}:${minute}:${digest}`;
  ```
  Do the same for `visibleObjectIds`, using the object ids and paths.
- **Tests:**
  - Two lists of equal length give different results.
  - An expiring rule disappears within 60s (use fake timers).

### H5. Approving a request can downgrade access

- **What it is.** Approving a request replaces the person's existing access on that path, even if the existing access was wider.
- **Why it happens.**
  - [requests.ts:166](../../src/lib/access/requests.ts) runs `deleteMany` on the person's Use rules for the path, then creates the approved rule.
  - For protections, the `upsert` at [requests.ts:149](../../src/lib/access/requests.ts) overwrites `level` and `expires_at`.
- **Example.**
  - Ana has permanent "Use + export" on `sales.curated`. She requests "Use" for 30 days for a new project and it's approved. She now has "Use" only, ending in 30 days.
  - Someone with "Exact values" who asks for "Totals only" is downgraded.
- **How we'll fix it.** Merge instead of replacing:
  ```ts
  const existing = await tx.accessRule.findFirst({ where: { ...holder, effect: 'use' } });
  const allowExport = (existing?.allow_export ?? false) || level === 'export';
  const expiresAt = !existing ? until
    : existing.expires_at === null || until === null ? null
    : new Date(Math.max(existing.expires_at.getTime(), until.getTime()));
  // update existing (or create) with allowExport / expiresAt
  ```
  - For protection grants, keep the higher level (`full` > `aggregate`) and the later end date.
  - Show "already has wider access" to the approver in the request detail.
- **Tests:** each pairing (export + no export, permanent + dated, full + aggregate) keeps the wider result.

### H6. Approvals that change nothing

- **What it is.** An approver approves a request, the request shows "Approved", and the person is still refused.
- **Why it happens.**
  - Block always wins in `canOpen`, so a Use rule under a blocked path does nothing.
  - A path with a whole-path protection also needs the protection, which a path request doesn't grant.
  - The approval flow doesn't check the outcome.
- **Impact.** People and approvers think access was given. The person sees "access denied" after an approval and loses trust in the system.
- **How we'll fix it.**
  1. Add `previewGrant(model, requester, path, level)` in [engine.ts](../../src/lib/access/engine.ts). It applies the proposed rule to a copy of the model and runs `canOpen`, returning `ok`, or what still blocks: `block on <path>` or `needs protection <name>`.
  2. Call it when the request detail loads, and again on approve.
  3. If it would still fail:
     - for a missing protection, offer "Also request <protection>" to create a linked protection request;
     - for a Block, refuse the approval with "Blocked by a rule on <path>; remove that rule first".
  4. Never mark a request approved if the person still can't open the path, unless it's linked to a pending protection request.
- **Tests:** an approval under a Block is refused with the reason; an approval on a protected path creates or links the protection request.

### H7. Single-widget refresh breaks when access is on

- **What it is.** Refreshing one raw-SQL widget on a dashboard fails with "Data access principal is required for dashboard SQL."
- **Why it happens.** [widget-preview.ts:114](../../src/lib/dashboards/widget-preview.ts) calls `executeRawSql(widget.rawSql, widget.connectionId)` without the third argument. When access is active, [execute-raw-sql.ts:28](../../src/lib/dashboards/execute-raw-sql.ts) throws.
- **How we'll fix it.** `buildWidgetPreview` already has `actor` (the viewer). Build their principal the way the full dashboard refresh does, and pass it as `executeRawSql(widget.rawSql, widget.connectionId, principal)`.
- **Tests:** single-widget refresh with access on returns rows for an allowed table, and returns a denial (not a crash) for a refused one.

---

## Medium: design gaps

| Gap | What the issue is | How we'll fix it |
|-----|-------------------|------------------|
| **Group owners approve data access** | A path request goes to the owners of any group with Use on that path. Owning "Marine" makes you an approver for all of `curated_db` for anyone. Group owners (who manage people) and data owners (who know the data) are different roles. | Add a **data owner** for each catalog or schema (a person or a group). Route path requests to the data owner, and fall back to the platform admins. Show the owner on the Data tab. |
| **Approvers can grant more than they hold** | An owner whose group has "Totals only" can approve "Exact values", and "Use" holders can approve "Use + export". | Limit approval to the approver's own effective level. Above that, the request escalates to a platform admin. |
| **Self-access through groups** | "Nobody sets access for themselves" checks only rules on a person. An admin can give Use to a group they belong to, including the built-in Admins group. | When writing a rule or grant for a group, refuse it if the actor is a member, unless a second admin approves. Log it either way. |
| **Auto-approve is organisation-wide** | The auto-approve flag on one group's rule lets **anyone** get Use on that path with one click. | Limit auto-approve to members of the groups listed on the rule, or to a named list of departments. Show the scope next to the flag. |
| **Renames drop protections silently** | If a table moves or a column is renamed in Databricks, its rules and protections stop matching. A lost protection means the data opens. | A nightly job compares protection targets with the catalog and lists missing targets on the Data tab. If a protected column disappears from a table that still exists, alert a platform admin. |
| **Names are visible to everyone** (decision A1) | Table names, column names and comments (`preview-columns` returns comments) can be sensitive in themselves, for example `layoffs_2027`. | Keep A1, but add a "hide name" option on a path. Hidden paths are left out of search, the tree and AI context for people without Use. |
| **Subtraction attack on "Totals only"** | Two allowed totals that differ by one person reveal that person's value, even with a minimum group size of 5. | Short term: document it as an accepted limit and log aggregate queries on protected columns. Later: refuse overlapping groups for the same person within a time window, or add small noise to totals. |
| **Partial logging** | Allowed reads are logged only for the Confidential and Restricted tiers ([authorize.ts:25](../../src/lib/access/authorize.ts)). "Who read table X?" can't be answered for most data. | Log every allowed read with the paths, a hash of the query and the number of rows returned. Keep it in a separate, append-only table with a retention policy. |
| **All enforcement is in the app** | The warehouse service principal can read everything at its tier. Genie, notebooks and other tools reaching Databricks directly ignore these rules. | Narrow the service principal's Unity Catalog grants to the tables the app needs. For protected columns, add Unity Catalog column masks as a second layer, so a direct query also gets masked values. |

## Edge cases to decide or verify

| Case | What happens today | Proposed decision |
|------|--------------------|-------------------|
| A person is deleted or deactivated | Their rules, grants and group ownerships stay. Requests may still route to them as an owner. | When a user is deactivated, end their rules and grants and remove them as owner. Alert if a group is left with no owner. |
| All owners of a two-approval group are platform admins | The "one non-admin approver" rule can never be met, so requests get stuck. | Warn when saving the group; allow a platform admin to approve with a recorded reason. |
| A protection is archived | Every column and path using it opens at once, with no preview. | Before archiving, show the columns, paths and holders affected. Require typing the protection's name to confirm. |
| Rules and grants about to expire | Checked correctly at decision time, but nobody is told. | Add an "Expiring in 7 days" list for owners, plus a reminder to the holder. |
| Block on a parent path | It can't be overridden lower down, so "block the catalog except one table" is impossible. This matches the design. | Keep it, and say so in the UI when someone adds a rule under a Block. |
| Quoted names | Hyphens and backticks work. Double quotes and dots with spaces around them are refused (safe, but may block valid AI SQL). | Accept double-quoted identifiers once C1's reader is in place. |

## What's solid

- The engine: Block wins, deny by default, and a person needs every protection on the data.
- Masking falls back to matching by name if the result shape changes.
- Exports are refused if they would contain protected columns.
- Statements that change data, a statement that is `SHOW`, `USE` or `DESCRIBE`, and `IDENTIFIER()` are refused.
- Request history is append-only (a trigger refuses UPDATE and DELETE), requests are rate-limited, and approvers can only narrow what was asked.
- Removing a protection needs a platform admin.
- Dashboards run as the viewer, not the author.

## Changes made the same day

These were made at the user's request, after the review. They aren't fixes for the findings, but they change the picture.

1. **Platform admins see all data** ([engine.ts](../../src/lib/access/engine.ts)). `canOpen` allows them with reason `platform_admin` before any other check, and `protectionLevel` gives them `full` on every protection. This replaces decision D3 in [simplified-access-model.md](simplified-access-model.md).
2. **False refusals in the SQL check fixed** ([sql-tables.ts](../../src/lib/access/sql-tables.ts)):
   - `ORDER BY … DESC` and a column aliased `show` are no longer read as `DESCRIBE` or `SHOW`. Those commands are now matched only at the start of a statement.
   - `FROM` inside `EXTRACT`, `TRIM`, `SUBSTRING`, `SUBSTR`, `OVERLAY` and `POSITION` is no longer read as a table.
3. **Admins skip name resolution** ([authorize.ts:117–121](../../src/lib/access/authorize.ts)). If the extractor fails only because it can't name the tables, a platform admin is allowed.

**Risks these add, and how we'll handle them:**

| Risk | Fix |
|------|-----|
| Anyone with `platform_admin` can read every protected column. | Treat the role like a protection grant: keep a short list, review it quarterly, and show the holders on the Data access page. |
| Admin reads through item 3 are **not logged**, because they bypass `authorizePaths`. | Write a decision-log row with reason `platform_admin_unresolved` in that branch, including the hash of the query. |
| Item 3 has no unit test. | Add tests: an admin with an unqualified name is allowed; a non-admin is refused; an admin issuing DDL or reading `system.*` is still refused. |

## Fix order

| Step | Items | Why this order | Done when |
|------|-------|----------------|-----------|
| 1 | C1, C2 | Small code changes that close the direct leaks | New tests pass; the example queries are refused or masked |
| 2 | C3, H3 | Removes "fail open" in configuration and setup | Zero rules, a missing table or a bad mode value all deny |
| 3 | C4 | Closes the protection bypass through groups | Only platform admins or approved requests can add protections |
| 4 | H1, H4, H5, H7, plus admin logging and tests | Correct signals and no accidental downgrades | Badge shows both modes; cache, approval-merge and widget tests pass |
| 5 | C5, H2, H6 and the medium items | Design work | Each has its own design note and is tracked separately |

**Steps 1–4 must be done before `COLUMN_ACCESS_MODE=enforce` is used with real HR data.**

## How this review was done

- Read: `engine.ts`, `model-store.ts`, `authorize.ts`, `sql-tables.ts`, `sql-columns.ts`, `column-guard.ts`, `warehouse.ts`, `visibility.ts`, `requests.ts`, `config.ts`, the `/api/access/**` routes, `execute-raw-sql.ts`, `widget-preview.ts` and `metric-views.ts`.
- C1 was confirmed with a temporary vitest file (21 queries) run against `extractTablesForAuthorization`. The file was deleted afterwards.
- File and line references were re-checked against the working tree on 2026-11-09, after the same-day changes.
- Nothing was run against live data for C2–C5. They follow from the code as written.
- The code in the fix plans is a sketch of the intended change, not tested code.
