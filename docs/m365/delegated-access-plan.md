# Microsoft 365 delegated access: Inspector, agents and Automate

**Status:** plan, no code yet · **Written:** 2026-11-04 · **Owner sign-off needed on:** §9 decisions

## 1. Goal

A signed-in person can let ALOFT use **their own** Microsoft 365 access. Then Inspector, saved agents and Automate can:
- pick, find and read SharePoint and OneDrive files, and read Excel sheets;
- **save files back to SharePoint and OneDrive**, and add or update SharePoint List rows, after the person confirms;
- check documents against warehouse data;
- later, post to Teams, send email or create tasks, also after the person confirms.

ALOFT acts **as that person**. It sees only what they can already open in Microsoft 365, and Microsoft's permissions, Conditional Access and revocation all keep working.

**Not in scope:** a copy of Microsoft 365 Copilot. What ALOFT adds is **documents joined with governed warehouse data**, plus saved agents, automations and an audit trail.

## 2. What exists today (code facts)

| Piece | Where | Matters because |
|---|---|---|
| Microsoft sign-in, scope `openid profile email User.Read` | `src/lib/auth.ts:118-133` | Sign-in works but cannot read files. Sessions are **next-auth v4 JWT cookies** (8 h). |
| Password sign-in | `src/lib/auth-credentials.ts` | These users have no Microsoft token at all. |
| User ↔ Entra link `user.aadObjectId` | `src/lib/rbac.ts` `provisionUserByOid` | Used to make sure a Microsoft token really belongs to the ALOFT user. |
| App-only SharePoint (Graph, client credentials, read-only) | `src/lib/connections/providers/sharepoint.ts` | The Graph calls, the safe download-link check and error redaction can be reused. |
| Secrets in AWS Secrets Manager | `src/lib/connections/secrets.ts` | Same pattern for refresh tokens. |
| File readers: PDF, Word, Excel, CSV, PowerPoint, images (OCR) | `src/lib/knowledge/readers.ts` | `read_file` reuses them, so no new parsing code. |
| Field extraction from a file (Grok) | `src/lib/extraction/service.ts` | Reused for the document-vs-data check. Today it takes a connection, so it needs a variant that takes bytes. |
| Inspector tools: specs `INSPECTOR_TOOLS`, `buildToolConfig`, dispatch `executeInspectorTool` | `src/lib/inspector/prompts.ts:133,355`, `src/lib/inspector/tools.ts:111` | `InspectorToolContext` has **no `userId`** yet, so it has to be added. |
| Agent runner with an add-on tool (`search_knowledge`) and `person` | `src/lib/agents/run-catalog-agent.ts:230-290`, `src/lib/knowledge/agents.ts` | **The pattern to copy:** a module exports a tool spec plus a runner that takes the person. |
| Automate capabilities, policy, simulation; Try it runs as the person | `src/lib/capabilities/*`, `src/lib/flows/policy.ts`, `agent-try/route.ts:43` | New capabilities plug in. Scheduled runs need the M3 worker, which isn't built. |
| Audit | `src/lib/audit.ts` `writeAudit` | Every read and action is recorded, never content. |

## 3. Architecture

```
 Profile / inline card            Entra ID (login.microsoftonline.com)
 "Connect Microsoft 365" ──► /api/m365/connect ──► consent ──► /api/m365/callback
                                                                   │ code → tokens (PKCE)
                                                                   │ check oid == user.aadObjectId
                                                                   ▼
                                   user_m365_grants (DB: scopes, status)  +  Secrets Manager
                                   aloft/m365/<userId> (refresh token only)
                                                                   │
              getGraphToken(userId, scopes) ── memory cache (access token, ~1 h) ──┘
                         │
                 src/lib/m365/graph.ts  (graph.microsoft.com only; 429 Retry-After; timeouts; redaction)
                         │
          src/lib/m365/tools.ts  ── one definition of each tool + runner(person, surface) ──
             │                          │                               │
   Inspector chat              Saved agents (agent chat,         Automate capabilities
   (executeInspectorTool)      Ask-an-agent step)                (Try it now; scheduled after M3)
```

