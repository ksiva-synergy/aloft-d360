# Section access

Which screens a person can open, and whether they can take actions there. Separate from
[data access](./data-access-architecture.md): a section level never grants data, and a data grant never
opens a section.

Code: `src/lib/sections/registry.ts` (sections, defaults, rules), `src/lib/sections/server.ts`
(`denyUnlessSection`), `src/lib/sections/useSectionLevels.ts` (UI), `GET /api/me/sections`.

## Levels

| Level | Meaning |
|---|---|
| None | Hidden from the sidebar. The page and its APIs refuse (403). |
| View | Opens read-only. Action buttons are hidden or disabled. |
| Manage | Can take the actions the section offers. |

## How a level is worked out

1. Platform admins: Manage on every section (View on view-only sections such as Audit log and Docs).
2. Everyone else: the highest of their built-in role's default and any `section:<id>:view` /
   `section:<id>:manage` permission keys their roles carry. A role that carries such keys is a
   **bundle** (for example "Agent builder"). A built-in role's default is the table below unless a
   platform admin changed it in the matrix (see Built-in role defaults).
3. Caps: view-only sections never go above View. **Data Estate sections never give Manage to anyone
   but a platform admin**, whatever a bundle says.

## Defaults

| Sections | Read only | Member | Admin | Platform admin |
|---|---|---|---|---|
| Home, Docs | View | None | View | View |
| Inspector, Agents | View | Manage | Manage | Manage |
| History | None | View (own runs) | Manage | Manage |
| Dashboards | View | None | Manage | Manage |
| Data Estate (all 7) | None | None | View | Manage |
| Govern: Models, Users, Data access, Cost monitor, Policies | None | None | View | Manage |
| Govern: Connections | None | None | Manage | Manage |
| Govern: Audit log | None | None | View | View |
| Build: Automate; Memory: Knowledge | None | None | Manage | Manage |
| Other Build and Memory sections | None | None | View | Manage |

Admins see Govern but only platform admins change it (user decision, 2026-11-06), the same rule as
the Data Estate. Unlike the estate, a bundle can give Manage on a Govern section. Connections stay
Manage for members and admins because they are each person's own. Admins use Automate and Knowledge
(user decision, 2026-11-12). This table is what ships (`defaults` in `registry.ts`); platform admins
can change it per built-in role in the matrix.

## Built-in role defaults (Users → Section access)

- Platform admins change the Read only, Member and Admin columns like any bundle column (cell, or
  "All: …" for a whole group), then Save. The change applies to **everyone with that role** on their
  next request. Platform admin cannot be changed: it always has everything.
- Changed cells are tinted, with the shipped level in the tooltip; the column header says
  "Built-in · changed" and offers **Reset** (back to the shipped defaults, applied on Save).
- Stored as `section-default:<role>:<sectionId>:<none|view|manage>` permission keys on the built-in
  role's own row, only for cells that differ from the shipped default (so a later code change to a
  default still reaches every cell nobody changed). People holding the role carry the keys, so they
  are re-read on every request with no cache. No schema change. The prefix is not `section:`, so
  bundle code never touches these keys.
- Same caps as bundles: no Manage on Data Estate or view-only sections.
- People with a custom role are not affected (a custom role sets every section itself). A new custom
  role starts from what its base role gives **today**, including changed defaults.
- API: `PUT /api/sections/role-defaults/[role]` with `{ levels }` (sections left out go back to the
  shipped default). `GET /api/sections` returns `defaults` (today) and `builtInDefaults` (shipped)
  per section, and `roleOverrides`. Audited as `section_role_defaults.updated`.
- A person with no role row at all counts as Member but carries no keys, so they get the shipped
  Member defaults, not changed ones. Sign-in and invites give a role; people waiting for approval
  have none, but cannot use the app until approved (which gives one).

## Section dependencies (a screen that embeds another section)

Some screens call APIs that belong to another section. Each API checks its own section, so without
help those calls get 403 and the embedded feature breaks. `src/lib/sections/uses.ts` lists them:

- **Exact calls only.** Each entry names the host section, the section it uses, and the exact API
  calls (method + path) the host screen makes, each with the host level it needs. Someone with the
  host may make those calls without the other section. The central guard (`denyUnlessSectionForApi`
  in `handle()`) and `connectionActor` / `connectionContext` accept the host as an alternative.
  Per-item rules inside the API still apply. The other section's screens and every other call stay
  closed. Nothing is granted silently.
- **What still needs the other section** (`stillNeeds`) shows as a warning in Users → Section access
  for any column that opens the host without it, with a one-click "Give …" fix, and in the person
  drawer's preview. A bundle column's warning notes that people whose role already gives it are fine.
- The host row in the matrix says "Uses … inside it, without opening them".

| Host | Uses | Allowed through the host | Still needs the other section |
|---|---|---|---|
| Automate | Connections | List own and shared connections (Automate View); try a document extraction (Automate Manage) | Adding a connection from a flow: Connections Manage. The picker hides "add" when the list says `canCreate: false`. |
| Automate | Knowledge | List knowledge bases they may see (Automate View); try a search (Automate Manage) | Nothing |

