import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Diff = {
  path: string;
  type: 'added' | 'removed' | 'changed';
  oldValue?: unknown;
  newValue?: unknown;
};

function diffObjects(a: Record<string, unknown>, b: Record<string, unknown>, path = ''): Diff[] {
  const diffs: Diff[] = [];
  const allKeys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);

  for (const key of allKeys) {
    const fullPath = path ? `${path}.${key}` : key;
    const aVal = a?.[key];
    const bVal = b?.[key];

    if (aVal === undefined && bVal !== undefined) {
      diffs.push({ path: fullPath, type: 'added', newValue: bVal });
    } else if (aVal !== undefined && bVal === undefined) {
      diffs.push({ path: fullPath, type: 'removed', oldValue: aVal });
    } else if (
      typeof aVal === 'object' && typeof bVal === 'object' &&
      aVal !== null && bVal !== null &&
      !Array.isArray(aVal) && !Array.isArray(bVal)
    ) {
      diffs.push(...diffObjects(aVal as Record<string, unknown>, bVal as Record<string, unknown>, fullPath));
    } else if (JSON.stringify(aVal) !== JSON.stringify(bVal)) {
      diffs.push({ path: fullPath, type: 'changed', oldValue: aVal, newValue: bVal });
    }
  }

  return diffs;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string; otherId: string } }
) {
  try {
    const { id, otherId } = params;

    const [a, b] = await Promise.all([
      prisma.agent_catalog.findUnique({ where: { id } }),
      prisma.agent_catalog.findUnique({ where: { id: otherId } }),
    ]);

    if (!a || !b) {
      return NextResponse.json({ error: 'One or both entries not found' }, { status: 404 });
    }

    const fieldsToCompare = [
      'name', 'description', 'version', 'config', 'tools',
      'input_schema', 'output_schema', 'bus_subscriptions',
      'bus_publications', 'tags', 'status',
    ];

    const aObj: Record<string, unknown> = {};
    const bObj: Record<string, unknown> = {};
    for (const f of fieldsToCompare) {
      aObj[f] = (a as Record<string, unknown>)[f];
      bObj[f] = (b as Record<string, unknown>)[f];
    }

    const diffs = diffObjects(aObj, bObj);

    return NextResponse.json({
      from: { id: a.id, name: a.name, version: a.version },
      to: { id: b.id, name: b.name, version: b.version },
      diffs,
      summary: {
        added: diffs.filter(d => d.type === 'added').length,
        removed: diffs.filter(d => d.type === 'removed').length,
        changed: diffs.filter(d => d.type === 'changed').length,
      },
    });
  } catch (err) {
    console.error('[catalog/agents/:id/diff GET] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
