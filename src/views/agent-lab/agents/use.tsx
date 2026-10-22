'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowUp, Bot, Pencil, RotateCcw, Square } from 'lucide-react';
import { AssistantContent } from '@/components/workbench/StreamingMessage';

type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string };

const STORAGE_LIMIT = 80_000;

function storageKey(slug: string) {
  return `aloft.agentUse.${slug}`;
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

function loadStored(slug: string): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(storageKey(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const role = (item as { role?: unknown }).role;
      const content = (item as { content?: unknown }).content;
      const id = (item as { id?: unknown }).id;
      if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string' || !content.trim()) return [];
      return [{ id: typeof id === 'string' ? id : crypto.randomUUID(), role, content }];
    });
  } catch {
    return [];
  }
}

export default function UseAgentPage() {
  const params = useParams();
  const slug = typeof params.slug === 'string' ? params.slug : '';
  const [name, setName] = useState('');
  const [description, setDescription] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!slug) return;
    setMessages(loadStored(slug));
    setHydrated(true);
  }, [slug]);

  useEffect(() => {
    if (!hydrated || !slug) return;
    try {
      const payload = JSON.stringify(messages);
      if (payload.length <= STORAGE_LIMIT) sessionStorage.setItem(storageKey(slug), payload);
    } catch { /* private mode */ }
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
        setEditUrl(sessionId ? `/agent-lab/workbench/${sessionId}` : null);
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

  useEffect(() => () => ctrlRef.current?.abort(), []);

  const send = async (raw?: string) => {
    const text = (raw ?? draft).trim();
    if (!text || running || !slug) return;
    const history = messages
      .filter((m) => m.content.trim())
      .map((m) => ({ role: m.role, content: m.content }));
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: text };
    const assistantId = crypto.randomUUID();
    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: 'assistant', content: '' }]);
    setDraft('');
    setRunning(true);
    setRunError(null);
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;

    try {
      const res = await fetch('/api/agent-lab/agents/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, message: text, history }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const detail = (await res.text().catch(() => '')).slice(0, 300);
        throw new Error(detail || `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let ev: Record<string, unknown>;
          try { ev = JSON.parse(line.slice(6)); } catch { continue; }
          if (ev.type === 'text') {
            const delta = String(ev.delta ?? '');
            setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: m.content + delta } : m));
          } else if (ev.type === 'error') {
            setRunError(String(ev.message ?? 'The agent hit an error'));
          }
        }
      }
    } catch (err: unknown) {
      if ((err as { name?: string }).name !== 'AbortError') {
        setRunError(err instanceof Error ? err.message : 'The request failed');
      }
    } finally {
      setRunning(false);
      setMessages((prev) => prev.filter((m) => m.role !== 'assistant' || m.content.trim() || m.id !== assistantId));
    }
  };

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
        <p className="mb-4 text-sm text-red-500">{loadError}</p>
        <Link href="/agent-lab/agents" className="text-sm text-[var(--brand-a-ink)] hover:underline">Back to agents</Link>
      </div>
    );
  }

  const clearChat = () => {
    ctrlRef.current?.abort();
    setMessages([]);
    setRunError(null);
    setDraft('');
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-[var(--main-bg)]">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--line-1)] px-4 md:px-6">
        <Mark name={name} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold text-[var(--ink-1)]">{name}</h1>
          <p className="truncate text-xs text-[var(--ink-3)]">{description || 'Saved agent'}</p>
        </div>
        <button
          type="button"
          onClick={clearChat}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
        >
          <RotateCcw className="h-3.5 w-3.5" /> New chat
        </button>
        <Link href={`/docs/agents/${slug}`} className="inline-flex h-8 items-center rounded-lg px-2.5 text-xs font-medium text-[var(--ink-2)] hover:bg-[var(--surface-2)]">
          View
        </Link>
        {editUrl && (
          <Link href={editUrl} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-[var(--ink-2)] hover:bg-[var(--surface-2)]">
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Link>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-3xl flex-col px-4 py-6">
          {messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center pb-8 text-center">
              <Mark name={name} large />
              <h2 className="mt-4 text-xl font-semibold text-[var(--ink-1)]">{name}</h2>
              <p className="mt-1 max-w-md text-sm leading-relaxed text-[var(--ink-3)]">
                {description || 'Ask a question. This agent answers with the instructions saved from the Workbench.'}
              </p>
              <div className="mt-6 flex w-full max-w-lg flex-col gap-2">
                {starters(name).map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void send(prompt)}
                    className="rounded-xl border border-[var(--line-1)] bg-[var(--surface-1)] px-4 py-3 text-left text-sm text-[var(--ink-2)] transition-colors hover:border-[var(--brand-a)] hover:text-[var(--ink-1)]"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {messages.map((message) => (
                <MessageRow key={message.id} message={message} name={name} running={running} />
              ))}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="shrink-0 px-4 pb-4 pt-2 md:px-6">
        {runError && (
          <p className="mx-auto mb-2 max-w-3xl rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{runError}</p>
        )}
        <form
          className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-[var(--line-1)] bg-[var(--surface-1)] p-2 shadow-[0_8px_30px_rgba(0,0,0,0.12)]"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
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
                void send();
              }
            }}
            rows={1}
            placeholder={`Message ${name}…`}
            disabled={running}
            className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-relaxed text-[var(--ink-1)] outline-none placeholder:text-[var(--ink-3)]"
          />
          {running ? (
            <button
              type="button"
              onClick={() => ctrlRef.current?.abort()}
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
        <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-[var(--ink-3)]">Enter to send · Shift+Enter for a new line</p>
      </div>
    </div>
  );
}

function Mark({ name, large = false }: { name: string; large?: boolean }) {
  return (
    <span
      className={large
        ? 'flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--brand-a-soft)] text-lg font-semibold text-[var(--brand-a-ink)]'
        : 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand-a-soft)] text-xs font-semibold text-[var(--brand-a-ink)]'}
      aria-hidden
    >
      {initials(name) || <Bot className="h-4 w-4" />}
    </span>
  );
}

function MessageRow({ message, name, running }: { message: ChatMessage; name: string; running: boolean }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[var(--brand-a)] px-3.5 py-2.5 text-sm leading-relaxed text-white">
          {message.content}
        </p>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3">
      <Mark name={name} />
      <div className="min-w-0 max-w-[85%] pt-1">
        <p className="mb-1 text-xs font-medium text-[var(--ink-3)]">{name}</p>
        {message.content ? (
          <div className="text-sm leading-relaxed text-[var(--ink-1)]">
            <AssistantContent content={message.content} />
          </div>
        ) : running ? (
          <span className="inline-flex items-center gap-1 py-2" aria-label="Thinking">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--ink-3)] [animation-delay:0ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--ink-3)] [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--ink-3)] [animation-delay:300ms]" />
          </span>
        ) : null}
      </div>
    </div>
  );
}
