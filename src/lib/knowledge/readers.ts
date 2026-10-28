import JSZip from 'jszip';
import { UnreadableDocumentError, type DocBlock, type ReadResult } from './blocks';
import { markdownToBlocks, plainInline } from './markdown';
import { OcrUnavailableError, ocrImage, ocrPdfPages, type OcrConfig } from './ocr';

// One reader per file type; every reader returns blocks that keep where text came from. PDFs: digital
// pages through pdf-inspector (Markdown with headings and tables, no AI call), pages that need OCR
// through Mistral OCR on Azure in batches. Word through mammoth (headings, paragraphs, lists, tables),
// Excel and CSV row by row with their headers, PowerPoint slide by slide with speaker notes, images
// through Mistral OCR, text and Markdown as they are. The type is decided from the bytes, then the name.

export type ReadOptions = { ocr: OcrConfig | null; fetchImpl?: typeof fetch; maxRows?: number };
export type ReadOutcome = ReadResult & { kind: DocumentKind; warnings: string[] };
export type DocumentKind = 'pdf' | 'docx' | 'xlsx' | 'csv' | 'pptx' | 'image' | 'markdown' | 'text';

const ext = (name: string) => name.toLowerCase().split('.').pop() ?? '';

export async function detectKind(bytes: Uint8Array, name: string): Promise<DocumentKind | null> {
  const head = Array.from(bytes.subarray(0, 8));
  if (String.fromCharCode(...head.slice(0, 5)) === '%PDF-') return 'pdf';
  if (head.join() === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].join()) return 'image';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image';
  if (head[0] === 0x50 && head[1] === 0x4b) {
    // Office files are zip archives; the parts inside say which one it is.
    const zip = await JSZip.loadAsync(bytes).catch(() => null);
    if (zip?.file('word/document.xml')) return 'docx';
    if (zip?.file('xl/workbook.xml')) return 'xlsx';
    if (zip?.file('ppt/presentation.xml')) return 'pptx';
    return null;
  }
  const e = ext(name);
  if (e === 'csv') return 'csv';
  if (e === 'md' || e === 'markdown') return 'markdown';
  if (e === 'txt' || e === 'text') return 'text';
  return null;
}

const decodeUtf8 = (bytes: Uint8Array) => new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');

// ── PDF ─────────────────────────────────────────────────────────────────────────────────────

type Inspector = typeof import('@firecrawl/pdf-inspector');
let inspector: Inspector | null = null;
async function loadInspector(): Promise<Inspector> {
  // Native module; loaded on first use so nothing else pays for it.
  inspector ??= (await import('@firecrawl/pdf-inspector')) as Inspector;
  return inspector;
}

export async function readPdf(bytes: Uint8Array, opts: ReadOptions): Promise<ReadOutcome> {
  const pdf = await loadInspector();
  const buf = Buffer.from(bytes);
  let extraction: Awaited<ReturnType<Inspector['extractPagesMarkdownAsync']>>;
  try {
    extraction = await pdf.extractPagesMarkdownAsync(buf);
  } catch (e) {
    throw new UnreadableDocumentError(`The PDF could not be opened: ${e instanceof Error ? e.message : String(e)}`);
  }
  const pageCount = extraction.pages.length;
  const needOcr = extraction.pages.filter((p) => p.needsOcr || !p.markdown.trim()).map((p) => p.page);
  const warnings: string[] = [];
  const failed = new Set<number>();
  const ocrText = new Map<number, string>();

  if (needOcr.length) {
    if (!opts.ocr) {
      if (needOcr.length === pageCount) throw new OcrUnavailableError();
      needOcr.forEach((p) => failed.add(p));
      warnings.push(`${needOcr.length} scanned page(s) were skipped: no OCR endpoint is configured`);
    } else {
      const res = await ocrPdfPages(bytes, needOcr, pageCount, opts.ocr, opts.fetchImpl);
      res.markdown.forEach((md, p) => ocrText.set(p, md));
      res.failed.forEach((p) => failed.add(p));
      if (res.errors.length) warnings.push(...res.errors.slice(0, 3));
      if (res.failed.length === pageCount) throw new Error(`OCR failed for every page: ${res.errors[0] ?? 'unknown error'}`);
    }
  }

  const blocks: DocBlock[] = [];
  for (const p of extraction.pages) {
    if (failed.has(p.page)) continue;
    const md = ocrText.has(p.page) ? ocrText.get(p.page)! : p.markdown;
    blocks.push(...markdownToBlocks(md, p.page + 1));
  }
  return {
    kind: 'pdf',
    blocks,
    pageCount,
    ocrPages: needOcr.filter((p) => !failed.has(p)).length,
    failedPages: [...failed].sort((a, b) => a - b).map((p) => p + 1),
    warnings,
  };
}

