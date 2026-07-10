import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { snapshotAgentPrompt } from '@/lib/prompt-snapshot';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const data = await prisma.agent_catalog.findUnique({ where: { id } });
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ item: data });
  } catch (err) {
    console.error('[catalog/agents/:id GET] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const immutable = ['id', 'created_at'];
    const updates: Record<string, unknown> = { updated_at: new Date() };
    for (const [key, val] of Object.entries(body)) {
      if (!immutable.includes(key) && val !== undefined) updates[key] = val;
    }

    const data = await prisma.agent_catalog.update({ where: { id }, data: updates });

    // Auto-snapshot system prompt if config contains a prompt field
    try {
      const config = body.config;
      if (config && typeof config === 'object' && config.prompt) {
        await snapshotAgentPrompt({
          agentId: id,
          agentName: body.name || 'Agent',
          systemPrompt: config.prompt,
          version: body.version || '1.0.0',
          author: body.author || null,
        });
      }
    } catch (e) {
      console.error('[agent PATCH] prompt snapshot failed:', e);
    }

    return NextResponse.json({ item: data });
  } catch (err) {
    console.error('[catalog/agents/:id PATCH] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const data = await prisma.agent_catalog.update({
      where: { id },
      data: { status: 'deprecated', updated_at: new Date() },
    });
    return NextResponse.json({ item: data });
  } catch (err) {
    console.error('[catalog/agents/:id DELETE] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
