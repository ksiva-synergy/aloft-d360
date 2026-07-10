// GET /api/agent-lab/context/mappings/export?format=md
//
// Exports all proposed column mappings for the default org as a markdown table.
// format=md (default): Markdown table, Content-Type text/markdown.
// format=docx: Not yet available (docx package not installed — D-08 deferred).
//
// INVARIANT: no warehouse access. Read-only from platform_context_* tables.
// org_id always from getDefaultOrg().id — never hardcoded.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

type MappingExportRow = {
  mapping_id: string;
  left_path: string;
  right_path: string;
  mapping_kind: string | null;
  confidence: number | null;
  rationale: string | null;
  caveats: string | null;
  transform_hint: string | null;
  created_at: Date;
};

function escapeCell(s: string | null | undefined): string {
  if (s == null) return '';
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ').replace(/\r/g, '');
}

function confidenceTierLabel(conf: number | null): string {
  if (conf == null) return '';
  if (conf >= 0.8) return 'high';
  if (conf >= 0.6) return 'medium';
  return 'low';
}

function renderMarkdown(rows: MappingExportRow[], orgId: string): string {
  const generatedAt = new Date().toISOString();
  const lines: string[] = [
    '# Proposed Column Mappings',
    '',
    `Generated: ${generatedAt}`,
    `Org: ${orgId}`,
    `Total: ${rows.length} mapping${rows.length === 1 ? '' : 's'}`,
    `Status: proposed (basis — nothing confirmed in CH7)`,
    '',
    '| # | Left Column | Right Column | Kind | Confidence | Tier | Rationale | Caveats | Transform Hint |',
    '|---|---|---|---|---|---|---|---|---|',
  ];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const conf = r.confidence != null ? r.confidence.toFixed(3) : '';
    const tier = confidenceTierLabel(r.confidence);
    lines.push(
      `| ${i + 1} | ${escapeCell(r.left_path)} | ${escapeCell(r.right_path)} | ${escapeCell(r.mapping_kind)} | ${conf} | ${tier} | ${escapeCell(r.rationale)} | ${escapeCell(r.caveats)} | ${escapeCell(r.transform_hint)} |`,
    );
  }

  return lines.join('\n') + '\n';
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const format = req.nextUrl.searchParams.get('format') ?? 'md';

  if (format !== 'md') {
    return NextResponse.json(
      {
        error: `Format '${format}' is not supported. Only 'md' is available. DOCX is deferred (D-08).`,
        supported_formats: ['md'],
      },
      { status: 400 },
    );
  }

  let orgId: string;
  try {
    const org = await getDefaultOrg();
    orgId = org.id;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: `Could not resolve org: ${msg}` }, { status: 500 });
  }

  try {
    const rows = await prisma.$queryRaw<MappingExportRow[]>`
      SELECT
        m.id                                              AS mapping_id,
        lo.full_path || '.' || lc.name                   AS left_path,
        ro.full_path || '.' || rc.name                   AS right_path,
        m.mapping_kind,
        m.confidence::float                               AS confidence,
        (m.llm_verdict->>'rationale')                     AS rationale,
        (m.llm_verdict->>'caveats')                       AS caveats,
        (m.llm_verdict->>'transform_hint')                AS transform_hint,
        m.created_at
      FROM  platform_context_mappings m
      JOIN  platform_context_columns  lc ON lc.id = m.left_column_id
      JOIN  platform_context_objects  lo ON lo.id = lc.object_id
      JOIN  platform_context_columns  rc ON rc.id = m.right_column_id
      JOIN  platform_context_objects  ro ON ro.id = rc.object_id
      WHERE m.org_id = ${orgId}
        AND m.status = 'proposed'
      ORDER BY m.confidence DESC NULLS LAST, m.mapping_kind, left_path
    `;

    const md = renderMarkdown(rows, orgId);
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `context-mappings-proposed-${dateStr}.md`;

    return new NextResponse(md, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error('[context/mappings/export GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
