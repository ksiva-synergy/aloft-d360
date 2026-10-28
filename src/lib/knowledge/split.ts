import { createHash } from 'node:crypto';
import type { DocBlock } from './blocks';

// Structure-aware splitting: blocks → chunks that each hold one meaningful unit, with the section
// they sit in. Text under the same heading on the same page is packed up to a target size and never
// runs across a heading or a page; table rows, slides, Q&A pairs and images are always their own chunk. A numbered clause on
// its own line ("4.2 Fire fighting") starts a section, as manuals and the SMS are written that way.
// Replaces the fixed 2,000-character cut in chunker.ts, which splits clauses in half.

export type KnowledgeChunk = {
  index: number;
  content: string;
  /** "4 Emergency › 4.2 Fire" — the headings above this chunk. */
  sectionPath: string | null;
  page: number | null;
  chunkType: 'text' | 'row' | 'slide' | 'qa' | 'image';
  /** What is embedded: document name and section path in front of the content, for better matches. */
  embedText: string;
  contentHash: string;
};

export type SplitOptions = { docName: string; targetChars?: number; maxChars?: number };

// Number, then a capitalised title: "4.2 Fire fighting", not "2 crew members attend".
const CLAUSE = /^(\d{1,3}(?:\.\d{1,3}){0,5})\.?\s+([A-Z].{1,90})$/;

/** A short line like "4.2.1 Fire detection" is a numbered clause heading; its depth is its level. */
export function clauseHeading(text: string): { level: number; text: string } | null {
  if (text.length > 100 || /[.;:,]$/.test(text)) return null;
  const m = text.match(CLAUSE);
  if (!m) return null;
  return { level: Math.min(6, m[1]!.split('.').length), text };
}

/** Splits an over-long text at sentence ends, falling back to spaces, without losing anything. */
function splitLong(text: string, max: number): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('; '), window.lastIndexOf('\n'));
    const at = cut > max * 0.5 ? cut + 1 : window.lastIndexOf(' ') > max * 0.5 ? window.lastIndexOf(' ') : max;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function splitBlocks(blocks: DocBlock[], opts: SplitOptions): KnowledgeChunk[] {
  const target = opts.targetChars ?? 1200;
  const max = opts.maxChars ?? 2400;
  const chunks: KnowledgeChunk[] = [];
  const headings: { level: number; text: string }[] = [];
  const path = () => (headings.length ? headings.map((h) => h.text).join(' › ') : null);

  let buffer: string[] = [];
  let bufferPage: number | null = null;
  const push = (content: string, chunkType: KnowledgeChunk['chunkType'], page: number | null) => {
    const sectionPath = path();
    chunks.push({
      index: chunks.length,
      content,
      sectionPath,
      page,
      chunkType,
      embedText: `${opts.docName}${sectionPath ? ` › ${sectionPath}` : ''}\n${content}`,
      contentHash: sha256(`${sectionPath ?? ''}\n${content}`),
    });
  };
  const flush = () => {
    const text = buffer.join('\n\n').trim();
    if (text) for (const part of text.length > max ? splitLong(text, max) : [text]) push(part, 'text', bufferPage);
    buffer = [];
    bufferPage = null;
  };
  const enter = (level: number, text: string) => {
    flush();
    while (headings.length && headings[headings.length - 1]!.level >= level) headings.pop();
    headings.push({ level, text });
  };

  for (const b of blocks) {
    switch (b.kind) {
      case 'heading':
        enter(b.level, b.text);
        break;
      case 'text': {
        const clause = clauseHeading(b.text);
        if (clause) {
          enter(clause.level, clause.text);
          break;
        }
        // Never pack across a page boundary: a citation names one page, and it must be the right one.
        if (buffer.length && (buffer.join('\n\n').length + b.text.length > target || (b.page ?? null) !== bufferPage)) flush();
        if (bufferPage === null) bufferPage = b.page ?? null;
        buffer.push(b.text);
        break;
      }
      case 'row':
        flush();
        push(
          `${b.table ? `${b.table}${b.row ? ` · row ${b.row}` : ''}\n` : ''}${b.cells.map(([k, v]) => `${k}: ${v}`).join('\n')}`,
          'row',
          b.page ?? null,
        );
        break;
      case 'slide':
        flush();
        if (b.text.trim()) for (const part of splitLong(`Slide ${b.slide}\n${b.text.trim()}`, max)) push(part, 'slide', b.slide);
        break;
      case 'qa':
        flush();
        push(`Q: ${b.question.trim()}\nA: ${b.answer.trim()}`, 'qa', null);
        break;
      case 'image':
        flush();
        if (b.text.trim()) for (const part of splitLong(b.text.trim(), max)) push(part, 'image', 1);
        break;
    }
  }
  flush();
  return chunks;
}