// ── Word ────────────────────────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function htmlText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) =>
      e[0] === '#' ? String.fromCodePoint(e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m),
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/** mammoth's HTML → blocks: headings, paragraphs and list items in order; tables as rows. */
export function docxHtmlToBlocks(html: string): DocBlock[] {
  const blocks: DocBlock[] = [];
  let tableNo = 0;
  for (const part of html.split(/(<table[\s\S]*?<\/table>)/i)) {
    if (/^<table/i.test(part)) {
      tableNo++;
      const rows = [...part.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) => [...r[1]!.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => htmlText(c[1]!)));
      const header = rows[0] ?? [];
      rows.slice(1).forEach((cells, i) => {
        const pairs: [string, string][] = header.map((h, c) => [h || `Column ${c + 1}`, cells[c] ?? '']);
        const kept = pairs.filter(([, v]) => v);
        if (kept.length) blocks.push({ kind: 'row', cells: kept, table: `Table ${tableNo}`, row: i + 1 });
      });
      continue;
    }
    for (const m of part.matchAll(/<(h[1-6]|li|p)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      const text = htmlText(m[2]!);
      if (!text) continue;
      const tag = m[1]!.toLowerCase();
      if (tag[0] === 'h') blocks.push({ kind: 'heading', level: Number(tag[1]), text });
      else blocks.push({ kind: 'text', text: tag === 'li' ? `• ${text}` : text });
    }
  }
  return blocks;
}

export async function readDocx(bytes: Uint8Array): Promise<ReadOutcome> {
  const mammoth = await import('mammoth');
  const { value, messages } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
  const warnings = messages.filter((m) => m.type === 'error').map((m) => m.message).slice(0, 3);
  return { kind: 'docx', blocks: docxHtmlToBlocks(value), ocrPages: 0, failedPages: [], warnings };
}

// ── Spreadsheets ────────────────────────────────────────────────────────────────────────────

const cellText = (v: unknown): string => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim());

/** Rows → blocks: the first non-empty row is the header; each later row becomes header → value pairs. */
export function rowsToBlocks(rows: unknown[][], table: string, maxRows: number, warnings: string[]): DocBlock[] {
  const blocks: DocBlock[] = [];
  const start = rows.findIndex((r) => r.some((c) => cellText(c)));
  if (start < 0) return blocks;
  const header = rows[start]!.map((c, i) => cellText(c) || `Column ${i + 1}`);
  const data = rows.slice(start + 1);
  if (data.length > maxRows) warnings.push(`${table}: only the first ${maxRows} of ${data.length} rows were indexed`);
  data.slice(0, maxRows).forEach((r, i) => {
    const cells = header.map((h, c): [string, string] => [h, cellText(r[c])]).filter(([, v]) => v);
    if (cells.length) blocks.push({ kind: 'row', cells, table, row: start + i + 2 });
  });
  return blocks;
}

