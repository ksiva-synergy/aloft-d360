'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from '@/lib/navigation/link';
import { useParams, useRouter, useSearchParams } from '@/lib/navigation';
import { AGENTS_LIST_HREF, agentsWorkbenchSessionHref } from '@/lib/navigation/agents-routes';
import { agentChatHref } from '@/lib/sessions/surfaces';
import { ArrowLeft, ArrowUp, ArrowUpRight, Check, ChevronsLeft, ChevronsRight, Compass, Database, Eye, Lightbulb, MessageSquare, Pencil, Plus, Sparkles, Square, X } from 'lucide-react';
import { AgentAvatar } from '@/components/agent-lab/AgentAvatar';
import { AssistantContent } from '@/components/chat/AssistantContent';
import { AnswerInspection } from '@/components/agent-lab/AnswerInspection';
import { CaptainStatus } from '@/components/companion/CaptainStatus';
import type { ToolCall } from '@/components/agent-lab/workbench/types';
import { DEFAULT_INSPECTOR_MODEL_KEY } from '@/lib/inspector/default-model';
import { useInspectorChatModels } from '@/hooks/useInspectorChatModels';
import { ModelSelector } from '@/components/workbench/InputComposer';
import {
  getAgentUseChatSnapshot,
  isAgentUseChatRunning,
  openAgentUseChat,
  resetAgentUseChat,
  startAgentUseChat,
  stopAgentUseChat,
  subscribeAgentUseChat,
  type AgentUseChatMessage,
} from '@/lib/agents/agent-use-chat-stream';

/** Centered empty-state + thread composer width cap (px) — not full-bleed, not phone-narrow. */
const CHAT_COMPOSER_MAX_PX = 760;
const CHAT_LIST_COLLAPSED_KEY = 'aloft.agentUse.chatListCollapsed';

type ChatListItem = {
  id: string;
  title: string | null;
  lastMessage: string | null;
  messageCount: number;
  updatedAt: string | null;
  /** Review list only: whose chat this is. */
  owner?: string;
};
type ChatListTab = 'mine' | 'review';

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function agentUseModelStorageKey(slug: string) {
  return `aloft.agentUse.model.${slug}`;
}

/** `chip` is the short pill text; `prompt` is what gets sent. */
function starters(name: string): { prompt: string; chip: string; icon: ReactNode }[] {
  return [
    { prompt: `What can ${name} help me with?`, chip: 'What can you do?', icon: <Sparkles className="h-3.5 w-3.5" /> },
    { prompt: 'Show me a recent example from the data.', chip: 'Show a recent example', icon: <Database className="h-3.5 w-3.5" /> },
    { prompt: 'What should I ask you first?', chip: 'Where do I start?', icon: <Compass className="h-3.5 w-3.5" /> },
    { prompt: 'Explain how you reach your answers.', chip: 'How do you answer?', icon: <Lightbulb className="h-3.5 w-3.5" /> },
  ];
}

