import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAgentOpsAuth } from '@/lib/agent-ops/access';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await getAgentOpsAuth();
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });

  const rows = await prisma.prompt_templates.findMany({
    where: { is_active: true },
    orderBy: [{ rating: 'desc' }, { updated_at: 'desc' }],
    take: 200,
  });

  return NextResponse.json({ prompts: rows });
}

export async function POST(request: NextRequest) {
  const auth = await getAgentOpsAuth();
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });

  const body = await request.json() as {
    name?: string;
    template?: string;
    category?: string;
    description?: string;
    tags?: string[];
  };

  if (!body.name?.trim() || !body.template?.trim()) {
    return NextResponse.json({ error: 'name and template required' }, { status: 400 });
  }

  const row = await prisma.prompt_templates.create({
    data: {
      name: body.name.trim(),
      template: body.template,
      category: body.category ?? 'agent-ops',
      description: body.description ?? null,
      tags: body.tags ?? [],
      source: 'agent-ops-ui',
      is_active: true,
    },
  });

  return NextResponse.json({ prompt: row });
}
