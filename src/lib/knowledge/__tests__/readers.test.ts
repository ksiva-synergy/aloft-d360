/**
 * Knowledge readers on real files built in memory: Word (headings, paragraphs, tables), Excel (rows
 * with headers, several sheets), PowerPoint (slide order, speaker notes), CSV, text and Markdown,
 * PDFs through pdf-inspector, with scanned pages sent to OCR (a fake Mistral endpoint) or skipped.
 */
import { describe, expect, it, vi } from 'vitest';
import { makePdf } from '@/lib/extraction/__tests__/pdf-fixture';
import { detectKind, parseCsv, readDocument } from '../readers';
import { OcrUnavailableError, type OcrConfig } from '../ocr';
import { UnreadableDocumentError } from '../blocks';
import { makeDocx, makePptx, makeXlsx } from './office-fixtures';

const ocr: OcrConfig = { via: 'foundry', endpoint: 'https://foundry.example.com/providers/mistral/azure/ocr', apiKey: 'k', model: 'mistral-ocr-4-0', batchPages: 30, concurrency: 2, timeoutMs: 10_000 };
const noOcr = { ocr: null };

describe('Word', () => {
  it('keeps headings, paragraphs and table rows with their headers', async () => {
    const docx = await makeDocx([
      { heading: 1, text: '4 Emergency procedures' },
      { heading: 2, text: '4.2 Fire' },
      { text: 'Raise the alarm & muster at the station.' },
      { table: [['Drill', 'Interval'], ['Fire', 'Monthly'], ['Abandon ship', 'Monthly']] },
    ]);
    expect(await detectKind(docx, 'sms.docx')).toBe('docx');
    const r = await readDocument(docx, 'sms.docx', noOcr);
    expect(r.blocks).toEqual([
      { kind: 'heading', level: 1, text: '4 Emergency procedures' },
      { kind: 'heading', level: 2, text: '4.2 Fire' },
      { kind: 'text', text: 'Raise the alarm & muster at the station.' },
      { kind: 'row', cells: [['Drill', 'Fire'], ['Interval', 'Monthly']], table: 'Table 1', row: 1 },
      { kind: 'row', cells: [['Drill', 'Abandon ship'], ['Interval', 'Monthly']], table: 'Table 1', row: 2 },
    ]);
  });
});

describe('Excel and CSV', () => {
  it('reads every sheet row by row with the header row', async () => {
    const xlsx = await makeXlsx([
      { name: 'Ports', rows: [['Port', 'Agent', 'Notes'], ['Rotterdam', 'Acme Shipping', 'Pilot 2h before'], ['Singapore', 'Lion Agency', '']] },
      { name: 'Empty', rows: [] },
      { name: 'Rates', rows: [['Rank', 'Daily rate'], ['Master', 450]] },
    ]);
    expect(await detectKind(xlsx, 'x.bin')).toBe('xlsx');
    const r = await readDocument(xlsx, 'ports.xlsx', noOcr);
    expect(r.pageCount).toBe(3);
    expect(r.blocks).toEqual([
      { kind: 'row', cells: [['Port', 'Rotterdam'], ['Agent', 'Acme Shipping'], ['Notes', 'Pilot 2h before']], table: 'Ports', row: 2 },
      { kind: 'row', cells: [['Port', 'Singapore'], ['Agent', 'Lion Agency']], table: 'Ports', row: 3 },
      { kind: 'row', cells: [['Rank', 'Master'], ['Daily rate', '450']], table: 'Rates', row: 2 },
    ]);
  });

  it('caps very large sheets and says so', async () => {
    const xlsx = await makeXlsx([{ name: 'Big', rows: [['N'], ...Array.from({ length: 12 }, (_, i) => [i])] }]);
    const r = await readDocument(xlsx, 'big.xlsx', { ocr: null, maxRows: 10 });
    expect(r.blocks).toHaveLength(10);
    expect(r.warnings).toEqual(['Big: only the first 10 of 12 rows were indexed']);
  });

  it('parses CSV with quotes, commas and line breaks inside fields', async () => {
    expect(parseCsv('a,b\n"x, y","say ""hi""\nthere"\r\n1,2')).toEqual([['a', 'b'], ['x, y', 'say "hi"\nthere'], ['1', '2']]);
    const r = await readDocument(new TextEncoder().encode('﻿Vessel,IMO\nMV Example,9999999\n'), 'fleet.csv', noOcr);
    expect(r.blocks).toEqual([{ kind: 'row', cells: [['Vessel', 'MV Example'], ['IMO', '9999999']], table: 'fleet.csv', row: 2 }]);
  });
});