export default function UseAgentPage() {
  const params = useParams();
  const slug = typeof params.slug === 'string' ? params.slug : '';
  const router = useRouter();
  const searchParams = useSearchParams();
  const chatParam = searchParams.get('chat');
  const [name, setName] = useState('');
  const [description, setDescription] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentUseChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [chatList, setChatList] = useState<{ slug: string; items: ChatListItem[] }>({ slug: '', items: [] });
  const chats = chatList.slug === slug ? chatList.items : [];
  /** Admins (session:read:all) also get a separate, read-only "Review" list of other people's chats. */
  const [canReview, setCanReview] = useState(false);
  const [listTab, setListTab] = useState<ChatListTab>('mine');
  const [reviewList, setReviewList] = useState<{ slug: string; items: ChatListItem[] } | null>(null);
  const reviewChats = reviewList?.slug === slug ? reviewList.items : null;
  /** Result of the last failed `?chat=` load, kept per id so it disappears when the URL changes. */
  const [chatLoadFailure, setChatLoadFailure] = useState<{ id: string; error: string } | null>(null);
  /** Opened someone else's chat (platform admin, from the Review list): view only. */
  const [readOnly, setReadOnly] = useState(false);
  /** Chat list sidebar hidden to a slim rail; remembered across agents and reloads. */
  const [listCollapsed, setListCollapsed] = useState(() => {
    try {
      return localStorage.getItem(CHAT_LIST_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleListCollapsed = () => {
    setListCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(CHAT_LIST_COLLAPSED_KEY, next ? '1' : '0');
      } catch { /* private mode */ }
      return next;
    });
  };
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const chatParamRef = useRef(chatParam);
  useEffect(() => {
    chatParamRef.current = chatParam;
  }, [chatParam]);
  /** Chat id being fetched from ?chat=, so the URL is not rewritten to the old chat meanwhile. */
  const loadingChatRef = useRef<string | null>(null);
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
    const unsub = subscribeAgentUseChat(slug, (snap) => {
      setChatId(snap.chatId);
      setMessages(snap.messages);
      setRunning(snap.running);
      setRunError(snap.runError);
      setToolCalls(snap.toolCalls);
      setStartedAt(snap.startedAt);
    });
    return unsub;
  }, [slug]);

  const refreshChats = useCallback(() => {
    if (!slug) return;
    fetch(`/api/agent-lab/agents/chats?slug=${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { chats?: ChatListItem[]; canReview?: boolean } | null) => {
        if (data?.chats) setChatList({ slug, items: data.chats });
        setCanReview(Boolean(data?.canReview));
      })
      .catch(() => {});
  }, [slug]);

  const refreshReview = useCallback(() => {
    if (!slug) return;
    fetch(`/api/agent-lab/agents/chats?slug=${encodeURIComponent(slug)}&scope=review`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { chats?: ChatListItem[] } | null) => {
        setReviewList({ slug, items: data?.chats ?? [] });
      })
      .catch(() => setReviewList({ slug, items: [] }));
  }, [slug]);

  const showListTab = (tab: ChatListTab) => {
    setListTab(tab);
    if (tab === 'review') refreshReview();
  };

  useEffect(() => {
    refreshChats();
  }, [refreshChats]);

  // ?chat=<id> opens a saved chat (yours, or read-only for a platform admin auditing it).
  useEffect(() => {
    if (!slug || !chatParam) return;
    if (chatParam === getAgentUseChatSnapshot(slug).chatId) return;
    if (isAgentUseChatRunning(slug)) return;
    let cancelled = false;
    loadingChatRef.current = chatParam;
    (async () => {
      try {
        const res = await fetch(`/api/agent-lab/agents/chats/${encodeURIComponent(chatParam)}`);
        const data = (await res.json().catch(() => ({}))) as {
          chat?: { id: string; slug: string | null; messages: AgentUseChatMessage[]; readOnly: boolean };
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !data.chat) throw new Error(data.error ?? 'Could not open this chat');
        if (data.chat.slug && data.chat.slug !== slug) throw new Error('This chat belongs to a different agent.');
        setReadOnly(data.chat.readOnly);
        // Someone else's chat (admin review) belongs in the Review list, never in "Your chats".
        if (data.chat.readOnly) {
          setListTab('review');
          refreshReview();
        } else {
          setListTab('mine');
        }
        openAgentUseChat(slug, data.chat.id, data.chat.messages);
      } catch (err: unknown) {
        if (!cancelled) setChatLoadFailure({ id: chatParam, error: err instanceof Error ? err.message : 'Could not open this chat' });
      } finally {
        if (loadingChatRef.current === chatParam) loadingChatRef.current = null;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, chatParam, refreshReview]);

  const chatLoadError = chatParam && chatLoadFailure?.id === chatParam ? chatLoadFailure.error : null;
  // Waiting for ?chat= to load: the URL names a chat that is not open yet and has not failed.
  const chatLoading = !!chatParam && chatParam !== chatId && !chatLoadError && !running;

  // A new chat gets its id from the server on the first send: put it in the URL so reload resumes it.
  useEffect(() => {
    if (!slug || !chatId || loadingChatRef.current) return;
    if (chatId !== chatParamRef.current) router.replace(agentChatHref(slug, chatId), { scroll: false });
  }, [slug, chatId, router]);

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
    if (!text || !slug || readOnly) return;
    setDraft('');
    setRunError(null);
    startAgentUseChat({
      slug,
      chatId: getAgentUseChatSnapshot(slug).chatId,
      message: text,
      priorMessages: messagesRef.current,
      model: modelRef.current,
      onSettled: refreshChats,
    });
  };

  const chatBusy = running || isAgentUseChatRunning(slug);

  if (loading) {
    return (
      <div className="mx-auto flex min-h-[320px] w-full max-w-[560px] flex-col items-center justify-center gap-4 px-6" aria-busy="true" aria-label="Loading agent">
        <span className="ld-skel" style={{ width: 56, height: 56, borderRadius: 16 }} />
        <span className="ld-skel" style={{ width: '40%', height: 16 }} />
        <span className="ld-skel" style={{ width: '70%', animationDelay: '120ms' }} />
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
    setReadOnly(false);
    setListTab('mine');
    setChatLoadFailure(null);
    setDraft('');
    if (chatParam) router.replace(agentChatHref(slug), { scroll: false });
    refreshChats();
  };

  const openChat = (id: string) => {
    if (chatBusy || id === chatId) return;
    router.push(agentChatHref(slug, id), { scroll: false });
  };

  const readOnlyNotice = (
    <div className="mx-auto flex w-full items-center gap-2 rounded-[26px] border border-[var(--line-1)] bg-[var(--surface-1)] py-2 pl-5 pr-2 text-size-body text-[var(--ink-2)]" style={{ maxWidth: CHAT_COMPOSER_MAX_PX }}>
      <Eye className="h-4 w-4 shrink-0 text-[var(--ink-3)]" />
      <span className="flex-1">You are viewing another person&apos;s chat (read-only). Start a new chat to talk to {name}.</span>
      <button type="button" onClick={() => clearChat()} className="h-9 shrink-0 rounded-full px-4 text-size-ui font-medium text-[var(--brand-a-ink)] hover:bg-[var(--surface-2)]">
        New chat
      </button>
    </div>
  );

  const composerForm = readOnly ? readOnlyNotice : (
    <>
      {runError && (
        <p className="mb-2 w-full rounded-[20px] bg-red-500/10 px-4 py-2 text-size-body text-red-500">{runError}</p>
      )}
      <form
        className="mx-auto flex w-full items-end gap-2 rounded-[26px] border border-[var(--line-1)] bg-[var(--surface-1)] py-1.5 pl-1.5 pr-2 shadow-[0_8px_30px_rgba(0,0,0,0.12)] transition-[border-color,box-shadow] duration-hover focus-within:border-[color-mix(in_srgb,var(--brand-a)_45%,var(--line-1))] focus-within:shadow-[var(--focus-ring),0_8px_30px_rgba(0,0,0,0.12)]"
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
          className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent py-2 pl-4 pr-2 text-size-body leading-relaxed text-[var(--ink-1)] outline-none placeholder:text-[var(--ink-3)]"
        />
        {/* Same height as one line of text, so the controls sit centred in the pill and stay on the last line when it grows. */}
        <div className="flex h-[40px] shrink-0 items-center gap-1.5 self-end">
          <ModelSelector
            selectedModel={previewModel}
            onModelChange={onModelChange}
            models={chatModels}
            disabled={chatBusy || chatModels.length === 0}
            align="right"
          />
          {chatBusy ? (
            <button
              type="button"
              onClick={() => stopAgentUseChat(slug)}
              aria-label="Stop"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--line-1)] text-[var(--ink-1)] transition-colors hover:bg-[var(--surface-2)]"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!draft.trim()}
              aria-label="Send"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand-a)] text-white transition-[background-color,transform] duration-hover active:scale-[0.94] disabled:bg-[var(--surface-3)] disabled:text-[var(--ink-3)] disabled:active:scale-100"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
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
        <Mark name={name} hint={description} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[length:var(--type-body-size)] font-semibold text-[var(--ink-1)]">{name}</h1>
          <p className="truncate text-size-ui text-[var(--ink-3)]">{description || 'Saved agent'}</p>
        </div>
        <button
          type="button"
          onClick={clearChat}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-size-ui font-medium text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
        >
          <Plus className="h-3.5 w-3.5" /> New chat
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

      <div className="flex min-h-0 flex-1">
        <ChatList
          tab={canReview ? listTab : 'mine'}
          canReview={canReview}
          onTab={showListTab}
          chats={canReview && listTab === 'review' ? reviewChats : chats}
          activeId={chatId}
          disabled={chatBusy}
          onOpen={openChat}
          onNew={clearChat}
          collapsed={listCollapsed}
          onToggleCollapsed={toggleListCollapsed}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {chatLoadError && (
        <p className="mx-4 mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-size-body text-red-500 md:mx-6">{chatLoadError}</p>
      )}
      {chatLoading ? (
        <div className="mx-auto flex w-full flex-1 flex-col gap-6 px-4 py-6 md:px-8" style={{ maxWidth: CHAT_COMPOSER_MAX_PX }} aria-busy="true" aria-label="Loading chat">
          <span className="ld-skel ml-auto" style={{ width: '42%', height: 36, borderRadius: 16 }} />
          <div className="flex items-start gap-3">
            <span className="ld-skel shrink-0" style={{ width: 36, height: 36, borderRadius: 999 }} />
            <div className="flex flex-1 flex-col gap-2.5 pt-2">
              {[88, 74, 52].map((w, i) => (
                <span key={w} className="ld-skel" style={{ width: `${w}%`, animationDelay: `${i * 120}ms` }} />
              ))}
            </div>
          </div>
        </div>
      ) : emptyChat ? (
        <div className="wl-root flex min-h-0 flex-1 flex-col">
          <div className="wl-glow" aria-hidden />
          {/* Hero fills the free space; the composer sits where it will stay once the chat starts. */}
          <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-8 md:px-8">
            <div className="wl-in flex max-w-[560px] flex-col items-center gap-5 text-center">
              <div className="wl-hero">
                <Mark name={name} hint={description} large />
              </div>
              <div>
                <h2 className="wl-title text-size-title-section font-semibold">{name}</h2>
                <p className="mt-1.5 text-size-body leading-relaxed text-[var(--ink-2)]">
                  {description || 'Ask a question. This agent answers with the instructions saved from the Workbench.'}
                </p>
              </div>
            </div>
          </div>
          <div className="relative shrink-0 px-4 pb-4 pt-2 md:px-6">
            <div className="mx-auto w-full" style={{ maxWidth: CHAT_COMPOSER_MAX_PX }}>
              <div className="mb-3 flex flex-wrap justify-center gap-2">
                {starters(name).map((s, i) => (
                  <button
                    key={s.prompt}
                    type="button"
                    onClick={() => send(s.prompt)}
                    title={s.prompt}
                    className="wl-in group inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--line-1)] bg-[var(--surface-1)] px-3 text-size-ui text-[var(--ink-2)] transition-[background-color,border-color,color,transform] duration-hover hover:border-[var(--line-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink-1)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] active:scale-[0.97]"
                    style={{ animationDelay: `${80 + i * 50}ms` }}
                  >
                    <span className="text-[var(--ink-3)] transition-colors duration-hover group-hover:text-[var(--brand-a-ink)]">{s.icon}</span>
                    {s.chip}
                  </button>
                ))}
              </div>
              <div className="text-left">{composerForm}</div>
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
                    hint={description}
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
      </div>
    </div>
  );
}

/**
 * "Your chats": only the signed-in person's own chats with this agent.
 * Admins also get a separate "Review" tab (other people's chats, read-only; other platform admins'
 * chats are never shown). The lists are never mixed.
 */
function ChatList({
  tab,
  canReview,
  onTab,
  chats,
  activeId,
  disabled,
  onOpen,
  onNew,
  collapsed,
  onToggleCollapsed,
}: {
  tab: ChatListTab;
  canReview: boolean;
  onTab: (tab: ChatListTab) => void;
  /** null = review list still loading. */
  chats: ChatListItem[] | null;
  activeId: string | null;
  disabled: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const review = tab === 'review';
  if (collapsed) {
    return (
      <aside className="hidden w-12 shrink-0 flex-col items-center gap-1 border-r border-[var(--line-1)] pt-3 md:flex" aria-label="Chat list (collapsed)">
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="Show chat list"
          aria-label="Show chat list"
          aria-expanded={false}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--ink-2)] transition-[background-color,transform] duration-150 ease-out hover:bg-[var(--surface-2)] hover:text-[var(--ink-1)] active:scale-[0.95]"
        >
          <ChevronsRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onNew}
          title="New chat"
          aria-label="New chat"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
        >
          <Plus className="h-4 w-4" />
        </button>
      </aside>
    );
  }
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-[var(--line-1)] md:flex" aria-label={review ? 'Review other people’s chats' : 'Your chats'}>
      <div className="flex items-center justify-between gap-2 pb-2 pl-4 pr-2 pt-3">
        <span className="text-size-ui font-semibold text-[var(--ink-1)]">Chats</span>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onNew}
            title="New chat"
            aria-label="New chat"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink-1)]"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onToggleCollapsed}
            title="Hide chat list"
            aria-label="Hide chat list"
            aria-expanded
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--ink-2)] transition-[background-color,transform] duration-150 ease-out hover:bg-[var(--surface-2)] hover:text-[var(--ink-1)] active:scale-[0.95]"
          >
            <ChevronsLeft className="h-4 w-4" />
          </button>
        </div>
      </div>
      {canReview && (
        <div role="tablist" aria-label="Chat lists" className="mx-3 mb-2 grid grid-cols-2 rounded-lg bg-[var(--surface-2)] p-0.5">
          {(['mine', 'review'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => onTab(t)}
              className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-size-ui font-medium transition-colors ${
                tab === t ? 'bg-[var(--surface-1)] text-[var(--ink-1)] shadow-sm' : 'text-[var(--ink-3)] hover:text-[var(--ink-2)]'
              }`}
            >
              {t === 'mine' ? <MessageSquare className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {t === 'mine' ? 'Yours' : 'Review'}
            </button>
          ))}
        </div>
      )}
      {review && (
        <p className="mx-3 mb-2 flex items-start gap-1.5 rounded-lg bg-[var(--surface-2)] px-2 py-1.5 text-[length:var(--type-caption-size)] leading-snug text-[var(--ink-3)]">
          <Eye className="mt-0.5 h-3 w-3 shrink-0" />
          Other people&apos;s chats with this agent. Admin only, read-only.
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {chats === null ? (
          <div className="px-2 py-2" aria-busy="true" aria-label="Loading chats">
            {[78, 62, 86, 54].map((w, i) => (
              <span key={w} className="ld-skel" style={{ width: `${w}%`, height: 12, margin: '10px 0', animationDelay: `${i * 90}ms` }} />
            ))}
          </div>
        ) : chats.length === 0 ? (
          <p className="px-2 py-3 text-size-ui leading-relaxed text-[var(--ink-3)]">
            {review
              ? 'Nobody else has chatted with this agent yet.'
              : 'No chats yet. Your conversations with this agent are saved here and only you can see them.'}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {chats.map((c) => {
              const active = c.id === activeId;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(c.id)}
                    disabled={disabled && !active}
                    aria-current={active ? 'true' : undefined}
                    className={`flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors disabled:opacity-50 ${
                      active ? 'bg-[var(--surface-2)] text-[var(--ink-1)]' : 'text-[var(--ink-2)] hover:bg-[var(--surface-2)]'
                    }`}
                  >
                    {review
                      ? <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ink-3)]" />
                      : <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ink-3)]" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-size-ui font-medium">{c.title || c.lastMessage || 'Untitled chat'}</span>
                      <span className="block truncate text-[length:var(--type-caption-size)] text-[var(--ink-3)]">
                        {review && c.owner ? `${c.owner} · ` : ''}{relativeTime(c.updatedAt)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

function Mark({ name, hint, large = false }: { name: string; hint?: string | null; large?: boolean }) {
  return <AgentAvatar name={name} hint={hint} size={large ? 'lg' : 'sm'} />;
}

type LiveStatus = { running: boolean; toolCalls: ToolCall[]; startedAt: number | null; error: string | null };

/** Step timeline for the in-flight turn, matching the Inspector / Workbench loading design. */
function LiveSteps({ toolCalls, running }: { toolCalls: ToolCall[]; running: boolean }) {
  const done = toolCalls.filter(t => t.status === 'success').length;
  return (
    <div className="ld-card my-2">
      {running && <div className="ld-bar" />}
      <div className="flex items-center gap-2.5 px-3.5 pt-2.5 text-size-ui">
        {running ? <span className="ld-dot" /> : <Check className="h-3.5 w-3.5 text-[var(--ok)]" />}
        <span className={running ? 'ld-shimmer-text font-medium' : 'font-medium text-[var(--ink-2)]'}>{running ? 'Working' : 'Steps'}</span>
        <span className="ml-auto tabular-nums text-[var(--ink-3)]">{done}/{toolCalls.length}</span>
      </div>
      <ol className="ld-steps px-3.5 pb-2 pt-1">
        {toolCalls.map((tc) => {
          const state = tc.status === 'running' || tc.status === 'suggested' ? 'active'
            : tc.status === 'success' ? 'done'
            : tc.status === 'error' ? 'error'
            : 'pending';
          return (
            <li key={tc.callId} className="ld-step" data-state={state}>
              <div className="ld-step-row text-size-ui">
                <span className="ld-step-mark">
                  {state === 'active' ? <span className="ld-dot" />
                    : state === 'done' ? <Check className="h-2.5 w-2.5" strokeWidth={3} />
                    : state === 'error' ? <X className="h-2.5 w-2.5" strokeWidth={3} />
                    : null}
                </span>
                <span className={`min-w-0 flex-1 truncate ${state === 'active' ? 'ld-shimmer-text' : ''}`}>
                  {(tc.toolName || tc.toolId).replace(/^Databricks:\s*/i, '')}
                </span>
                {tc.durationMs != null && state === 'done' && (
                  <span className="shrink-0 font-mono text-[var(--ink-3)]">
                    {tc.durationMs < 1000 ? `${tc.durationMs}ms` : `${(tc.durationMs / 1000).toFixed(1)}s`}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function MessageRow({ message, name, hint, status }: { message: AgentUseChatMessage; name: string; hint: string | null; status: LiveStatus | null }) {
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
      <Mark name={name} hint={hint} />
      <div className="min-w-0 flex-1 pt-1">
        <p className="mb-1 text-size-ui font-medium text-[var(--ink-3)]">{name}</p>
        {message.content && (
          <div className="w-full min-w-0 text-size-body leading-relaxed text-[var(--ink-1)]">
            <AssistantContent content={message.content} />
          </div>
        )}
        {message.inspection && <AnswerInspection inspection={message.inspection} />}
        {status && status.toolCalls.length > 0 && (status.running || status.toolCalls.some(t => t.status === 'error')) && (
          <LiveSteps toolCalls={status.toolCalls} running={status.running} />
        )}
        {status?.running && !message.content && (
          <div className="flex flex-col gap-2.5 py-1.5" aria-hidden>
            {[88, 74, 52].map((w, i) => (
              <span key={w} className="ld-skel" style={{ width: `${w}%`, animationDelay: `${i * 120}ms` }} />
            ))}
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