export async function readXlsx(bytes: Uint8Array, maxRows: number): Promise<ReadOutcome> {
  const { default: readXlsxFile } = await import('read-excel-file/node');
  const sheets = await readXlsxFile(Buffer.from(bytes));
  const warnings: string[] = [];
  const blocks = sheets.flatMap((s) => rowsToBlocks(s.data as unknown[][], s.sheet, maxRows, warnings));
  return { kind: 'xlsx', blocks, pageCount: sheets.length, ocrPages: 0, failedPages: [], warnings };
}

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows;
}

// ── PowerPoint ──────────────────────────────────────────────────────────────────────────────

const xmlParagraphs = (xml: string) =>
  [...xml.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)]
    .map((p) => [...p[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => htmlText(t[1]!)).join(''))
    .map((s) => s.trim())
    .filter(Boolean);

export async function readPptx(bytes: Uint8Array): Promise<ReadOutcome> {
  const zip = await JSZip.loadAsync(bytes);
  const read = async (path: string) => (await zip.file(path)?.async('string')) ?? '';
  // Slide order is the order in presentation.xml, resolved through its relationships.
  const rels = new Map([...(await read('ppt/_rels/presentation.xml.rels')).matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)].map((m) => [m[1]!, m[2]!]));
  const order = [...(await read('ppt/presentation.xml')).matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)].map((m) => rels.get(m[1]!)).filter((t): t is string => !!t);
  const blocks: DocBlock[] = [];
  for (const [i, target] of order.entries()) {
    const path = `ppt/${target.replace(/^\/?ppt\//, '')}`;
    const lines = xmlParagraphs(await read(path));
    const slideRels = await read(path.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels'));
    const notesTarget = slideRels.match(/Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/)?.[1];
    const notes = notesTarget ? xmlParagraphs(await read(`ppt/notesSlides/${notesTarget}`)).filter((l) => !/^\d+$/.test(l)) : [];
    const text = [...lines, ...(notes.length ? [`Notes: ${notes.join(' ')}`] : [])].join('\n');
    if (text) blocks.push({ kind: 'slide', slide: i + 1, text });
  }
  return { kind: 'pptx', blocks, pageCount: order.length, ocrPages: 0, failedPages: [], warnings: [] };
}

// ── Dispatcher ──────────────────────────────────────────────────────────────────────────────

export async function readDocument(bytes: Uint8Array, name: string, opts: ReadOptions): Promise<ReadOutcome> {
  const kind = await detectKind(bytes, name);
  const maxRows = opts.maxRows ?? 20_000;
  switch (kind) {
    case 'pdf':
      return readPdf(bytes, opts);
    case 'docx':
      return readDocx(bytes);
    case 'xlsx':
      return readXlsx(bytes, maxRows);
    case 'pptx':
      return readPptx(bytes);
    case 'csv': {
      const warnings: string[] = [];
      return { kind, blocks: rowsToBlocks(parseCsv(decodeUtf8(bytes)), name, maxRows, warnings), ocrPages: 0, failedPages: [], warnings };
    }
    case 'markdown':
      return { kind, blocks: markdownToBlocks(decodeUtf8(bytes)), ocrPages: 0, failedPages: [], warnings: [] };
    case 'text':
      return {
        kind,
        blocks: decodeUtf8(bytes)
          .split(/\n\s*\n/)
          .map((p) => plainInline(p))
          .filter(Boolean)
          .map((text) => ({ kind: 'text' as const, text })),
        ocrPages: 0,
        failedPages: [],
        warnings: [],
      };
    case 'image': {
      if (!opts.ocr) throw new OcrUnavailableError();
      const mime = bytes[0] === 0x89 ? 'image/png' : 'image/jpeg';
      const md = await ocrImage(bytes, mime, opts.ocr, opts.fetchImpl);
      const blocks = markdownToBlocks(md, 1);
      return { kind, blocks, pageCount: 1, ocrPages: 1, failedPages: [], warnings: blocks.length ? [] : ['No text was found in the image'] };
    }
    default:
      throw new UnreadableDocumentError(`${name}: only PDF, Word, Excel, CSV, PowerPoint, PNG, JPEG, text and Markdown files can be added`);
  }
}
