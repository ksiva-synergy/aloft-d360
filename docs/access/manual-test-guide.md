# Data access: manual test guide

For: whoever tests the simplified access model on dev before enforcement. About 45 minutes. You need two accounts: a **platform admin** (A) and a **member** (B). A third member (C) helps for the approval steps.

Automated coverage already in place (so you can focus on how it feels): unit and route tests (`npx vitest run`), and an end-to-end run against dev (`node --env-file=.env node_modules/vitest/vitest.mjs run --config vitest.e2e.config.ts`, 11 steps, cleans up after itself).

## 0. Settings for the test

In `.env.local` on your machine (then restart the app):

| Setting | For this test | What it does |
|---|---|---|
| `ACCESS_MODE` | `enforce` | Table check: people can only open what an access rule allows |
| `COLUMN_ACCESS_MODE` | `enforce` | Column check: protected columns show •••, filters on them are refused |

Use `shadow` / `observe` instead to watch what *would* happen without blocking anyone (see step 7).

> Before setting `ACCESS_MODE=enforce`, do step 1: today nobody can open any catalog.

## 1. Data tab: who can use what (A)

1. Govern → Data access → **Data**. You should see "Nobody can use any catalog yet".
2. Pick `curated_db` → **Give access** → *Everyone / Members / Admins* → Members → Use → reason → Give access.
3. The row now says "Members"; open a schema inside: "From above: Members · Use".
4. Change the access to **Use + export** with a reason; then back to Use.
5. Tick **Approve requests for this data automatically** on the Members rule (you will test it in step 5).

✅ Expect: every change asks for a reason; nothing lets you give access to yourself.

## 2. Protections: protect salary (A)

1. **Protections** tab → **+ New protection** → name "Compensation test" → *Specific people* → pick **C** → reason → Create.
2. Search `salary`, tick a column in `curated_db`, reason → **Add 1 column to Compensation test**.
3. Data tab → open that table → Columns shows the 🔒 chip.

## 3. As B: masking in chat

1. Sign in as **B**. In Inspector ask for rows from that table including salary (e.g. "show 10 contracts with salary").
2. ✅ The table shows ••• for salary, a yellow note "… is hidden: you don't have access to Compensation test data" with **Request access**, and the AI says the same without guessing values.
3. Ask "who earns more than 100000?" ✅ Refused; the AI says you don't have access and gives the link; it does not try another query.
4. Ask the AI to "describe the table" ✅ no min / max / top values for salary.
5. Try an export of a result with salary ✅ refused.

## 4. As B: request access

1. Click **Request access** (or user menu → **My data access**). The form is prefilled with Compensation test.
2. Exact values, 30 days, a real reason (20+ characters) → Send. ✅ "Sent as ACC-…".
3. Sending the same again ✅ refused ("already asked").

## 5. Approving (C, who can see Compensation test, is not the approver; A is)

1. As **A** (platform admins are the fallback approvers here): Data access → **Requests & log** → To approve → open the request: history shows *asked · sent to approvers*.
2. Change the time to 7 days → **Approve**. ✅ B gets a notice (user menu shows a count); My data access shows "Exact values" until the date.
3. As **B** repeat step 3.1 ✅ salary values visible now.
4. As **B** request a table under `curated_db` (My data access → A table or schema). ✅ Approved immediately (auto-approve from step 1.5).
5. As **B** request something under a protected path or `Compensation test` again after access ends ✅ goes to approvers, not auto.

## 6. People & groups (A)

1. **People & groups** → **New group** "Payroll test", approver **C**, people **B** → Create.
2. Look up **B** ✅ shows groups, what B can use (and through what), protected data and levels.
3. As **C** (approver) open Data access (if C has no access, this step needs C to have View on Data access) → add a person to Payroll test ✅ works; adding yourself ✅ refused.

## 7. Shadow mode and health (A)

1. Set `COLUMN_ACCESS_MODE=shadow`, restart, repeat step 3 as B. ✅ B sees real values (nothing changes for people).
2. Requests & log → **Column check health** ✅ shows queries checked, would mask / refuse counts, check time p95 (expect a few ms or less) and the gates.

## 8. Housekeeping (A)

1. Requests & log → To approve → **Run checks now** ✅ "Escalated 0, expired 0, …" (nothing old on dev).

## Report

For anything odd, note the step, the account, what you expected and what you saw (a screenshot helps). Known gaps:
- Requests from chat for **table** refusals open My data access through a link in the message; a button inside chat answers comes later.
- Per-query `EXPLAIN` is not used; queries the parser cannot read (CTEs, sub-queries, UNION) are refused only when they touch protected data.
- Notifications are in-app only (no email or Teams).