### 3.1 Key decision: a separate "Connect" step, not more scopes at sign-in

Leave sign-in at `User.Read`. Add a separate **Connect Microsoft 365** step (OAuth authorization code + PKCE, confidential client), started from Profile or from an inline card in chat. Reasons:

1. Sessions are JWT cookies. Putting refresh tokens in them makes them large, exposed, and impossible to revoke from the server.
2. Password-login users have no Microsoft token anyway.
3. If consent is missing or refused, **sign-in still works**. Only the Microsoft 365 features are off.
4. Write permissions can be requested later, when someone first uses a write feature, without signing everyone out.

Use the **same Entra app** as sign-in, with a new redirect URI `https://<host>/api/m365/callback` for each environment. The admin grants tenant-wide consent for the delegated scopes, so people only click Connect once and see no Microsoft prompt.

### 3.2 Scopes by phase

The admin consents to the full set once for the whole tenant. ALOFT still **asks only for the scopes a person actually uses** (incremental consent). Level 3 scopes are each turned on by the person in Profile → Connected accounts. The full list is in §11.

| Level | Delegated scopes | Phase |
|---|---|---|
| 1. Files: read and write | `offline_access`, `User.Read`, `Files.Read.All`, `Sites.Read.All`, `User.ReadBasic.All`, `People.Read`; write: `Files.ReadWrite.All`, `Sites.ReadWrite.All` | Read 1–2; write 3 |
| 2. Act after Confirm | `ChannelMessage.Send`, `Chat.Create`, `ChatMessage.Send`, `Mail.Send`, `Tasks.ReadWrite`, `Calendars.ReadWrite`, `Team.ReadBasic.All`, `Channel.ReadBasic.All` | 4 |

**File writes (changed 2026-11-04):** writing files is now part of level 1, at the user's request. The admin consents to both the read and the read-write scopes. Connect asks only for the read scopes. ALOFT asks for `Files.ReadWrite.All` or `Sites.ReadWrite.All` the first time a person saves something, so people who only read never grant write access.
| 3. Sensitive reads (the person opts in) | `Mail.Read`, `Mail.Read.Shared`, `Calendars.Read`, `Calendars.Read.Shared`, `ChannelMessage.Read.All`, `OnlineMeetings.Read`, `OnlineMeetingTranscript.Read.All`, `User.Read.All` | Later, pilot first |

**Email:** creating a draft needs `Mail.ReadWrite`, which also allows reading and deleting all mail. `Mail.Send` is narrower: it can send but can't read. So ALOFT does **not** request `Mail.ReadWrite` for drafts (see D3 and §4.2).

### 3.3 Tokens

- **Refresh token:** Secrets Manager `aloft/m365/<userId>`, the same pattern as connections. Entra issues a new refresh token on every redeem, so it's written back each time. The **access token is kept in memory only** (per process, until about 5 minutes before expiry) and never stored.
- **Table `user_m365_grants`** (create-only migration): `user_id` (unique), `tenant_id`, `aad_oid`, `scopes[]`, `status` (`active` | `needs_reconnect` | `revoked`), `secret_ref`, `connected_at`, `last_used_at`, `last_error`.
- **`invalid_grant`** (password reset, admin revoke, refresh token expired after 90 days unused, Conditional Access): set status to `needs_reconnect`. Tools then return `not_connected` and the UI shows **Reconnect**.
- **Identity binding:** the callback refuses a token whose `oid` and `tid` don't equal the ALOFT user's `aadObjectId` and the configured tenant. A password-only user is asked to sign in with Microsoft once first. This blocks linking someone else's Microsoft account.
- **OAuth `state`:** random, single use, tied to the user and stored server-side for 10 minutes. The PKCE verifier is stored with it.

## 4. The tools (defined once, used by all three surfaces)

