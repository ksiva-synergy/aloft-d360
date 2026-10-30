'use client';

import { useEffect, useRef, useState } from 'react';
import Link from '@/lib/navigation/link';
import { useParams } from '@/lib/navigation';
import { AGENTS_LIST_HREF, agentsWorkbenchSessionHref } from '@/lib/navigation/agents-routes';
import { ArrowLeft, ArrowUp, Bot, Pencil, RotateCcw, Square } from 'lucide-react';
import { AssistantContent } from '@/components/chat/AssistantContent';
import { CaptainStatus } from '@/components/companion/CaptainStatus';
import type { ToolCall } from '@/components/agent-lab/workbench/types';
import { DEFAULT_INSPECTOR_MODEL_KEY } from '@/lib/inspector/default-model';
import { useInspectorChatModels } from '@/hooks/useInspectorChatModels';
import { ModelSelector } from '@/components/workbench/InputComposer';
import {
  isAgentUseChatRunning,
  persistAgentUseMessages,
  resetAgentUseChat,
  startAgentUseChat,
  stopAgentUseChat,
  subscribeAgentUseChat,
  type AgentUseChatMessage,
} from '@/lib/agents/agent-use-chat-stream';

/** Centered empty-state + thread composer width cap (px) — not full-bleed, not phone-narrow. */
const CHAT_COMPOSER_MAX_PX = 880;

function agentUseModelStorageKey(slug: string) {
  return `aloft.agentUse.model.${slug}`;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? 'A') + (parts.length > 1 ? parts[1][0] : '')).toUpperCase();
}

function starters(name: string): string[] {
  return [
    `What can ${name} help me with?`,
    'Show me a recent example from the data.',
    'What should I ask you first?',
  ];
}