describe('PowerPoint', () => {
  it('follows the presentation order and adds speaker notes', async () => {
    const pptx = await makePptx([{ lines: ['Second slide'] }, { lines: ['Toolbox talk', 'Hot work permits'], notes: 'Always check gas readings first.' }], [1, 0]);
    const r = await readDocument(pptx, 'talk.pptx', noOcr);
    expect(r.blocks).toEqual([
      { kind: 'slide', slide: 1, text: 'Toolbox talk\nHot work permits\nNotes: Always check gas readings first.' },
      { kind: 'slide', slide: 2, text: 'Second slide' },
    ]);
  });
});

describe('text, Markdown and unsupported files', () => {
  it('reads Markdown structure and plain-text paragraphs', async () => {
    const md = await readDocument(new TextEncoder().encode('# Glossary\n\nROB means **remaining on board**.'), 'glossary.md', noOcr);
    expect(md.blocks).toEqual([{ kind: 'heading', level: 1, text: 'Glossary' }, { kind: 'text', text: 'ROB means remaining on board.' }]);
    const txt = await readDocument(new TextEncoder().encode('First para.\n\nSecond\npara.'), 'notes.txt', noOcr);
    expect(txt.blocks.map((b) => (b as { text: string }).text)).toEqual(['First para.', 'Second para.']);
  });

  it('refuses files it cannot read, by content not name', async () => {
    await expect(readDocument(new TextEncoder().encode('MZ binary'), 'tool.exe', noOcr)).rejects.toBeInstanceOf(UnreadableDocumentError);
    await expect(readDocument(new TextEncoder().encode('not really a pdf'), 'fake.pdf', noOcr)).rejects.toBeInstanceOf(UnreadableDocumentError);
  });
});

describe('PDF', () => {
  it('reads digital pages with pdf-inspector, keeping page numbers, with no OCR call', { timeout: 30_000 }, async () => {
    const fetchImpl = vi.fn();
    const r = await readDocument(makePdf(['Ballast water record\nEntry 12 completed', 'Second page text']), 'bwr.pdf', { ocr, fetchImpl: fetchImpl as never });
    expect(r).toMatchObject({ kind: 'pdf', pageCount: 2, ocrPages: 0, failedPages: [] });
    // pdf-inspector decides headings from font size across the document: a lone line can be a heading.
    const texts = r.blocks.filter((b) => b.kind === 'text' || b.kind === 'heading') as { text: string; page: number }[];
    expect(texts.find((b) => /Ballast water record Entry 12 completed/.test(b.text))!.page).toBe(1);
    expect(texts.find((b) => /Second page text/.test(b.text))!.page).toBe(2);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends only pages without text to OCR and maps their text back to the page', { timeout: 30_000 }, async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ pages: [{ index: 0, markdown: '## Scanned certificate\n\nValid until 2027-03-31' }] }), { status: 200 }));
    const r = await readDocument(makePdf(['Digital page one', '']), 'mixed.pdf', { ocr, fetchImpl: fetchImpl as never });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ pageCount: 2, ocrPages: 1, failedPages: [] });
    expect(r.blocks).toContainEqual({ kind: 'heading', level: 2, text: 'Scanned certificate', page: 2 });
    expect(r.blocks).toContainEqual({ kind: 'text', text: 'Valid until 2027-03-31', page: 2 });
  });

  it('without an OCR endpoint, keeps the digital pages and reports the scanned ones; refuses a fully scanned file', { timeout: 30_000 }, async () => {
    const mixed = await readDocument(makePdf(['Digital page one', '']), 'mixed.pdf', noOcr);
    expect(mixed.failedPages).toEqual([2]);
    expect(mixed.warnings[0]).toMatch(/1 scanned page\(s\) were skipped/);
    await expect(readDocument(makePdf(['', '']), 'scan.pdf', noOcr)).rejects.toBeInstanceOf(OcrUnavailableError);
  });
});
