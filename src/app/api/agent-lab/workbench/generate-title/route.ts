import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import OpenAI from 'openai';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const TITLE_MODEL =
  process.env.INSPECTOR_SESSION_TITLE_MODEL ??
  process.env.INSPECTOR_SESSION_SUMMARY_MODEL ??
  'gpt-6-luna';

type TitleMessage = { role?: string; content?: string };

function fallbackTitle(messages: TitleMessage[]): string | null {
  const first = messages.find(m => typeof m.content === 'string' && m.content.trim());
  if (!first?.content) return null;
  const t = first.content.trim().replace(/\s+/g, ' ');
  if (t.length <= 60) return t;
  return `${t.slice(0, 57)}...`;
}

function getFoundryClient(): OpenAI | null {
  const endpoint = process.env.FOUNDRY_ENDPOINT;
  const apiKey = process.env.FOUNDRY_API_KEY;
  if (!endpoint || !apiKey) return null;
  const base = endpoint.replace(/\/$/, '');
  return new OpenAI({
    apiKey,
    baseURL: `${base}/openai/v1`,
    defaultHeaders: { 'api-key': apiKey },
  });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { messages?: TitleMessage[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ title: null });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const userText = messages
    .map(m => (typeof m.content === 'string' ? m.content : ''))
    .filter(Boolean)
    .join('\n')
    .trim();

  if (!userText) {
    return NextResponse.json({ title: null });
  }

  const client = getFoundryClient();
  if (!client) {
    return NextResponse.json({ title: fallbackTitle(messages) });
  }

  try {
    const completion = await client.chat.completions.create({
      model: TITLE_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'Generate a very short chat title (3–8 words, no quotes, no markdown) summarizing the user topic.',
        },
        { role: 'user', content: userText.slice(0, 2000) },
      ],
      max_completion_tokens: 32,
      temperature: 0.3,
    });
    const raw = completion.choices[0]?.message?.content?.trim() ?? '';
    const title =
      raw.replace(/^["']|["']$/g, '').slice(0, 120) || fallbackTitle(messages);
    return NextResponse.json({ title });
  } catch (err) {
    console.error('[workbench/generate-title]', err);
    return NextResponse.json({ title: fallbackTitle(messages) });
  }
}
