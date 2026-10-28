import type { DocBlock } from './blocks';

// Markdown → blocks. pdf-inspector (digital PDFs) and Mistral OCR (scans, images) both return
// Markdown, so this one parser gives every PDF the same structure: headings, paragraphs and list
// items as text, and each pipe-table row as its own row block with the header repeated.

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** Markdown inline formatting removed; text kept. */
export function plainInline(s: string): string {
  return s
    .replace(/!\[[^\]]*]\([^)]*\)/g, '') // images
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1') // links → text
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(\S.*?\S|\S)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<!--.*?-->/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => plainInline(c));

export function markdownToBlocks(markdown: string, page?: number): DocBlock[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: DocBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    const text = plainInline(para.join(' '));
    if (text) blocks.push({ kind: 'text', text, ...(page ? { page } : {}) });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const h = line.match(HEADING);
    if (h) {
      flush();
      const text = plainInline(h[2]!);
      if (text) blocks.push({ kind: 'heading', level: h[1]!.length, text, ...(page ? { page } : {}) });
      continue;
    }
    // A pipe table: header row, separator row, then data rows.
    if (line.includes('|') && TABLE_SEPARATOR.test(lines[i + 1] ?? '')) {
      flush();
      const header = splitRow(line);
      let rowNo = 0;
      for (i += 2; i < lines.length && lines[i]!.includes('|') && lines[i]!.trim(); i++) {
        const cells = splitRow(lines[i]!);
        const pairs: [string, string][] = header.map((hd, c) => [hd || `Column ${c + 1}`, cells[c] ?? '']);
        if (pairs.some(([, v]) => v)) blocks.push({ kind: 'row', cells: pairs.filter(([, v]) => v), row: ++rowNo, ...(page ? { page } : {}) });
      }
      i--;
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    // List items start their own paragraph so a list is not glued into one run-on line.
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line) && para.length) flush();
    para.push(line.replace(/^\s*[-*+]\s+/, '• '));
  }
  flush();
  return blocks;
}