export default function UseAgentPage() {
  const params = useParams();
  const slug = typeof params.slug === 'string' ? params.slug : '';
  const [name, setName] = useState('');
  const [description, setDescription] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentUseChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const { models: chatModels } = useInspectorChatModels();
  const [previewModel, setPreviewModel] = useState(DEFAULT_INSPECTOR_MODEL_KEY);
  const modelRef = useRef(previewModel);
  modelRef.current = previewModel;

  useEffect(() => {
    if (!slug) return;
    try {
      const stored = sessionStorage.getItem(agentUseModelStorageKey(slug));
      if (stored && chatModels.some((m) => m.key === stored)) {
        setPreviewModel(stored);
        return;
      }
    } catch { /* private mode */ }
    if (chatModels.some((m) => m.key === previewModel)) return;
    const fallback = chatModels.find((m) => m.key === DEFAULT_INSPECTOR_MODEL_KEY) ?? chatModels[0];
    if (fallback) setPreviewModel(fallback.key);
  }, [slug, chatModels]);

  const onModelChange = (key: string) => {
    setPreviewModel(key);
    if (!slug) return;
    try {
      sessionStorage.setItem(agentUseModelStorageKey(slug), key);
    } catch { /* private mode */ }
  };

  useEffect(() => {
    if (!slug) return;
    setHydrated(false);
    const unsub = subscribeAgentUseChat(slug, (snap) => {
      setMessages(snap.messages);
      setRunning(snap.running);
      setRunError(snap.runError);
      setToolCalls(snap.toolCalls);
      setStartedAt(snap.startedAt);
    });
    setHydrated(true);
    return unsub;
  }, [slug]);

  useEffect(() => {
    if (!hydrated || !slug) return;
    persistAgentUseMessages(slug, messages);
  }, [hydrated, messages, slug]);

  useEffect(() => {
    if (!slug) {
      setLoading(false);
      setLoadError('No agent specified.');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/catalog/agents?slug=${encodeURIComponent(slug)}`);
        const data = await res.json().catch(() => ({}));
        if (res.status === 404) throw new Error(`Agent "${slug}" was not found.`);
        if (!res.ok) throw new Error(data.error ?? 'Could not load this agent');
        const item = data.item as { name?: string; description?: string | null; config?: Record<string, unknown> } | undefined;
        if (!item?.name) throw new Error(`Agent "${slug}" was not found.`);
        if (cancelled) return;
        setName(item.name);
        setDescription(item.description ?? null);
        const source = item.config?.source;
        const sessionId = source && typeof source === 'object' && typeof (source as { workbenchSessionId?: unknown }).workbenchSessionId === 'string'
          ? (source as { workbenchSessionId: string }).workbenchSessionId
          : null;
        setEditUrl(sessionId ? agentsWorkbenchSessionHref(sessionId) : null);
      } catch (err: unknown) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not load this agent');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, running]);

  const send = (raw?: string) => {
    const text = (raw ?? draft).trim();
    if (!text || !slug) return;
    const history = messagesRef.current
      .filter((m) => m.content.trim())
      .map((m) => ({ role: m.role, content: m.content }));
    setDraft('');
    setRunError(null);
    startAgentUseChat({
      slug,
      message: text,
      history,
      priorMessages: messagesRef.current,
      model: modelRef.current,
    });
  };

  const chatBusy = running || isAgentUseChatRunning(slug);

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[var(--brand-a)]" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16 text-center">
        <p className="mb-4 text-size-body text-red-500">{loadError}</p>
        <Link href="/agent-lab/agents" className="text-size-body text-[var(--brand-a-ink)] hover:underline">Back to agents</Link>
      </div>
    );
  }

  const clearChat = () => {
    resetAgentUseChat(slug);
    setMessages([]);
    setRunError(null);
    setDraft('');
    setRunning(false);
  };

  const composerForm = (
    <>
      {runError && (
        <p className="mb-2 w-full rounded-lg bg-red-500/10 px-3 py-2 text-size-body text-red-500">{runError}</p>
      )}
      <form
        className="mx-auto flex w-full items-end gap-2 rounded-2xl border border-[var(--line-1)] bg-[var(--surface-1)] p-2.5 shadow-[0_8px_30px_rgba(0,0,0,0.12)]"
        style={{ maxWidth: CHAT_COMPOSER_MAX_PX }}
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            e.target.style.height = '0px';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder={`Message ${name}…`}
          disabled={chatBusy}
          className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-3 py-2.5 text-size-body leading-relaxed text-[var(--ink-1)] outline-none placeholder:text-[var(--ink-3)]"
        />
        <div className="shrink-0 self-end pb-0.5">
          <ModelSelector
            selectedModel={previewModel}
            onModelChange={onModelChange}
            models={chatModels}
            disabled={chatBusy || chatModels.length === 0}
            align="right"
          />
        </div>
        {chatBusy ? (
          <button
            type="button"
            onClick={() => stopAgentUseChat(slug)}
            aria-label="Stop"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--line-1)] text-[var(--ink-1)]"
          >
            <Square className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!draft.trim()}
            aria-label="Send"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand-a)] text-white disabled:opacity-40"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        )}
      </form>
      <p className="mt-2 w-full text-center text-[length:var(--type-caption-size)] text-[var(--ink-3)]">
        Enter to send · Shift+Enter for a new line
      </p>
    </>
  );

  const emptyChat = messages.length === 0;
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;

  return (
    <div className="absolute inset-0 flex min-h-0 flex-col overflow-hidden bg-[var(--main-bg)]">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--line-1)] px-4 md:px-6">
        <Link
          href={AGENTS_LIST_HREF}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
          title="All agents"
          aria-label="All agents"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Mark name={name} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[length:var(--type-body-size)] font-semibold text-[var(--ink-1)]">{name}</h1>
          <p className="truncate text-size-ui text-[var(--ink-3)]">{description || 'Saved agent'}</p>
        </div>
        <button
          type="button"
          onClick={clearChat}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-size-ui font-medium text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
        >
          <RotateCcw className="h-3.5 w-3.5" /> New chat
        </button>
        <Link href={`/docs/agents/${slug}`} className="inline-flex h-8 items-center rounded-lg px-2.5 text-size-ui font-medium text-[var(--ink-2)] hover:bg-[var(--surface-2)]">
          View
        </Link>
        {editUrl && (
          <Link href={editUrl} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-size-ui font-medium text-[var(--ink-2)] hover:bg-[var(--surface-2)]">
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Link>
        )}
      </header>

      {emptyChat ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-8 md:px-8">
          <div
            className="flex w-full flex-col items-center gap-6 text-center"
            style={{ maxWidth: CHAT_COMPOSER_MAX_PX }}
          >
            <Mark name={name} large />
            <div>
              <h2 className="text-size-title-section font-semibold text-[var(--ink-1)]">{name}</h2>
              <p className="mt-1 text-size-body leading-relaxed text-[var(--ink-3)]">
                {description || 'Ask a question. This agent answers with the instructions saved from the Workbench.'}
              </p>
            </div>
            <div className="w-full text-left">{composerForm}</div>
            <div className="flex w-full flex-col gap-2">
              {starters(name).map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => send(prompt)}
                  className="rounded-xl border border-[var(--line-1)] bg-[var(--surface-1)] px-4 py-3 text-left text-size-body text-[var(--ink-2)] transition-colors hover:border-[var(--brand-a)] hover:text-[var(--ink-1)]"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex min-h-full w-full max-w-[1400px] flex-col px-4 py-6 md:px-8">
              <div className="space-y-5">
                {messages.map((message) => (
                  <MessageRow
                    key={message.id}
                    message={message}
                    name={name}
                    status={message.id === lastAssistantId ? { running, toolCalls, startedAt, error: runError } : null}
                  />
                ))}
              </div>
              <div ref={bottomRef} />
            </div>
          </div>

          <div className="shrink-0 px-4 pb-4 pt-2 md:px-6">
            <div className="mx-auto w-full" style={{ maxWidth: CHAT_COMPOSER_MAX_PX }}>
              {composerForm}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Mark({ name, large = false }: { name: string; large?: boolean }) {
  return (
    <span
      className={large
        ? 'flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--brand-a-soft)] text-size-title-section font-semibold text-[var(--brand-a-ink)]'
        : 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand-a-soft)] text-size-ui font-semibold text-[var(--brand-a-ink)]'}
      aria-hidden
    >
      {initials(name) || <Bot className="h-4 w-4" />}
    </span>
  );
}

type LiveStatus = { running: boolean; toolCalls: ToolCall[]; startedAt: number | null; error: string | null };

function MessageRow({ message, name, status }: { message: AgentUseChatMessage; name: string; status: LiveStatus | null }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="ml-auto max-w-[min(720px,90%)] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[var(--brand-a)] px-3.5 py-2.5 text-size-body leading-relaxed text-white">
          {message.content}
        </p>
      </div>
    );
  }
  return (
    <div className="flex w-full items-start gap-3">
      <Mark name={name} />
      <div className="min-w-0 flex-1 pt-1">
        <p className="mb-1 text-size-ui font-medium text-[var(--ink-3)]">{name}</p>
        {message.content && (
          <div className="w-full min-w-0 text-size-body leading-relaxed text-[var(--ink-1)]">
            <AssistantContent content={message.content} />
          </div>
        )}
        {/* Live companion trails the reply so a pause for a tool call never looks frozen. */}
        {status && (
          <CaptainStatus
            className="!px-0 !py-1.5"
            isStreaming={status.running}
            content={message.content}
            toolCalls={status.toolCalls}
            error={status.error}
            startedAt={status.startedAt}
          />
        )}
      </div>
    </div>
  );
}
