/**
 * simplified-model-dry-run.ts: READ-ONLY report for S2 of docs/access/simplified-access-model.md.
 *
 * For every active person × every estate object (and every path that has a grant or label), it asks
 * the current engine (decide / decideColumn) and the new engine (canOpen / decideColumnUse, built by
 * fromLegacy from today's rules) the same questions and reports any difference. It also lists what the
 * migration would create: groups from departments, protections from labels, protection grants from
 * clearances, and grants that change shape (discover dropped, export → Use + export, deny → Block).
 *
 * It never writes to the database. Output: a Markdown report (path given as the first argument, or
 * stdout) and a one-line summary.
 *
 * Usage (repo root):
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/access/simplified-model-dry-run.ts [report.md]
 */
import { writeFileSync } from 'node:fs';
import { prisma } from '@/lib/db';
import { loadPolicySnapshot, clearanceForUser, departmentsForUser } from '@/lib/access/policy-store';
import { decide } from '@/lib/access/decide';
import { decideColumn } from '@/lib/access/decide-column';
import { effectiveDataRoles, loadUserRoleNames } from '@/lib/access/roles';
import { canOpen, decideColumnUse, fromLegacy, LEGACY_LABEL_PROTECTION } from '@/lib/access/engine';
import { buildAccessModel, loadAccessModel } from '@/lib/access/model-store';
import { copyWouldOpenData, planCopy, rowsAfterCopy } from '@/lib/access/migrate-plan';
import type { AccessPrincipal } from '@/lib/access/types';

const OLD_TO_NEW: Record<string, string> = { explicit_deny: 'blocked', no_grant: 'no_access', needs_clearance: 'protected' };

/** Same org the app uses: DEFAULT_ORG_ID, else the org with DEFAULT_ORG_SLUG (the app's server helpers are server-only). */
async function resolveOrgId(): Promise<string> {
  const id = process.env.DEFAULT_ORG_ID?.trim();
  if (id) return id;
  const slug = process.env.DEFAULT_ORG_SLUG?.trim();
  const org = slug
    ? await prisma.platformOrg.findFirst({ where: { slug }, select: { id: true } })
    : await prisma.platformOrg.findFirst({ select: { id: true }, orderBy: { created_at: 'asc' } });
  if (!org) throw new Error('No org found (set DEFAULT_ORG_ID or DEFAULT_ORG_SLUG)');
  return org.id;
}