`src/lib/m365/tools.ts` exports each tool's spec and a runner `(input, { userId, orgId, surface, sessionOrRunId, scope? })`. It follows `src/lib/knowledge/agents.ts`.

### 4.1 Read tools (no confirmation needed)

| Tool | Graph call | Returns |
|---|---|---|
| `m365_search_files` (query, file type, site, modified after) | `POST /search/query` (driveItem) | Up to 10 results: name, site or drive, path, modified, modified by, link, snippet, and a `fileRef` |
| `m365_list_folder` (fileRef, or a pasted SharePoint/OneDrive link) | `/drives/{d}/items/{i}/children`; links through `/shares/u!{base64url}/driveItem` | One level of the folder |
| `m365_read_file` (fileRef, pages, max characters) | Item metadata, then a download link on `*.sharepoint.com` (no token sent, same check as `sharepoint.ts`) → `knowledge/readers.ts` | Text blocks with page numbers, the link for citation, and warnings. Capped by size (`EXTRACTION_MAX_MB`) and characters (default 30k). |
| `m365_read_sheet` (fileRef, sheet, range, max rows) | Download → `readXlsx` | A table, up to 500 rows. In Inspector it's also registered as a query result, so the existing chart and export work on it. |
| `m365_extract_fields` (fileRef, schema or fields) | Download → the extraction service (new bytes-in variant) | Typed fields, as in Automate's extraction step |
| `m365_find_people` (optional) | `/me/people`, `/users?$search` | Name, title, department, email |

A `fileRef` is `{driveId, itemId}`. It's re-checked through Graph on every use, as the person, so the model can't make up or reuse someone else's reference.

### 4.2 Action tools (phase 4, always confirmed by the person)

**No permission needed (available from phase 2):** an **Open in Outlook** button on an answer. It opens Outlook's compose screen with recipient, subject and body filled in (`https://outlook.office.com/mail/deeplink/compose?to=…&subject=…&body=…`, body length capped), and the person presses Send in Outlook.

**With level 2 scopes:**
- `m365_send_email` (`Mail.Send`)
- `m365_post_teams` (`ChannelMessage.Send`)
- `m365_message_person` (`Chat.Create`, `ChatMessage.Send`)
- `m365_create_task` (`Tasks.ReadWrite`)
- `m365_create_event` (`Calendars.ReadWrite`)

File writes are in §4.3. They use the same pending-action and Confirm mechanism described below.

The model **never** runs these directly:

1. The tool saves a **pending action** (`m365_pending_actions`: user, payload, payload hash, expires after 15 minutes) and shows a confirmation card in the chat, the same way `emit_disambiguation` stops the turn.
2. The person reviews the exact recipients, channel or folder and the text, then clicks **Confirm**.
3. `POST /api/m365/actions/:id/confirm` runs exactly the saved payload with the person's token. Anything changed or expired is refused.
4. The email recipient allowlist (`FLOWS_EGRESS_EMAIL_DOMAINS`) also applies here.

### 4.3 Writing files to SharePoint and OneDrive (phase 3)

Every write runs **as the person**, so SharePoint only lets ALOFT write where that person can already write. Each write goes through the Confirm card in §4.2.

| Tool | What it does | Graph call | Scope |
|---|---|---|---|
| `m365_save_file` | Save a **new** file (export, report, generated document) to a chosen folder. If the name is taken, ALOFT adds a number rather than overwriting. | `PUT /drives/{d}/items/{folder}:/{name}:/content?@microsoft.graph.conflictBehavior=rename` (files over 4 MB: upload session) | `Files.ReadWrite.All` |
| `m365_update_file` | Save a **new version** of an existing file, for example an updated Excel tracker. SharePoint version history keeps the old version. | `PUT /drives/{d}/items/{i}/content` with `If-Match: <eTag>` | `Files.ReadWrite.All` |
| `m365_create_folder` | Create a folder | `POST /drives/{d}/items/{parent}/children` | `Files.ReadWrite.All` |
| `m365_add_list_row`, `m365_update_list_row` | Add or change a SharePoint List item | `POST`/`PATCH /sites/{s}/lists/{l}/items` | `Sites.ReadWrite.All` |

