'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * One follow-up message held while a reply streams.
 *
 * - `submit(text)` sends when the chat is idle, otherwise queues. Sending again before the
 *   reply ends adds to the same queued message (one new line per send), so there is never a
 *   backlog of answers to stale questions. Repeating the question being answered, or the last
 *   queued line, is ignored: clicking Send or a prompt several times while the reply looks
 *   stuck must not ask the same thing several times.
 * - When the reply finishes, the queued message sends by itself. If the reply failed, it goes
 *   back into the composer instead, so the person decides.
 * - `sendNow(extra?)` stops the reply and sends the queued text (plus `extra`) right away.
 * - `stop()` is the Stop button: it stops the reply and returns the queued text to the
 *   composer. Stop means "pause", not "go ahead".
 * - `takeBack()` returns the queued text to the composer (Edit), `discard()` drops it.
 *
 * `send` and `stop` are the chat's own functions. `send` may return false when it refused
 * (a reply is already starting); the text is then queued. `restoreDraft` puts text back in the
 * composer.
 */
export function useQueuedSend({
  isStreaming,
  isBusy,
  hasError,
  send,
  stop,
  restoreDraft,
  resetKey,
}: {
  isStreaming: boolean;
  /** Live busy check (not the last render), so two clicks in one frame are both caught. */
  isBusy?: () => boolean;
  /** True when the reply that just ended failed. Read when streaming stops. */
  hasError: boolean;
  send: (text: string) => boolean | void;
  stop: () => void;
  restoreDraft: (text: string) => void;
  /** Chat or session id. When it changes (new chat, other chat), the queue returns to the composer. */
  resetKey?: string | null;
}) {
  const [queued, setQueued] = useState<string | null>(null);
  const queuedRef = useRef<string | null>(null);
  /** The question the running (or starting) reply answers. */
  const inFlightText = useRef<string | null>(null);
  const latest = useRef({ send, stop, restoreDraft, hasError, isBusy, isStreaming });
  // Before the effects below and before any click handler sees this render.
  useLayoutEffect(() => {
    latest.current = { send, stop, restoreDraft, hasError, isBusy, isStreaming };
  });

  const set = useCallback((next: string | null) => {
    queuedRef.current = next;
    setQueued(next);
  }, []);

  const take = useCallback((): string | null => {
    const text = queuedRef.current;
    set(null);
    return text;
  }, [set]);

  const dispatch = useCallback((text: string): boolean => {
    const accepted = latest.current.send(text) !== false;
    if (accepted) inFlightText.current = text;
    return accepted;
  }, []);

  const queue = useCallback((text: string) => {
    const t = text.trim();
    if (!t || t === inFlightText.current) return;
    const current = queuedRef.current;
    if (current && current.split('\n').at(-1)?.trim() === t) return;
    set(current ? `${current}\n${t}` : t);
  }, [set]);

  const submit = useCallback((text: string) => {
    const t = text.trim();
    if (!t) return;
    const { isBusy: busyNow, isStreaming: streaming } = latest.current;
    const busy = busyNow ? busyNow() : streaming;
    if (!busy && dispatch(t)) return;
    queue(t);
  }, [dispatch, queue]);

  const sendNow = useCallback((extra?: string) => {
    const parts = [take(), extra?.trim()].filter((p): p is string => !!p);
    if (parts.length === 0) return;
    latest.current.stop();
    dispatch(parts.join('\n'));
  }, [take, dispatch]);

  const stopReply = useCallback(() => {
    const text = take();
    latest.current.stop();
    if (text) latest.current.restoreDraft(text);
  }, [take]);

  const takeBack = useCallback(() => {
    const text = take();
    if (text) latest.current.restoreDraft(text);
  }, [take]);

  const discard = useCallback(() => { set(null); }, [set]);

  // The reply ended: send what is queued, or hand it back if the reply failed.
  const wasStreaming = useRef(isStreaming);
  useEffect(() => {
    const ended = wasStreaming.current && !isStreaming;
    wasStreaming.current = isStreaming;
    if (!ended) return;
    inFlightText.current = null;
    const text = take();
    if (!text) return;
    if (latest.current.hasError) latest.current.restoreDraft(text);
    else if (!dispatch(text)) set(text);
  }, [isStreaming, take, dispatch, set]);

  // New chat or another chat opened: the queued text belongs to the old one.
  const lastKey = useRef(resetKey);
  useEffect(() => {
    if (lastKey.current === resetKey) return;
    const previous = lastKey.current;
    lastKey.current = resetKey;
    // A new chat getting its id on the first send is the same conversation.
    if (previous == null) return;
    inFlightText.current = null;
    const text = take();
    if (text) latest.current.restoreDraft(text);
  }, [resetKey, take]);

  return { queued, submit, queue, sendNow, stop: stopReply, takeBack, discard };
}

/** Put queued text back in front of whatever the person has typed since. */
export function mergeIntoDraft(current: string, restored: string): string {
  return current.trim() ? `${restored}\n${current}` : restored;
}
