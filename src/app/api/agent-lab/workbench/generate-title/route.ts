import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getLunaOpenAIChatClient,
  resolveOpenAIChatModelId,
} from '@/lib/bedrock/mantle-openai';
import { BOOST_MODELS } from '@/lib/boost/models';
import { getDefaultOrg } from '@/lib/platform/agents';
import { assertInteractiveBudget, BudgetExceededError } from '@/lib/spend/budgets';
import { logInteractiveLlmTurn } from '@/lib/spend/log-llm-turn';
import { getSessionUserRole } from '@/lib/inspector/session-role';
import { randomUUID } from 'crypto';

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

  const org = await getDefaultOrg();
  const role = await getSessionUserRole();
  try {
    await assertInteractiveBudget({ orgId: org.id, userId: session.user.id, role, estimatedUsd: 0.002 });
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return NextResponse.json({ title: fallbackTitle(messages), code: 'BUDGET_EXCEEDED' });
    }
    throw err;
  }

  const client = getLunaOpenAIChatClient();
  if (!client) {
    return NextResponse.json({ title: fallbackTitle(messages) });
  }

  const modelId = resolveOpenAIChatModelId(TITLE_MODEL, 'session_titles');
  const registered = BOOST_MODELS.find(
    (m) => m.modelId === modelId || m.key === TITLE_MODEL || m.modelId === TITLE_MODEL,
  );
  const tokenParam =
    registered?.tokenParam ??
    (modelId.toLowerCase().includes('gpt') || modelId.toLowerCase().includes('o3')
      ? 'max_completion_tokens'
      : 'max_tokens');
  const tokenConfig =
    tokenParam === 'max_tokens' ? { max_tokens: 32 } : { max_completion_tokens: 32 };

  try {
    const completion = await client.chat.completions.create({
      model: modelId,
      messages: [
        {
          role: 'system',
          content:
            'Generate a very short chat title (3–8 words, no quotes, no markdown) summarizing the user topic.',
        },
        { role: 'user', content: userText.slice(0, 2000) },
      ],
      ...tokenConfig,
    });
    const raw = completion.choices[0]?.message?.content?.trim() ?? '';
    const title =
      raw.replace(/^["']|["']$/g, '').slice(0, 120) || fallbackTitle(messages);
    const inTok = completion.usage?.prompt_tokens ?? 0;
    const outTok = completion.usage?.completion_tokens ?? 0;
    if (inTok + outTok > 0) {
      void logInteractiveLlmTurn({
        orgId: org.id,
        userId: session.user.id,
        surface: 'workbench',
        action: 'generate_title',
        model: modelId,
        inputTokens: inTok,
        outputTokens: outTok,
        turnId: randomUUID(),
        status: 'success',
      });
    }
    return NextResponse.json({ title });
  } catch (err) {
    console.error('[workbench/generate-title]', err);
    return NextResponse.json({ title: fallbackTitle(messages) });
  }
}