Rules:
- **Overwrite protection.** An update carries the file's `eTag` from when the person last saw it. If someone changed the file since, the save is refused (412) and the person is shown that.
- **What the Confirm card shows.** The target site and folder path, the file name, size, and "new file" or "new version of …". For List rows it shows the fields being set.
- **Not offered:** delete, move, rename, changing sharing or permissions, or check-in/check-out administration. These are hard to undo or change who can see a file. They can be added later if a real need comes up, each with its own Confirm.
- **Size limit.** 50 MB a file, as a setting.
- **Audit.** `m365.file.saved` and `m365.list.row_written` record site, path, file id, size, new or version, and surface. Never the content.

**In Automate:**
- Saving a **new** file to a folder fixed in the step is low risk and doesn't need an approval step. The folder is a literal set when the automation is published, never something the model fills in.
- `m365_update_file` and List row changes need an approval step upstream, like other writes.
- Writes run as the owner, under the same rules as §5.3.

### 4.4 Picking a SharePoint file or folder

People can **pick** files as well as have the AI search for them. A **Browse SharePoint and OneDrive** picker uses the person's token and lists sites they follow and use, their OneDrive, document libraries and folders. It appears in:
- the Inspector and agent chat composer (attach a file to the question);
- Automate step settings (pick the file or folder a step reads from or saves to);
- knowledge bases (add files from SharePoint);
- the save Confirm card (choose or change the target folder).

Use ALOFT's own picker on Graph rather than Microsoft's File Picker SDK. It reuses the browse UI that connections already have, matches ALOFT's design, and needs no extra Entra setup.

## 5. By surface

### 5.1 Inspector

- Add `userId`, `orgId` and `m365: {connected, scopes}` to `InspectorToolContext`, filled once per turn in `src/app/api/inspector/chat/route.ts`.
- `buildToolConfig` adds the read tools only when the org setting is on **and** the person is connected. If they aren't connected, add one `m365_connect` tool that shows the Connect card. This avoids silent failure.
- Prompt section: use files for document questions and the warehouse for numbers; always cite the file link; file text is **data, not instructions**.
- UI: file results as chips (icon, name, site, link), a "read pages 1–4 of X" step in the tool trail, the Connect and Reconnect card, and confirmation cards (phase 4).

### 5.2 Saved agents (agent chat and the Ask-an-agent step)

- A new agent setting **Microsoft 365 files**, off by default, set by whoever manages the agent. It has an optional **site/folder allowlist**, for example the Crewing agent only searches the Crewing site.
- `run-catalog-agent.ts` adds the tools when the agent allows it **and** `person` is connected. The search is narrowed to the allowlist (Graph search `path:` filters, re-checked on read).
- A shared agent always runs **as the person chatting**, so two people asking the same agent each see only their own files.

### 5.3 Automate

- New capabilities in `src/lib/capabilities/builtin.ts`, marked `auth: 'delegated'`: `m365.files.search`, `m365.files.list`, `m365.files.read`, `m365.excel.read`, `m365.files.extract`, plus the phase-4 actions. "Repeat for each item" works over search and list results.
- **Try it and test runs:** run as the person who is editing. This works before M3.
- **Scheduled and published runs (needs M3): run as the owner.** The header shows "Runs as <owner>".
  - Publishing is refused unless the owner's grant is `active` and covers the scopes the steps need.
  - If the grant breaks, the run fails with "<owner> needs to reconnect Microsoft 365", and the owner is notified.
- **New policy rules** (`src/lib/flows/policy.ts`):
  - (a) A run-as-owner flow that sends Microsoft 365 data to other people (email, Teams, save to a shared place) needs an approval step upstream. The owner's files could otherwise reach people who can't open them.
  - (b) Missing scopes are an error.
