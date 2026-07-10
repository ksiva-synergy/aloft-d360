'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Maximize2, Minimize2, X, Terminal, ChevronDown, ChevronRight } from 'lucide-react';

interface LogLine {
  ts: number;
  message: string;
}

interface LogsMeta {
  logGroup: string;
  logStream: string;
  taskId: string;
}

interface LogStreamPanelProps {
  jobId: string;
  /** true while job is queued or running */
  isLive: boolean;
  /** collapsed by default for completed jobs */
  defaultCollapsed?: boolean;
}

function formatTs(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function isErrorLine(msg: string): boolean {
  return /\b(ERROR|FATAL|CRITICAL|Exception|Traceback)\b/.test(msg);
}

function isWarnLine(msg: string): boolean {
  return /\b(WARN|WARNING)\b/.test(msg);
}

export default function LogStreamPanel({ jobId, isLive, defaultCollapsed }: LogStreamPanelProps) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [meta, setMeta] = useState<LogsMeta | null>(null);
  const [isDone, setIsDone] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed ?? !isLive);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const bufferRef = useRef('');

  // Auto-scroll to bottom when new lines arrive.
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(isAtBottom);
  }, []);

  const startStreaming = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLines([]);
    setMeta(null);
    setIsDone(false);
    setErrorMsg(null);

    (async () => {
      try {
        const res = await fetch(`/api/agent-lab/context/jobs/${jobId}/logs`, {
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          setErrorMsg(`Failed to connect (${res.status})`);
          return;
        }

        const reader = res.body.getReader();
        readerRef.current = reader;
        const decoder = new TextDecoder();

        const processChunk = (chunk: string) => {
          bufferRef.current += chunk;
          const parts = bufferRef.current.split('\n\n');
          bufferRef.current = parts.pop() ?? '';

          for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed) continue;

            let eventType = 'message';
            let dataStr = '';

            for (const line of trimmed.split('\n')) {
              if (line.startsWith('event: ')) {
                eventType = line.slice(7).trim();
              } else if (line.startsWith('data: ')) {
                dataStr = line.slice(6);
              }
            }

            if (!dataStr) continue;

            try {
              const payload = JSON.parse(dataStr);

              if (eventType === 'done') {
                setIsDone(true);
                return;
              }

              if (eventType === 'error') {
                setErrorMsg(payload.message ?? 'Unknown error');
                return;
              }

              // Default message event
              if (payload.type === 'meta') {
                setMeta({ logGroup: payload.logGroup, logStream: payload.logStream, taskId: payload.taskId });
              } else if (payload.type === 'lines') {
                setLines(prev => [...prev, ...(payload.lines as LogLine[])]);
              } else if (payload.type === 'error') {
                setErrorMsg(payload.message);
              }
            } catch {
              // ignore malformed SSE frames
            }
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            setIsDone(true);
            break;
          }
          processChunk(decoder.decode(value, { stream: true }));
        }
      } catch (err: unknown) {
        if ((err as Error)?.name !== 'AbortError') {
          setErrorMsg((err as Error)?.message ?? 'Stream error');
        }
      }
    })();
  }, [jobId]);

  // Start streaming when not collapsed.
  useEffect(() => {
    if (!isCollapsed) {
      startStreaming();
    }
    return () => {
      abortRef.current?.abort();
    };
  }, [isCollapsed, startStreaming]);

  // If job transitions to live, auto-expand.
  useEffect(() => {
    if (isLive) setIsCollapsed(false);
  }, [isLive]);

  // Escape key exits fullscreen.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) setIsFullscreen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isFullscreen]);

  const logBodyContent = (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto font-mono text-[11px] leading-relaxed"
      style={{ backgroundColor: '#0d1117', minHeight: 0 }}
    >
      {lines.length === 0 && !errorMsg && !isDone && (
        <div className="flex items-center gap-2 px-4 py-3" style={{ color: '#8892A4' }}>
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: '#FDB515' }} />
            <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: '#FDB515' }} />
          </span>
          Waiting for log events…
        </div>
      )}

      {errorMsg && (
        <div className="px-4 py-3 text-red-400">
          <span className="font-bold">Error: </span>{errorMsg}
        </div>
      )}

      {lines.map((line, i) => {
        const isErr = isErrorLine(line.message);
        const isWarn = isWarnLine(line.message);
        return (
          <div
            key={i}
            className="flex gap-3 px-4 py-0.5 hover:bg-white/5 group"
            style={{
              backgroundColor: isErr
                ? 'rgba(239,68,68,0.08)'
                : isWarn
                ? 'rgba(234,179,8,0.06)'
                : i % 2 === 0
                ? 'transparent'
                : 'rgba(255,255,255,0.015)',
            }}
          >
            <span
              className="shrink-0 select-none tabular-nums"
              style={{ color: '#4a5568', minWidth: '7ch' }}
            >
              {formatTs(line.ts)}
            </span>
            <span
              className="flex-1 break-all whitespace-pre-wrap"
              style={{
                color: isErr ? '#fca5a5' : isWarn ? '#fde047' : '#c9d1d9',
              }}
            >
              {line.message.replace(/\n$/, '')}
            </span>
          </div>
        );
      })}

      {isDone && lines.length > 0 && (
        <div
          className="px-4 py-2 text-[10px] font-mono border-t mt-1"
          style={{ color: '#4a5568', borderColor: 'rgba(255,255,255,0.06)' }}
        >
          — stream ended · {lines.length} line{lines.length !== 1 ? 's' : ''} —
        </div>
      )}

      {/* auto-scroll re-engage hint */}
      {!autoScroll && lines.length > 0 && (
        <button
          onClick={() => {
            setAutoScroll(true);
            if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          }}
          className="sticky bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-mono border shadow-lg"
          style={{
            backgroundColor: '#1c2128',
            borderColor: 'rgba(253,181,21,0.3)',
            color: '#FDB515',
          }}
        >
          <ChevronDown size={11} /> Resume scroll
        </button>
      )}
    </div>
  );

  const panelHeader = (fullscreen: boolean) => (
    <div
      className="flex items-center justify-between px-4 py-2.5 border-b shrink-0"
      style={{ backgroundColor: '#161b22', borderColor: 'rgba(255,255,255,0.07)' }}
    >
      <div className="flex items-center gap-2.5">
        <button
          onClick={() => setIsCollapsed(c => !c)}
          className="flex items-center gap-1.5 text-xs font-mono font-semibold tracking-wider uppercase"
          style={{ color: '#8892A4' }}
        >
          {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          <Terminal size={12} />
          Logs
        </button>

        {isLive && !isDone && !isCollapsed && (
          <span className="flex items-center gap-1.5 text-[10px] font-mono" style={{ color: '#FDB515' }}>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: '#FDB515' }} />
              <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: '#FDB515' }} />
            </span>
            streaming
          </span>
        )}

        {isDone && (
          <span className="text-[10px] font-mono" style={{ color: '#4a5568' }}>
            {lines.length} lines
          </span>
        )}

        {meta && !isCollapsed && (
          <span
            className="hidden sm:block text-[9px] font-mono truncate max-w-[200px]"
            style={{ color: '#4a5568' }}
            title={`${meta.logGroup} → ${meta.logStream}`}
          >
            {meta.taskId.slice(-12)}
          </span>
        )}
      </div>

      {!isCollapsed && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsFullscreen(f => !f)}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            style={{ color: '#8892A4' }}
            title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          {fullscreen && (
            <button
              onClick={() => setIsFullscreen(false)}
              className="p-1 rounded hover:bg-white/10 transition-colors ml-1"
              style={{ color: '#8892A4' }}
              title="Close"
            >
              <X size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  );

  // Fullscreen overlay
  if (isFullscreen) {
    return (
      <div
        className="fixed inset-4 z-[60] flex flex-col rounded-xl shadow-2xl overflow-hidden border"
        style={{ backgroundColor: '#0d1117', borderColor: 'rgba(253,181,21,0.2)' }}
      >
        {/* Backdrop */}
        <div
          className="fixed inset-0 -z-10"
          style={{ backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}
          onClick={() => setIsFullscreen(false)}
        />
        {panelHeader(true)}
        {logBodyContent}
      </div>
    );
  }

  // Inline panel
  return (
    <div
      className="rounded-lg overflow-hidden border"
      style={{ borderColor: 'rgba(255,255,255,0.07)', backgroundColor: '#0d1117' }}
    >
      {panelHeader(false)}
      {!isCollapsed && (
        <div style={{ height: '280px', display: 'flex', flexDirection: 'column' }}>
          {logBodyContent}
        </div>
      )}
    </div>
  );
}
