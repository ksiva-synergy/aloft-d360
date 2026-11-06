import { PDFDocument } from 'pdf-lib';

// Mistral OCR 4, for scanned PDF pages and images in knowledge bases (decision 2026-10-27), through
// ALOFT's own LiteLLM gateway by default or ALOFT's Azure AI Foundry resource. Text and tables come back as Markdown
// per page. Azure accepts at most 30 pages per request, so longer work is split into batches of up
// to 30 pages, a few running at once; each batch retries on its own and a batch that still fails
// only marks its own pages as failed. Page numbers are mapped back to the original document.

export type OcrConfig = {
  /** `litellm`: ALOFT's LiteLLM gateway (`/v1/ocr`); `foundry`: Azure AI Foundry directly. Same request and response shape. */
  via: 'litellm' | 'foundry';
  endpoint: string;
  apiKey: string;
  model: string;
  batchPages: number;
  concurrency: number;
  timeoutMs: number;
};

export class OcrUnavailableError extends Error {
  constructor() {
    super('OCR for scanned pages needs Mistral OCR: configure the LiteLLM gateway (llmlite_base_url, llmlite_api_key), or set KNOWLEDGE_OCR_ENDPOINT and KNOWLEDGE_OCR_API_KEY');
    this.name = 'OcrUnavailableError';
  }
}

const intEnv = (name: string, fallback: number, min: number, max: number) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

/** Accepts the deployment's target URI (…/providers/mistral/azure/ocr) or the Foundry base URL. */
export function resolveOcrEndpoint(raw: string): string {
  const ep = raw.trim().replace(/\/+$/, '');
  if (/\/v1\/ocr$/i.test(ep) || /\/providers\/mistral\/azure\/ocr$/i.test(ep)) return ep;
  return `${ep.replace(/\/openai\/v1$/i, '')}/providers/mistral/azure/ocr`;
}

/** LiteLLM proxies serve OCR at `<base>/v1/ocr`. */
export const liteLlmOcrEndpoint = (base: string) => `${base.trim().replace(/\/+$/, '').replace(/\/v1$/i, '')}/v1/ocr`;

/**
 * Where OCR goes, first match wins:
 *   1. KNOWLEDGE_OCR_ENDPOINT + KNOWLEDGE_OCR_API_KEY (a Foundry endpoint set on purpose);
 *   2. ALOFT's LiteLLM gateway (llmlite_base_url + llmlite_api_key), model azure_ai/mistral-ocr-4-0 —
 *      the default, since calling the Foundry deployment directly returned 503 on 2026-10-28 while
 *      the gateway answered;
 *   3. FOUNDRY_ENDPOINT + FOUNDRY_API_KEY, deployment mistral-ocr-4-0.
 * KNOWLEDGE_OCR_MODEL overrides the model or deployment name in every case.
 */
export function ocrConfigFromEnv(): OcrConfig | null {
  const env = (name: string) => process.env[name]?.trim() || process.env[name.toLowerCase()]?.trim() || '';
  const limits = {
    batchPages: intEnv('KNOWLEDGE_OCR_BATCH_PAGES', 30, 1, 30),
    concurrency: intEnv('KNOWLEDGE_OCR_CONCURRENCY', 2, 1, 8),
    timeoutMs: intEnv('KNOWLEDGE_OCR_TIMEOUT_MS', 180_000, 10_000, 600_000),
  };
  const model = (fallback: string) => env('KNOWLEDGE_OCR_MODEL') || fallback;

  if (env('KNOWLEDGE_OCR_ENDPOINT') && env('KNOWLEDGE_OCR_API_KEY')) {
    return { via: 'foundry', endpoint: resolveOcrEndpoint(env('KNOWLEDGE_OCR_ENDPOINT')), apiKey: env('KNOWLEDGE_OCR_API_KEY'), model: model('mistral-ocr-4-0'), ...limits };
  }
  if (env('LLMLITE_BASE_URL') && env('LLMLITE_API_KEY')) {
    return { via: 'litellm', endpoint: liteLlmOcrEndpoint(env('LLMLITE_BASE_URL')), apiKey: env('LLMLITE_API_KEY'), model: model('azure_ai/mistral-ocr-4-0'), ...limits };
  }
  if (env('FOUNDRY_ENDPOINT') && env('FOUNDRY_API_KEY')) {
    return { via: 'foundry', endpoint: resolveOcrEndpoint(env('FOUNDRY_ENDPOINT')), apiKey: env('FOUNDRY_API_KEY'), model: model('mistral-ocr-4-0'), ...limits };
  }
  return null;
}

