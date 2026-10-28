/**
 * Splitting by structure (sections, numbered clauses, units that are never cut) and Mistral OCR in
 * batches of up to 30 pages (page mapping, parallel batches, a failed batch only failing its pages,
 * retries on rate limits but not on bad requests). The OCR endpoint is a fake.
 */
import { describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { makePdf } from '@/lib/extraction/__tests__/pdf-fixture';
import { markdownToBlocks } from '../markdown';
import { clauseHeading, splitBlocks } from '../split';
import { ocrConfigFromEnv, ocrPdfPages, resolveOcrEndpoint, type OcrConfig } from '../ocr';

describe('markdown', () => {
  it('turns headings, paragraphs, lists and tables into blocks', () => {
    const md = '# SMS\n\n## 4.2 Fire\n\nRaise the **alarm**.\nCall the bridge.\n\n- Close vents\n- Stop fans\n\n| Drill | Interval |\n| --- | --- |\n| Fire | Monthly |\n| Boat |  |\n';
    expect(markdownToBlocks(md, 3)).toEqual([
      { kind: 'heading', level: 1, text: 'SMS', page: 3 },
      { kind: 'heading', level: 2, text: '4.2 Fire', page: 3 },
      { kind: 'text', text: 'Raise the alarm. Call the bridge.', page: 3 },
      { kind: 'text', text: '• Close vents', page: 3 },
      { kind: 'text', text: '• Stop fans', page: 3 },
      { kind: 'row', cells: [['Drill', 'Fire'], ['Interval', 'Monthly']], row: 1, page: 3 },
      { kind: 'row', cells: [['Drill', 'Boat']], row: 2, page: 3 },
    ]);
  });
});

describe('splitBlocks', () => {
  it('keeps sections apart, carries the section path, and never cuts rows, slides or Q&A', () => {
    const chunks = splitBlocks(
      [
        { kind: 'heading', level: 1, text: '4 Emergency' },
        { kind: 'text', text: 'Intro to emergencies.', page: 1 },
        { kind: 'text', text: '4.2 Fire fighting', page: 1 },
        { kind: 'text', text: 'Raise the alarm.', page: 2 },
        { kind: 'text', text: 'Muster at station.', page: 2 },
        { kind: 'row', cells: [['Drill', 'Fire'], ['Interval', 'Monthly']], table: 'Drills', row: 2 },
        { kind: 'heading', level: 1, text: '5 Navigation' },
        { kind: 'qa', question: 'Who signs the log?', answer: 'The OOW.' },
        { kind: 'slide', slide: 3, text: 'Toolbox talk' },
      ],
      { docName: 'SMS' },
    );
    expect(chunks.map((c) => [c.chunkType, c.sectionPath, c.page, c.content])).toEqual([
      ['text', '4 Emergency', 1, 'Intro to emergencies.'],
      ['text', '4 Emergency › 4.2 Fire fighting', 2, 'Raise the alarm.\n\nMuster at station.'],
      ['row', '4 Emergency › 4.2 Fire fighting', null, 'Drills · row 2\nDrill: Fire\nInterval: Monthly'],
      ['qa', '5 Navigation', null, 'Q: Who signs the log?\nA: The OOW.'],
      ['slide', '5 Navigation', 3, 'Slide 3\nToolbox talk'],
    ]);
    expect(chunks[1]!.embedText).toBe('SMS › 4 Emergency › 4.2 Fire fighting\nRaise the alarm.\n\nMuster at station.');
    expect(new Set(chunks.map((c) => c.contentHash)).size).toBe(chunks.length);
  });

  it('packs short paragraphs to the target size and splits a long one at sentence ends', () => {
    const para = (n: number) => ({ kind: 'text' as const, text: `Sentence ${n} of the procedure. `.repeat(10).trim() });
    const packed = splitBlocks([para(1), para(2), para(3), para(4), para(5)], { docName: 'D', targetChars: 700, maxChars: 1400 });
    expect(packed.length).toBe(3);
    expect(packed.every((c) => c.content.length <= 1400)).toBe(true);
    const long = splitBlocks([{ kind: 'text', text: 'One clause sentence here. '.repeat(200).trim() }], { docName: 'D', maxChars: 1000 });
    expect(long.length).toBeGreaterThan(4);
    expect(long.every((c) => c.content.length <= 1000 && /\.$/.test(c.content))).toBe(true);
    expect(long.map((c) => c.content).join(' ').replace(/\s+/g, ' ')).toBe('One clause sentence here. '.repeat(200).trim());
  });

  it('never packs text across pages, so each citation names the right page', () => {
    const chunks = splitBlocks(
      [
        { kind: 'text', text: 'End of page 136.', page: 136 },
        { kind: 'text', text: 'The emergency fire pump is tested every week.', page: 137 },
      ],
      { docName: 'SMS' },
    );
    expect(chunks.map((c) => [c.page, c.content])).toEqual([
      [136, 'End of page 136.'],
      [137, 'The emergency fire pump is tested every week.'],
    ]);
  });

  it('treats only short, capitalised numbered lines as clause headings', () => {
    expect(clauseHeading('4.2.1 Fire detection')).toEqual({ level: 3, text: '4.2.1 Fire detection' });
    expect(clauseHeading('2 crew members attend the drill')).toBeNull();
    expect(clauseHeading('4.2 The master shall ensure that all crew members are familiar with the location of every item of fire equipment.')).toBeNull();
    expect(clauseHeading('3. General:')).toBeNull();
  });
});

describe('Mistral OCR', () => {
  const cfg: OcrConfig = { endpoint: 'https://f.example.com/providers/mistral/azure/ocr', apiKey: 'secret-key', model: 'mistral-ocr-4-0', batchPages: 30, concurrency: 2, timeoutMs: 10_000 };
  const pageCountOf = async (dataUrl: string) => (await PDFDocument.load(Buffer.from(dataUrl.split(',')[1]!, 'base64'))).getPageCount();

  it('splits 65 pages into batches of 30, 30 and 5 and maps text back to the original pages', { timeout: 60_000 }, async () => {
    const pdf = makePdf(Array.from({ length: 65 }, (_, i) => `p${i + 1}`));
    let inFlight = 0;
    let peak = 0;
    const sizes: number[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.model).toBe('mistral-ocr-4-0');
      expect((init.headers as Record<string, string>)['api-key']).toBe('secret-key');
      const n = await pageCountOf(body.document.document_url);
      sizes.push(n);
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return new Response(JSON.stringify({ pages: Array.from({ length: n }, (_, i) => ({ index: i, markdown: `batch page ${i}` })) }), { status: 200 });
    });
    const all = Array.from({ length: 65 }, (_, i) => i);
    const r = await ocrPdfPages(pdf, all, 65, cfg, fetchImpl as never);
    expect(sizes.sort((a, b) => b - a)).toEqual([30, 30, 5]);
    expect(peak).toBe(2);
    expect(r.batches).toBe(3);
    expect(r.markdown.size).toBe(65);
    expect(r.markdown.get(31)).toBe('batch page 1'); // page 32 is the 2nd page of batch 2
    expect(r.failed).toEqual([]);
  });

  it('sends a short, fully scanned file as is, and only the wanted pages otherwise', { timeout: 30_000 }, async () => {
    const pdf = makePdf(['a', 'b', 'c']);
    const docs: string[] = [];
    const fetchImpl = vi.fn(async (_u: string, init: RequestInit) => {
      docs.push(JSON.parse(String(init.body)).document.document_url);
      return new Response(JSON.stringify({ pages: [{ index: 0, markdown: 'x' }] }), { status: 200 });
    });
    await ocrPdfPages(pdf, [0, 1, 2], 3, cfg, fetchImpl as never);
    expect(docs[0]).toBe(`data:application/pdf;base64,${Buffer.from(pdf).toString('base64')}`);
    await ocrPdfPages(pdf, [2], 3, cfg, fetchImpl as never);
    expect(await pageCountOf(docs[1]!)).toBe(1);
  });

  it('retries a rate-limited batch, gives up on a bad request, and fails only that batch’s pages', { timeout: 60_000 }, async () => {
    const pdf = makePdf(Array.from({ length: 4 }, (_, i) => `p${i}`));
    const small = { ...cfg, batchPages: 2, concurrency: 1 };
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      if (call === 1) return new Response('slow down', { status: 429 });
      if (call === 2) return new Response(JSON.stringify({ pages: [{ index: 0, markdown: 'a' }, { index: 1, markdown: 'b' }] }), { status: 200 });
      return new Response('{"error":"document too large"}', { status: 400 });
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const r = await ocrPdfPages(pdf, [0, 1, 2, 3], 4, small, fetchImpl as never);
    vi.useRealTimers();
    expect(fetchImpl).toHaveBeenCalledTimes(3); // 429 retried once; 400 not retried
    expect([...r.markdown.keys()].sort()).toEqual([0, 1]);
    expect(r.failed).toEqual([2, 3]);
    expect(r.errors[0]).toMatch(/Mistral OCR failed \(400\): .*document too large/);
  });

  it('builds the endpoint from either the Foundry base or the deployment URI, and reads its settings from env', () => {
    expect(resolveOcrEndpoint('https://x.services.ai.azure.com/openai/v1/')).toBe('https://x.services.ai.azure.com/providers/mistral/azure/ocr');
    expect(resolveOcrEndpoint('https://x.services.ai.azure.com/providers/mistral/azure/ocr')).toBe('https://x.services.ai.azure.com/providers/mistral/azure/ocr');
    vi.stubEnv('KNOWLEDGE_OCR_ENDPOINT', '');
    vi.stubEnv('KNOWLEDGE_OCR_API_KEY', '');
    vi.stubEnv('FOUNDRY_ENDPOINT', 'https://y.services.ai.azure.com');
    vi.stubEnv('FOUNDRY_API_KEY', 'k');
    vi.stubEnv('KNOWLEDGE_OCR_BATCH_PAGES', '50');
    expect(ocrConfigFromEnv()).toMatchObject({ endpoint: 'https://y.services.ai.azure.com/providers/mistral/azure/ocr', model: 'mistral-ocr-4-0', batchPages: 30, concurrency: 2 });
    vi.stubEnv('FOUNDRY_API_KEY', '');
    expect(ocrConfigFromEnv()).toBeNull();
    vi.unstubAllEnvs();
  });
});
