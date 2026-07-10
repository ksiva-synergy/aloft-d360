import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const comments = await prisma.catalog_review_comments.findMany({
      where: { catalog_type: 'agent', catalog_entry_id: params.id },
      orderBy: { created_at: 'asc' },
    });
    return NextResponse.json({ comments });
  } catch (err) {
    console.error('[catalog/agents/:id/review GET] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const { author, body: commentBody, status: reviewStatus } = body;

    if (!author || !commentBody) {
      return NextResponse.json({ error: 'author and body are required' }, { status: 400 });
    }

    const comment = await prisma.catalog_review_comments.create({
      data: {
        catalog_type: 'agent',
        catalog_entry_id: params.id,
        author,
        body: commentBody,
        status: reviewStatus || 'comment',
      },
    });

    if (reviewStatus === 'approve') {
      await prisma.agent_catalog.update({
        where: { id: params.id },
        data: { status: 'published', is_head: true, updated_at: new Date() },
      });
    }

    return NextResponse.json({ comment }, { status: 201 });
  } catch (err) {
    console.error('[catalog/agents/:id/review POST] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