type OcrResponse = { pages?: { index?: number; markdown?: string }[] };
type Fetch = typeof fetch;

async function postOcr(cfg: OcrConfig, document: Record<string, string>, fetchImpl: Fetch): Promise<OcrResponse> {
  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetchImpl(cfg.endpoint, {
      method: 'POST',
      // LiteLLM takes a bearer key; Azure Foundry takes `api-key` (and accepts the bearer form too).
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}`, ...(cfg.via === 'foundry' ? { 'api-key': cfg.apiKey } : {}) },
      body: JSON.stringify({ model: cfg.model, document, include_image_base64: false }),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    }).catch((e: unknown) => ({ ok: false, status: 0, text: async () => (e instanceof Error ? e.message : String(e)) }) as Response);
    if (res.ok) return (await res.json()) as OcrResponse;
    lastError = `Mistral OCR failed (${res.status}): ${(await res.text().catch(() => '')).slice(0, 300)}`;
    // Rate limits and server errors are worth another try; a bad request is not.
    if (res.status !== 0 && res.status !== 429 && res.status < 500) break;
    if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 2000));
  }
  throw new Error(lastError);
}

/** Runs tasks with at most `limit` in flight; results keep input order. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

export type OcrPagesResult = {
  /** 0-indexed page → Markdown. */
  markdown: Map<number, string>;
  /** 0-indexed pages whose batch failed after retries. */
  failed: number[];
  batches: number;
  errors: string[];
};

/**
 * OCRs the given 0-indexed pages of a PDF in batches of up to `batchPages`. When every page of a short
 * document needs OCR, the original file is sent as is; otherwise each batch is a new PDF holding just
 * its pages, so digital pages are never sent.
 */
export async function ocrPdfPages(pdf: Uint8Array, pages: number[], pageCount: number, cfg: OcrConfig, fetchImpl: Fetch = fetch): Promise<OcrPagesResult> {
  const wanted = [...new Set(pages)].sort((a, b) => a - b);
  const batches: number[][] = [];
  for (let i = 0; i < wanted.length; i += cfg.batchPages) batches.push(wanted.slice(i, i + cfg.batchPages));
  const whole = wanted.length === pageCount && pageCount <= cfg.batchPages;
  const source = whole ? null : await PDFDocument.load(pdf, { ignoreEncryption: true });

  const markdown = new Map<number, string>();
  const failed: number[] = [];
  const errors: string[] = [];
  await pool(batches, cfg.concurrency, async (batch) => {
    try {
      let bytes = pdf;
      if (source) {
        const sub = await PDFDocument.create();
        for (const p of await sub.copyPages(source, batch)) sub.addPage(p);
        bytes = await sub.save();
      }
      const res = await postOcr(cfg, { type: 'document_url', document_url: `data:application/pdf;base64,${Buffer.from(bytes).toString('base64')}` }, fetchImpl);
      // Response pages are 0-indexed within the batch; map them back to the original page numbers.
      (res.pages ?? []).forEach((p, i) => {
        const original = batch[p.index ?? i];
        if (original !== undefined) markdown.set(original, p.markdown ?? '');
      });
      for (const p of batch) if (!markdown.has(p)) markdown.set(p, '');
    } catch (e) {
      failed.push(...batch);
      errors.push(e instanceof Error ? e.message : String(e));
    }
  });
  return { markdown, failed: failed.sort((a, b) => a - b), batches: batches.length, errors };
}

export async function ocrImage(bytes: Uint8Array, mime: string, cfg: OcrConfig, fetchImpl: Fetch = fetch): Promise<string> {
  const res = await postOcr(cfg, { type: 'image_url', image_url: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}` }, fetchImpl);
  return (res.pages ?? []).map((p) => p.markdown ?? '').join('\n\n');
}