async function main() {
  const out = process.argv[2];
  const orgId = await resolveOrgId();
  const snapshot = await loadPolicySnapshot(orgId);
  const model = fromLegacy(snapshot);
  const now = Date.now();

  // The model as it would be read back from the new tables after the copy (simulated, no writes).
  const [cDepts, cMembers, cGrants, cLabels, cClear, eTags, eCols, eTagGrants, eGroups] = await Promise.all([
    prisma.accessDepartment.findMany({ where: { org_id: orgId } }),
    prisma.accessDepartmentMember.findMany({ where: { department: { org_id: orgId } } }),
    prisma.accessGrant.findMany({ where: { org_id: orgId } }),
    prisma.accessLabel.findMany({ where: { org_id: orgId } }),
    prisma.accessClearance.findMany({ where: { org_id: orgId } }),
    prisma.accessTag.findMany({ where: { org_id: orgId }, select: { id: true, name: true, archived_at: true } }),
    prisma.accessColumnTag.findMany({ where: { org_id: orgId }, select: { tag_id: true, table_path: true, column_name: true, status: true } }),
    prisma.accessTagGrant.findMany({ where: { org_id: orgId } }),
    prisma.accessGroup.findMany({ where: { org_id: orgId }, select: { id: true, archived_at: true } }),
  ]);
  const eMembers = eGroups.length
    ? await prisma.accessGroupMember.findMany({ where: { group_id: { in: eGroups.map((g) => g.id) } }, select: { group_id: true, user_id: true, expires_at: true } })
    : [];
  const current = { departments: cDepts, departmentMembers: cMembers, grants: cGrants, labels: cLabels, clearances: cClear };
  const plan = planCopy(current);
  const copyRefused = copyWouldOpenData(current, plan);
  const copied = buildAccessModel(
    rowsAfterCopy(plan, { rules: [], tags: eTags, pathProtections: [], columnTags: eCols, tagGrants: eTagGrants, groups: eGroups, members: eMembers }),
  );
  const archivedWithGrants = cDepts.filter((d) => d.archived_at && cGrants.some((g) => g.principal_type === 'department' && g.principal_id === d.id));
  let copiedChecks = 0;
  const copiedDiffs: string[] = [];
  // The model read from the real new tables (empty until the copy has been applied).
  const live = await loadAccessModel(orgId);
  const liveApplied = live.rules.length > 0 || live.targets.some((t) => t.column === null);
  let liveChecks = 0;
  const liveDiffs: string[] = [];

  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { id: true, email: true, name: true },
    orderBy: { email: 'asc' },
  });
  const objects = await prisma.platformContextObject.findMany({
    where: { org_id: orgId },
    select: { full_path: true },
  });
  const departments = await prisma.accessDepartment.findMany({
    where: { org_id: orgId },
    select: { id: true, key: true, name: true, archived_at: true, _count: { select: { members: true } } },
  });

  const paths = new Set<string>();
  for (const o of objects) paths.add(o.full_path.toLowerCase());
  for (const g of snapshot.grants) paths.add(g.path);
  for (const l of snapshot.labels) paths.add(l.path);
  const allPaths = [...paths].sort();
  const tables = allPaths.filter((p) => p.split('.').length === 3);

  type Diff = { who: string; path: string; question: string; before: string; after: string };
  const diffs: Diff[] = [];
  let tableChecks = 0;
  let columnChecks = 0;
  const perPerson: { who: string; roles: string[]; openBefore: number; openAfter: number; exportBefore: number; exportAfter: number }[] = [];

  for (const u of users) {
    const roles = await loadUserRoleNames(u.id);
    const principal: AccessPrincipal = {
      kind: 'user',
      orgId,
      userId: u.id,
      departmentIds: departmentsForUser(snapshot, u.id),
      clearance: clearanceForUser(snapshot, u.id),
      roles: effectiveDataRoles(roles),
    };
    const person = { userId: u.id, roles };
    const who = u.email;
    const counts = { openBefore: 0, openAfter: 0, exportBefore: 0, exportAfter: 0 };

    for (const path of allPaths) {
      for (const [oldLevel, need] of [
        ['query', 'use'],
        ['export', 'export'],
      ] as const) {
        const before = decide(principal, path, oldLevel, snapshot);
        const after = canOpen(model, person, path, need, now);
        tableChecks++;
        if (path.split('.').length === 3) {
          if (oldLevel === 'query') {
            if (before.allowed) counts.openBefore++;
            if (after.ok) counts.openAfter++;
          } else {
            if (before.allowed) counts.exportBefore++;
            if (after.ok) counts.exportAfter++;
          }
        }
        if (liveApplied) {
          const viaLive = canOpen(live, person, path, need, now);
          liveChecks++;
          if (viaLive.ok !== before.allowed) liveDiffs.push(`${who} ${path} ${oldLevel}: today ${before.allowed ? 'allowed' : 'refused'}, new tables ${viaLive.ok ? 'allowed' : 'refused'}`);
        }
        const viaTables = canOpen(copied, person, path, need, now);
        copiedChecks++;
        if (viaTables.ok !== before.allowed) copiedDiffs.push(`${who} ${path} ${oldLevel}: today ${before.allowed ? 'allowed' : 'refused'}, after copy ${viaTables.ok ? 'allowed' : 'refused'}`);
        const beforeText = before.allowed ? 'allowed' : OLD_TO_NEW[before.reason] ?? before.reason;
        const afterText = after.ok ? 'allowed' : after.reason;
        if (beforeText !== afterText) diffs.push({ who, path, question: oldLevel, before: beforeText, after: afterText });
      }
    }

    for (const [table, byColumn] of snapshot.columns?.columnTags ?? new Map()) {
      if (!canOpen(model, person, table, 'use', now).ok) continue;
      for (const column of byColumn.keys()) {
        for (const use of ['output', 'filter', 'aggregate'] as const) {
          const before = decideColumn(principal, snapshot, { table, column, use }, now).access;
          const after = decideColumnUse(model, person, table, column, use, now).outcome;
          columnChecks++;
          if (before !== after) diffs.push({ who, path: `${table}.${column}`, question: `column ${use}`, before, after });
        }
      }
    }

    perPerson.push({ who, roles, ...counts });
  }

  /* What the migration would create or change */
  const grantRows = snapshot.grants.map((g) => {
    const becomes =
      g.effect === 'deny'
        ? 'Block'
        : g.level === 'discover'
          ? 'dropped (names are visible to everyone)'
          : g.level === 'export'
            ? 'Use + Allow export'
            : 'Use';
    const holder =
      g.principalType === 'department'
        ? `group "${departments.find((d) => d.id === g.principalId)?.name ?? g.principalId}"`
        : g.principalType === 'role'
          ? `built-in "${{ readonly: 'Everyone', member: 'Members', admin: 'Admins' }[g.principalId] ?? g.principalId}"`
          : `person ${users.find((x) => x.id === g.principalId)?.email ?? g.principalId}`;
    return `| \`${g.path}\` | ${g.principalType} → ${holder} | ${g.effect} ${g.level} | ${becomes} |`;
  });

  const lines: string[] = [];
  lines.push('# Simplified access model: migration dry run', '');
  lines.push(`Run: ${new Date().toISOString()} · org \`${orgId}\` · read-only (no writes).`, '');
  lines.push('## Result', '');
  lines.push(`- People: ${users.length}. Paths checked: ${allPaths.length} (${tables.length} tables and views).`);
  lines.push(`- Table decisions compared: ${tableChecks.toLocaleString()} (use and export). Column decisions compared: ${columnChecks.toLocaleString()}.`);
  lines.push(`- **Differences: ${diffs.length}.** ${diffs.length === 0 ? 'Nobody gains or loses access.' : 'See the list below.'}`);
  lines.push(`- Bootstrap open (no grants yet): ${snapshot.legacyOpen ? 'yes' : 'no'}.`);
  lines.push(`- **After the copy (simulated: copy → new tables → loader → engine): ${copiedChecks.toLocaleString()} decisions, ${copiedDiffs.length} differences.**${copyRefused ? ' The copy would be REFUSED: all grants are Discover-only.' : ''}`);
  lines.push(
    liveApplied
      ? `- **Real new tables (after the copy was applied): ${liveChecks.toLocaleString()} decisions, ${liveDiffs.length} differences.**`
      : '- Real new tables: copy not applied yet.',
  );
  if (liveDiffs.length) lines.push('', '### Differences in the real new tables', '', ...liveDiffs.slice(0, 100).map((d) => `- ${d}`), '');
  if (archivedWithGrants.length) lines.push(`- Warning: ${archivedWithGrants.length} archived department(s) still have grants; today they still grant access, after the copy their archived groups will not.`);
  lines.push('');
  if (copiedDiffs.length) {
    lines.push('### Differences after the copy', '', ...copiedDiffs.slice(0, 100).map((d) => `- ${d}`), '');
  }
  if (diffs.length) {
    lines.push('### Differences', '', '| Person | Path | Question | Today | New |', '|---|---|---|---|---|');
    for (const d of diffs.slice(0, 200)) lines.push(`| ${d.who} | \`${d.path}\` | ${d.question} | ${d.before} | ${d.after} |`);
    if (diffs.length > 200) lines.push(`| … | ${diffs.length - 200} more | | | |`);
    lines.push('');
  }

  lines.push('## What the migration would do', '');
  lines.push('### Departments → groups', '');
  if (departments.length === 0) lines.push('None.');
  else {
    lines.push('| Department | Members | Archived |', '|---|---|---|');
    for (const d of departments) lines.push(`| ${d.name} (\`${d.key}\`) | ${d._count.members} | ${d.archived_at ? 'yes' : 'no'} |`);
  }
  lines.push('', '### Grants → access rules', '');
  if (grantRows.length === 0) lines.push('None.');
  else lines.push('| Path | Holder | Today | Becomes |', '|---|---|---|---|', ...grantRows);
  lines.push('', '### Labels → protections on paths', '');
  if (snapshot.labels.length === 0) lines.push('None.');
  else {
    lines.push('| Path | Label | Protection |', '|---|---|---|');
    for (const l of snapshot.labels) lines.push(`| \`${l.path}\` | ${l.label} | ${LEGACY_LABEL_PROTECTION[l.label].name} |`);
  }
  lines.push('', '### Clearances → protection access for that person', '');
  if (snapshot.clearances.size === 0) lines.push('None.');
  else {
    lines.push('| Person | Clearance | Gets |', '|---|---|---|');
    for (const [userId, level] of snapshot.clearances) {
      lines.push(`| ${users.find((x) => x.id === userId)?.email ?? userId} | ${level} | ${level === 'restricted' ? 'Restricted, Confidential' : 'Confidential'} |`);
    }
  }
  const cols = snapshot.columns;
  lines.push('', '### Column protections (unchanged)', '');
  lines.push(
    `${cols?.tags.size ?? 0} protection(s), ${[...(cols?.columnTags.values() ?? [])].reduce((n, m) => n + m.size, 0)} protected column(s), ${cols?.tagGrants.length ?? 0} grant(s), ${cols?.groupsByUser.size ?? 0} person(s) in access groups.`,
  );

  lines.push('', '## Per person: tables they can open (today → new)', '', '| Person | App roles | Open | Export |', '|---|---|---|---|');
  for (const p of perPerson) {
    lines.push(`| ${p.who} | ${p.roles.join(', ')} | ${p.openBefore} → ${p.openAfter} | ${p.exportBefore} → ${p.exportAfter} |`);
  }
  lines.push('');

  const report = lines.join('\n');
  if (out) writeFileSync(out, report);
  else process.stdout.write(report);
  console.error(
    `dry run: ${users.length} people, ${allPaths.length} paths, ${tableChecks} table + ${columnChecks} column decisions, ${diffs.length} differences; after copy ${copiedChecks} decisions, ${copiedDiffs.length} differences; real new tables ${liveApplied ? `${liveChecks} decisions, ${liveDiffs.length} differences` : 'not applied'}${out ? ` → ${out}` : ''}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