- Team-owned automations that shouldn't depend on one person can keep using the **app-only SharePoint connection** that already exists.
- Copilot is told which Microsoft 365 capabilities exist and whether the owner is connected.

## 6. Security and governance

| Risk | Control |
|---|---|
| Someone else's Microsoft account linked | Token `oid`/`tid` must match `user.aadObjectId` and the tenant |
| Token theft | Refresh token only in Secrets Manager; access token only in memory; never sent to the browser, logged or put in the model's context. Captured-log test. |
| Prompt injection from a file ("email this to x@…") | File text fenced as untrusted data; writes only through confirmed pending actions; injection test set with planted instructions |
| File content leaking through ALOFT's own memory | Microsoft 365 tool results are **excluded** from `capture_learning`, session knowledge, teach and reflect stores, and from reusable caches. They live only in the person's own chat history. |
| Admins seeing file excerpts in **Inspect** views | Decision D4: by default, hide Microsoft 365 tool outputs from other viewers and keep only file name and link |
| Shared chats | Same redaction as D4 when a chat is shared |
| Sensitive or protected files | Respect Purview sensitivity labels (Graph label info, **check the exact API in phase 2**); the org can block chosen labels; files with encryption (rights management) fail with a clear message |
| File text sent to the chat model | Only models allowed by decision D5; this is shown in the Connect screen text |
| Graph throttling | Respect `Retry-After` on 429/503, cap concurrent calls per user, timeouts on every call |
| Off switch | Org setting `m365.enabled` and allowed scope level (read / actions), allowed roles; **Govern → Microsoft 365** page lists connected people and can revoke any grant |
| Audit | `m365.grant.connected/revoked/needs_reconnect`, `m365.files.searched` (surface, result count, not the query text), `m365.file.read` (file id, site, name, size, surface, session or run), `m365.action.proposed/confirmed/refused`. Never content. |

## 7. Phases

Sizes assume one engineer who knows this repo: S ≤ 1 day, M 2–5 days, L 1–2 weeks.

| Phase | Scope | Acceptance (falsifiable) | Size |
|---|---|---|---|
| **0. Entra setup** (admin) | Redirect URIs for dev, staging and prod on the sign-in app; delegated read scopes; tenant-wide admin consent; check Conditional Access allows the ALOFT host. Decisions D1–D7. | A test user connects on dev and sees no Microsoft consent prompt | S (admin) |
| **1. Connect and tokens** | Migration `user_m365_grants`, `/api/m365/connect`, `/callback`, `/status`, `/disconnect`; token service with memory cache and refresh-token rotation; Profile → Connected accounts; audit | Mismatched `oid` refused; replayed `state` refused; rotated refresh token stored; `invalid_grant` → `needs_reconnect`; disconnect deletes the secret; no token in logs or responses (captured-log test) | M |
| **2. Read tools and picker in Inspector and agents** | `src/lib/m365/{graph,files,tools}.ts`; search, list, read, read sheet; the SharePoint/OneDrive picker (§4.4); Inspector wiring and UI; agent setting and allowlist; prompt; injection fencing; memory exclusion; Inspect redaction (D4) | With two test accounts, A cannot find or read a file shared only with B; agent allowlist enforced on read as well as search; size and character caps hold; 429 retried; planted-instruction file causes no action; `capture_learning` never stores file text | L |
| **3. Documents against data, and file writes** | `m365_extract_fields` (extraction service, bytes-in variant); Excel sheet as a query result (charts, export); two demo prompts written as tests. `m365_pending_actions` and the Confirm card; the §4.3 write tools; write scope requested on first save | Invoice-vs-PO and certificate-expiry demos answer correctly, with file and warehouse citations. Nothing is saved without a click; a changed file (eTag) refuses the update; a name clash creates "name (1)" rather than overwriting; a person without write access to a folder gets SharePoint's refusal, shown plainly | L |
| **4. Other actions with confirmation** | The level 2 actions in §4.2 (send email, Teams post and chat, task, calendar event), reusing phase 3's Confirm mechanism; their scopes requested when first used | Nothing is written without a click; changed or expired payload refused; recipient outside the allowlist refused; the model cannot call confirm | M |
| **5. Automate** | Capabilities, step panel, Copilot awareness, policy rules (§5.3), simulation fixtures; Try it as the editor. **Scheduled run-as-owner is delivered with M3.** | Policy blocks publishing when the owner isn't connected or lacks scopes, and when Microsoft 365 data reaches others without approval; Try it reads a real file as the editor | M (+ M3) |
| **Later** | SharePoint folders → knowledge bases (knowledge base Phase 3, app-only); agents in Teams (bot); shared mailbox triage | — | L each |

