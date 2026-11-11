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
   **bundle** (for example "Agent builder").
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
| Other Build and Memory sections | None | None | View | Manage |

Admins see Govern but only platform admins change it (user decision, 2026-11-06), the same rule as
the Data Estate. Unlike the estate, a bundle can give Manage on a Govern section. Connections stay
Manage for members and admins because they are each person's own. Changing a built-in role's
default is a code change in `registry.ts`.

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

## Not built yet

- Enforcement for Build and Memory sections.
- Editable defaults per built-in role (today they are code). A custom role covers most needs: copy the
  built-in role and change it.
- Govern pages hide their edit controls at View: Users, Models, Data access (all tabs), Policies,
  Cost monitor (budgets). Audit log has nothing to change.
- `/api/inspector/semantic/[modelId]/promote` follows Inspector's own rule (authors self-approve,
  otherwise admin), not the estate section; only the estate button is hidden.
