import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { getUserByEmail } from '@/lib/dashboards/permissions';
import { listMyRules } from '@/lib/memory/teach';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/inspector/semantic/my-contributions  (W1 — standalone Metrics route)
 *
 * The org-aggregate sibling of /[modelId]/contributions: the caller's unified
 * "What I've taught" feed across EVERY model in the org. Same response shape as
 * the per-model route so one WhatIveTaughtSection renders both. Everything is
 * owner-scoped to the caller; rules + charts are already model-agnostic, so the
 * only difference from the per-model route is dropping the model narrowing on
 * definitions and synonym-audit rows.
 */

interface ContribDefinition {
  id: string;
  kind: 'measure' | 'dimension';
  label: string;
  status: string;
  nlIntent: string | null;
}

interface ContribSynonym {
  defId: string;
  tableName: string;
  added: string[];
  at: string;
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email ?? null;
    const currentUser = email ? await getUserByEmail(email) : null;
    if (!currentUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const org = await getDefaultOrg();
    const uid = currentUser.id;

    const [measures, dimensions, auditRows, rules, charts] = await Promise.all([
      prisma.platform_sem_measures.findMany({
        where: { org_id: org.id, created_by: uid },
        orderBy: { created_at: 'desc' },
        select: { id: true, measure_label: true, status: true, nl_intent: true },
      }),
      prisma.platform_sem_dimensions.findMany({
        where: { org_id: org.id, created_by: uid },
        orderBy: { created_at: 'desc' },
        select: { id: true, dimension_label: true, status: true, nl_intent: true },
      }),
      // Synonym edits: this caller's `edit` audit rows across all models. We
      // filter to rows whose diff touched `synonyms` in app code (diff is JSON).
      prisma.platform_sem_audit.findMany({
        where: { org_id: org.id, changed_by: uid, action: 'edit' },
        orderBy: { created_at: 'desc' },
        take: 100,
        select: { row_id: true, table_name: true, diff: true, created_at: true },
      }),
      listMyRules(org.id, uid),
      prisma.platform_charts.findMany({
        where: { org_id: org.id, created_by: uid, chart_source: 'raw_sql', deleted_at: null },
        orderBy: { created_at: 'desc' },
        select: { id: true, name: true, nl_intent: true, created_at: true },
      }),
    ]);

    const definitions: ContribDefinition[] = [
      ...measures.map((m) => ({
        id: m.id, kind: 'measure' as const, label: m.measure_label, status: m.status, nlIntent: m.nl_intent,
      })),
      ...dimensions.map((d) => ({
        id: d.id, kind: 'dimension' as const, label: d.dimension_label, status: d.status, nlIntent: d.nl_intent,
      })),
    ];

    const synonyms: ContribSynonym[] = [];
    for (const row of auditRows) {
      const diff = Array.isArray(row.diff) ? (row.diff as Array<{ field?: string; old?: unknown; new?: unknown }>) : [];
      const synEntry = diff.find((d) => d.field === 'synonyms');
      if (!synEntry) continue;
      const oldArr = Array.isArray(synEntry.old) ? (synEntry.old as string[]) : [];
      const newArr = Array.isArray(synEntry.new) ? (synEntry.new as string[]) : [];
      const added = newArr.filter((s) => !oldArr.includes(s));
      if (added.length === 0) continue;
      synonyms.push({
        defId: row.row_id,
        tableName: row.table_name,
        added,
        at: row.created_at.toISOString(),
      });
    }

    return NextResponse.json({
      definitions,
      synonyms,
      rules: rules.map((r) => ({
        id: r.id,
        ruleText: r.ruleText,
        ruleType: r.ruleType,
        visibility: r.visibility,
        status: r.status,
      })),
      charts: charts.map((c) => ({
        id: c.id,
        name: c.name,
        nlIntent: c.nl_intent,
        at: c.created_at.toISOString(),
      })),
    });
  } catch (err) {
    console.error('[semantic/my-contributions GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