**Total:** phases 1–4 plus Automate Try it is about **5–6 weeks** for one engineer. File writes added about a week. Phase 2 can start the day phase 1 is merged. Phase 3 needs phase 2. Phase 4 reuses phase 3's Confirm mechanism. Phase 5 can run alongside phase 4.

## 8. Files to add or change

- New: `src/lib/m365/{oauth,tokens,grants,graph,files,tools,actions}.ts`, `src/app/api/m365/{connect,callback,status,disconnect}/route.ts`, `src/app/api/m365/actions/[id]/confirm/route.ts`, `prisma/migrations/<date>_m365_grants/` (grants and pending actions), Profile "Connected accounts" panel, Govern → Microsoft 365 page, chat cards (file chip, connect, confirm).
- Change:
  - `src/lib/inspector/{tools,prompts}.ts`
  - `src/app/api/inspector/chat/route.ts`
  - `src/lib/agents/run-catalog-agent.ts` and the agent settings UI
  - `src/lib/extraction/service.ts` (bytes-in variant)
  - `src/lib/capabilities/builtin.ts`
  - `src/lib/flows/policy.ts`
  - `src/lib/flows-copilot/propose.ts`
  - the memory and learning writers (exclusion)
  - Inspect views (redaction)
  - `src/lib/connections/providers/sharepoint.ts` (share the Graph helpers)
- Settings: `M365_ENABLED`, `M365_REDIRECT_URI` (or derived from `NEXTAUTH_URL`), and the existing `AZURE_AD_*` variables.

## 9. Decisions needed

| ID | Decision | Recommendation |
|---|---|---|
| D1 | Same Entra app as sign-in, or a separate one | Same app, new redirect URI |
| D2 | Where refresh tokens live | Secrets Manager per user for the pilot; move to KMS-encrypted columns if users reach thousands |
| D3 | How ALOFT helps with email | **Open in Outlook** button first (no permission). Then `Mail.Send` behind the Confirm card in phase 4. Don't request `Mail.ReadWrite` for drafts, because it also allows reading and deleting all mail (changed 2026-11-04). |
| D4 | Can admins see file excerpts in Inspect and shared chats | No: show file name and link only |
| D5 | Which models may receive file text | The current default (Grok 4.7 through LLM Lite) after the data-handling review; no others without approval |
| D6 | Pilot group | One team (for example Crewing or QHSE) through an ALOFT role, then everyone |
| D7 | Can scheduled automations run as their owner | Yes, with the §5.3 rules; team automations use app-only connections |

## 10. Demo for the end of phase 3

1. Inspector: *"Find the latest drydock circular and tell me what it changes for hull inspections."* It answers with the file link and pages.
2. Agent: the Crewing agent (allowlist: Crewing site) answers *"Which seafarers' certificates in the 2026 folder expire before their contract end date?"* It reads the PDFs and checks them against crew contract data in the warehouse.
3. Inspector: *"Compare actual opex for Q3 to Finance/Budget 2026.xlsx and chart the gap by vessel."*

## 11. Connector catalog

Delegated scopes act as the person. "Admin consent" marks scopes that Microsoft itself says need admin consent; the Entra portal shows this per permission, so confirm it there. The admin consents to everything tenant-wide anyway.

### Documents and data

