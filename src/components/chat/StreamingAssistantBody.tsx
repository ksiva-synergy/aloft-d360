'use client';

import { memo, useMemo } from 'react';
import { Braces, Table2 } from 'lucide-react';
import { AssistantContent } from '@/components/chat/AssistantContent';
import { splitStreamingContent, type StreamSegment } from '@/lib/chat/streaming-body';

/** Earlier prose blocks keep their text while later ones stream, so memo skips re-parsing them. */
const ProseBlock = memo(function ProseBlock({ text }: { text: string }) {
  return <AssistantContent content={text} />;
});

function PendingBlock({ segment }: { segment: Extract<StreamSegment, { kind: 'table' | 'data' }> }) {
  const isTable = segment.kind === 'table';
  const Icon = isTable ? Table2 : Braces;
  const label = isTable
    ? segment.rows > 0 ? `Building table · ${segment.rows} ${segment.rows === 1 ? 'row' : 'rows'}` : 'Building table…'
    : segment.lang === 'json' ? 'Preparing data…' : 'Writing code…';
  return (
    <div
      role="status"
      aria-label={label}
      className="my-3 w-full overflow-hidden rounded-xl border border-[var(--line-1)] bg-[var(--surface-1)] animate-in fade-in duration-300 motion-reduce:animate-none"
    >
      <div className="flex items-center gap-2 border-b border-[var(--line-1)] px-3 py-2 text-size-ui font-medium text-[var(--ink-3)]">
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
      </div>
      <div className="space-y-2 px-3 py-3" aria-hidden>
        {[92, 78, 85].map((w, i) => (
          <div
            key={i}
            className="h-2.5 animate-pulse rounded-full bg-[var(--surface-2)] motion-reduce:animate-none"
            style={{ width: `${w}%`, animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Agent reply while it streams: prose renders formatted (no raw `**`, `#`, `-`), each new block fades in,
 * and tables / JSON / code show a placeholder card until the reply finishes and the real render takes over.
 */
export function StreamingAssistantBody({ content }: { content: string }) {
  const segments = useMemo(() => splitStreamingContent(content), [content]);
  return (
    <>
      {segments.map((segment, i) =>
        segment.kind === 'prose' ? (
          <div key={`p-${i}`} className="animate-in fade-in duration-300 motion-reduce:animate-none">
            <ProseBlock text={segment.text} />
          </div>
        ) : (
          <PendingBlock key={`${segment.kind}-${i}`} segment={segment} />
        ),
      )}
    </>
  );
}