Found by a scan of each screen's API calls but **not handled yet** (each still 403s without the other
section): Ask Data → Agents (chat list, titles, hand-off; fine by default), Ask Data → Dashboards
(pin to dashboard, draft-change cards; members have no Dashboards by default), Ask Data → Metrics,
Teach and Performance (authoring panels, teach digest, Boost tab), Dashboards → Ask Data and Metrics
(chart picker, blueprint lookups). Add an entry to `SECTION_USES` with the exact calls to handle one.

## Permissions (Users → Permissions)

- Permissions are finer rights some routes check on top of section access: `inspector:use` (Ask
  Data, agents, Knowledge, Automate), the Automate publishing permissions `connector:write`,
  `connector:external` and `flow:sql`, session rights, data access logs and so on. The list, in
  plain words, is `src/lib/permission-catalog.ts`; a test keeps it in step with the keys the code
  defines.
- Rows are permissions (grouped), columns are Admin, Member, Read only, each custom role and each
  bundle. Platform admins tick and Save; everyone who can view Users sees it read-only. Platform
  admin always has everything and is not a column to edit.
- Permissions no route checks today are marked "not checked yet" (their screens use section access
  instead), so a tick never pretends to do something. `session:read:all` (other people's history)
  stays with platform admins and cannot be ticked. `llm:payload:read` is marked sensitive.
- People with a custom role also hold its base role, so they get both columns' permissions; a bundle
  adds its permissions to whoever has it.
- Only catalog keys move: section keys, `section-default:*` keys and platform-admin-only keys on a
  role are never touched. API: `GET /api/sections/permissions`,
  `PUT /api/sections/permissions/[roleId]` with `{ keys }`. Audited as `role.permissions.updated`.
- Code: `src/lib/sections/role-admin.ts` (storage for both features),
  `src/components/users/RolePermissionsPanel.tsx`.

## Enforced today (2026-11-06)

- **Data Estate**: pages (EstateLayout), sidebar, and every API route under
  `src/app/api/agent-lab/context`.
- **Govern** (all but Docs): pages (`SectionGate` around the Govern routes in `web/src/router.tsx`),
  sidebar, and APIs: `users`, `model-config`, `access` (through `requireAccessAdmin`), `admin/cost`,
  `policies`, `connections`, `audit-log`, `sections`.
- `src/lib/sections/__tests__/route-coverage.test.ts` fails when a route under those folders has no
  access check, unless it is listed as exempt with a reason.

Build and Memory sections are gated in the UI (`SectionGate` on `AgentLayout`) and on most APIs via
`src/lib/sections/api-guard.ts` (plus route-specific checks where paths overlap, e.g. Estate APIs).

## Custom roles (Users → Section access → New role)

- A custom role sets **every section exactly**, so it can take access away (for example, Member
  without Dashboards). It starts from a built-in role (Read only, Member, or Admin): the new role
  copies that role's levels, and that base role decides everything outside sections (Inspector use,
  saving sessions, rank in the no-escalation checks).
- Stored as a role carrying `section:role-base:<base>` plus its section keys; no schema change. When a
  person's permissions include a base key, role defaults are skipped and keys decide
  (`resolveSectionLevels`).
- A person has at most one custom role, and also holds its base built-in role. Giving someone a
  custom role replaces their built-in role with the base and drops any other custom role; taking it
  away leaves them on the base. A normal role change (Change role) drops the custom role.
- Bundles still add on top of a custom role.
- Never given to platform admins. Never gives Manage on Data Estate or view-only sections.
- Changing a custom role's starting role moves everyone who has it to the new base.

## Per person (Users → open someone → Section access)

Platform admins pick a person's custom role and tick their bundles in the profile drawer, with a
preview of what they would get. Saved through `PUT /api/users/[id]/section-access`.

## Bundles (Users → Section access)

- A bundle is a role that is not one of the four built-in roles. It carries `section:<id>:view|manage`
  permission keys and nothing else matters about it here.
- Only platform admins create, rename, delete, or assign bundles (`/api/sections/bundles*`).
  Admins can see the matrix.
- A bundle never gives Manage on a Data Estate or view-only section; the API lowers it to View and
  the matrix disables the option.
- Changing someone's role keeps their bundles. Invites take built-in roles only.
- Changes apply on the person's next request (the server re-reads roles); the sidebar updates on the
  next page load.

## Decisions (user, 2026-11-06)

1. Admins can view the Data Estate but take no actions. Only platform admins run estate jobs or
   change anything there.
2. Extra access is given through bundles (roles carrying section keys). Later the same day: also set
   per person from their profile, and through custom roles with fully customised access.
3. Estate View shows everything (all metadata). Previews and profiles that show real values still
   follow data access.
4. One section per sidebar item, with a "whole group" shortcut in the matrix.
5. "Go ahead" with the bundle editor and Govern enforcement.
6. Admins are view-only in Govern too (Models, Users, Data access, Cost monitor, Policies). Only
   platform admins, or people given a Manage bundle, change these. Connections are unchanged.
7. Custom roles with every section customised, and per-person extra access (2026-11-06).
8. Admins use Automate and Knowledge by default; built-in role defaults and role permissions are
   editable in the UI by platform admins (2026-11-12).

## Not built yet

- Enforcement for Build and Memory sections.
- Govern pages hide their edit controls at View: Users, Models, Data access (all tabs), Policies,
  Cost monitor (budgets). Audit log has nothing to change.
- `/api/inspector/semantic/[modelId]/promote` follows Inspector's own rule (authors self-approve,
  otherwise admin), not the estate section; only the estate button is hidden.