| Connector | What ALOFT can do | Scopes | Level | Example |
|---|---|---|---|---|
| SharePoint and OneDrive files | Search, browse, read PDF, Word, PowerPoint, images; extract fields | `Files.Read.All`, `Sites.Read.All` | 1 | Latest drydock circular; certificate PDFs vs contracts; invoices vs POs |
| Excel | Read a sheet as a table; chart it; use it with warehouse data | `Files.Read.All` | 1 | Q3 opex vs Budget 2026.xlsx; crew planner vs actual sign-on dates |
| SharePoint Lists | Read rows as a table | `Sites.Read.All` | 1 | Open inspection findings older than 30 days |
| SharePoint Lists (write) | Add or update rows after Confirm | `Sites.ReadWrite.All` | 1 (write) | An automation adds a row per expiring certificate |
| Save files | Save a new file or a new version after Confirm; create folders (§4.3) | `Files.ReadWrite.All` | 1 (write) | Weekly report dropped in Finance/Reports; updated crew tracker saved as a new version |
| OneNote (low priority) | Read notebooks | `Notes.Read.All` | — | Superintendent visit notes |

### Communication

| Connector | What ALOFT can do | Scopes | Level | Example |
|---|---|---|---|---|
| Teams: post to a channel | Post after Confirm | `ChannelMessage.Send` | 2 | "3 certificates expire this month" to Crewing › Alerts |
| Teams: message a person | 1:1 chat after Confirm | `Chat.Create`, `ChatMessage.Send` | 2 | Ping the superintendent with defects |
| Teams: teams and channels list | Pick a channel | `Team.ReadBasic.All`, `Channel.ReadBasic.All` | 2 | Channel picker on the confirmation card and in the Automate step |
| Teams: read channel posts | Search team discussions | `ChannelMessage.Read.All` (admin consent) | 3 | What Ops decided about a bunker delay |
| Teams: meeting transcripts | Minutes, decisions, action items | `OnlineMeetings.Read`, `OnlineMeetingTranscript.Read.All` (likely admin consent) | 3 | Weekly fleet meeting → action items → Planner tasks |
| Outlook: compose link | Open Outlook with an email filled in | none | — | "Email this" from any answer |
| Outlook: send | Send after Confirm | `Mail.Send` | 2 | Summary to the requester or supplier |
| Outlook: read mail | Search mail; read attachments | `Mail.Read`, `Mail.Read.Shared` | 3 | Supplier quote vs PO; crewing@ mailbox triage |

### People, calendar and tasks

| Connector | What ALOFT can do | Scopes | Level | Example |
|---|---|---|---|---|
| Directory lookup | Name, title, department, email; frequent contacts | `User.ReadBasic.All`, `People.Read` | 1 | "Who is the superintendent for MV Aurora?"; pick recipients by name |
| Manager chain | Find someone's manager | `User.Read.All` (admin consent) | 3, or 2 if the admin agrees | Automate approvals go to the requester's manager |
| Calendar: read and free time | Free/busy; find a slot | `Calendars.Read`, `Calendars.Read.Shared` | 3 | Find 30 minutes with the master and the technical super; daily brief |
| Calendar: create events | Create events after Confirm | `Calendars.ReadWrite` | 2 | Reminder 30 days before each certificate expiry |
| Planner and To Do | Create and update tasks | `Tasks.ReadWrite` | 2 | A task per overdue PO, assigned to its buyer |

### Not possible or not Graph

- **Microsoft Forms:** no supported API. Read the Excel file the responses are saved to.
- **Power BI:** its own API and permissions; a separate project.
- **Exchange and Teams admin data:** not for end users.

### App-only options for team automations

| Need | Option |
|---|---|
| Read team SharePoint | `Sites.Selected` (application), with the admin granting chosen sites. Already built (`src/lib/connections/providers/sharepoint.ts`). |
| Send from a shared mailbox | `Mail.Send` (application), limited by the Exchange admin to that mailbox |
| Post to a Teams channel | A Teams Workflows webhook per channel; no Graph permission |
