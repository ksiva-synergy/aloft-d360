/**
 * While a reply streams, avoid rendering markdown tables mid-flight (raw `| row |` lines).
 * Plain prose can stream; once table syntax appears, wait for the formatted render.
 */

export function streamHidesFormattedBody(content: string, running: boolean): boolean {
  if (!running || !content.trim()) return false;
  return content.includes('|');
}

export function streamShowPlainProse(content: string, running: boolean): boolean {
  return running && content.trim().length > 0 && !streamHidesFormattedBody(content, running);
}

/**
 * A reply that is still streaming, split into pieces that are safe to show now:
 * - `prose`: markdown text, rendered formatted as it arrives (unclosed `**` / `` ` `` on the last line trimmed)
 * - `table`: a pipe table; shown as a placeholder until the reply finishes (rendering big tables every
 *   tick froze the page, and half a table is just raw `| … |` lines)
 * - `data`: a fenced code / JSON block, or a reply that is one JSON value; placeholder until finished
 */
export type StreamSegment =
  | { kind: 'prose'; text: string }
  | { kind: 'table'; rows: number }
  | { kind: 'data'; lang: string };

const isTableLine = (line: string) => line.trimStart().startsWith('|');
const isSeparatorLine = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);

/** Drop a dangling inline marker on the text's last line so `**bo` does not flash as raw asterisks. */
function trimOpenInline(text: string): string {
  const nl = text.lastIndexOf('\n');
  const head = text.slice(0, nl + 1);
  let tail = text.slice(nl + 1);
  if ((tail.match(/\*\*/g)?.length ?? 0) % 2 === 1) tail = tail.slice(0, tail.lastIndexOf('**'));
  if ((tail.match(/`/g)?.length ?? 0) % 2 === 1) tail = tail.slice(0, tail.lastIndexOf('`'));
  // A heading or list marker alone ("#", "- ") reads as noise until its text arrives.
  if (/^\s*(#{1,6}|[-*]|\d+\.)\s*$/.test(tail)) tail = '';
  return head + tail;
}

function splitProse(text: string, out: StreamSegment[]) {
  const lines = text.split('\n');
  let buf: string[] = [];
  let i = 0;
  const flush = () => {
    if (buf.join('\n').trim()) out.push({ kind: 'prose', text: buf.join('\n') });
    buf = [];
  };
  while (i < lines.length) {
    if (isTableLine(lines[i])) {
      flush();
      let rows = 0;
      while (i < lines.length && isTableLine(lines[i])) {
        if (!isSeparatorLine(lines[i])) rows += 1;
        i += 1;
      }
      out.push({ kind: 'table', rows: Math.max(0, rows - 1) });
      continue;
    }
    buf.push(lines[i]);
    i += 1;
  }
  flush();
}

export function splitStreamingContent(content: string): StreamSegment[] {
  const trimmed = content.trimStart();
  if (!trimmed) return [];
  // The whole reply is a JSON value (no fences): nothing readable until it is complete.
  if (trimmed[0] === '{' || trimmed[0] === '[') return [{ kind: 'data', lang: 'json' }];

  const out: StreamSegment[] = [];
  const fence = /```(\w+)?[^\n]*\n?/g;
  let pos = 0;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(content)) !== null) {
    splitProse(content.slice(pos, m.index), out);
    const lang = (m[1] || 'text').toLowerCase();
    const close = content.indexOf('```', fence.lastIndex);
    out.push({ kind: 'data', lang });
    if (close < 0) return mergeTrailingProse(out);
    pos = close + 3;
    fence.lastIndex = pos;
  }
  splitProse(content.slice(pos), out);
  return mergeTrailingProse(out);
}

function mergeTrailingProse(out: StreamSegment[]): StreamSegment[] {
  const last = out[out.length - 1];
  if (last?.kind === 'prose') {
    const text = trimOpenInline(last.text.replace(/`{1,2}$/, ''));
    if (text.trim()) out[out.length - 1] = { kind: 'prose', text };
    else out.pop();
  }
  return out;
}

/** Use ResponseLoading instead of partial markdown (empty body or table in progress). */
export function streamAwaitingFormattedReply(content: string, running: boolean): boolean {
  if (!running) return false;
  return !content.trim() || content.includes('|');
}
