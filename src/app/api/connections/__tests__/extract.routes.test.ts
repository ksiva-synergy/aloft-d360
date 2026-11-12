/**
 * POST /api/connections/:id/extract: who may extract, the checks before anything is sent to the
 * model (schema, size, file type), that a real PDF is rendered and all its pages go in one call,
 * and that the audit keeps no extracted values. Prisma, Secrets Manager, the storage provider and
 * the model are fakes; rendering is real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/http';
import { makePdf } from '@/lib/extraction/__tests__/pdf-fixture';

const h = vi.hoisted(() => ({
  resolveAuth: vi.fn(),
  read: vi.fn(),
  vision: vi.fn(),
  audit: vi.fn(),
  rows: new Map<string, Record<string, unknown>>(),
}));

vi.mock('@/middleware/auth', () => ({
  resolveAuth: h.resolveAuth,
  requirePermission: (ctx: { permissions: Set<string> }, key: string) => {
    if (!ctx.permissions.has(key)) throw new ApiError(403, 'Forbidden', { required: key });
  },
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    platformConnection: { findUnique: async ({ where }: { where: { id: string } }) => h.rows.get(where.id) ?? null },
    user: { findMany: async () => [] },
  },
}));
vi.mock('@/lib/audit', () => ({ writeAudit: h.audit }));
vi.mock('@/lib/connections/secrets', () => ({ readConnectionSecret: async () => ({ accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'TOPSECRETVALUE123' }) }));
vi.mock('@/lib/connections/providers/s3', () => ({ s3Provider: () => ({ test: vi.fn(), list: vi.fn(), read: h.read }) }));
vi.mock('@/lib/extraction/extract', async (orig) => ({ ...(await orig<object>()), grokVision: () => h.vision }));

import { POST } from '../[id]/extract/route';

const ana = { userId: 'u-ana', role: 'member', permissions: new Set(['inspector:use', 'section:govern.connections:manage']) };
const ben = { userId: 'u-ben', role: 'member', permissions: new Set(['inspector:use', 'section:govern.connections:manage']) };
const call = (id: string, body: unknown) =>
  POST(new Request(`http://test/api/connections/${id}/extract`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

const row = (over: Record<string, unknown> = {}) => ({
  id: 'c-1', org_id: 'org-1', name: 'Crew docs', kind: 's3', config: { region: 'ap-south-1', bucket: 'crew' }, secret_ref: 'aloft/connections/c-1',
  status: 'ok', last_tested_at: null, last_error: null, created_by: 'u-ana', visibility: 'private', created_at: new Date(), updated_at: new Date(), ...over,
});

beforeEach(() => {
  vi.stubEnv('DEFAULT_ORG_ID', 'org-1');
  h.rows.clear();
  h.rows.set('c-1', row());
  h.resolveAuth.mockReset().mockResolvedValue(ana);
  h.read.mockReset();
  h.audit.mockReset();
  h.vision.mockReset().mockResolvedValue({
    content: JSON.stringify({ document_type: 'Certificate of Competency', fields: { holder_name: { value: 'JOHN SMITH', page: 1, evidence: 'Name: JOHN SMITH' }, expiry_date: { value: '2027-03-31', page: 2, evidence: 'Valid until 31.03.2027' } } }),
    model: 'grok-4.7',
    inputTokens: 2400,
    outputTokens: 180,
  });
});

describe('document extraction API', () => {
  it('renders the PDF, sends all pages in one call and returns checked fields', { timeout: 30_000 }, async () => {
    h.read.mockResolvedValue({ name: 'smith.pdf', bytes: makePdf(['Name: JOHN SMITH', 'Valid until 31.03.2027']), contentType: 'application/pdf' });
    const res = await call('c-1', { path: 'certs/smith.pdf', schema: 'seafarer_certificate' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(h.read).toHaveBeenCalledWith('certs/smith.pdf', 20 * 1048576);
    expect(h.vision).toHaveBeenCalledTimes(1);
    expect(h.vision.mock.calls[0]![0].images).toHaveLength(2);
    expect(data).toMatchObject({
      schema: 'seafarer_certificate',
      values: { holder_name: 'JOHN SMITH', expiry_date: '2027-03-31', certificate_number: null },
      file: { connectionId: 'c-1', path: 'certs/smith.pdf', name: 'smith.pdf' },
      pages: { sent: 2, total: 2, truncated: false },
    });
    // The audit says what was read, never what it said.
    const audited = JSON.stringify(h.audit.mock.calls[0]![0]);
    expect(h.audit.mock.calls[0]![0]).toMatchObject({ action: 'document.extracted', entityId: 'c-1', after: { path: 'certs/smith.pdf', schema: 'seafarer_certificate', missing: expect.any(Number) } });
    expect(audited).not.toContain('JOHN SMITH');
  });

  it('reads the caller’s own fields, typed as asked', { timeout: 30_000 }, async () => {
    h.read.mockResolvedValue({ name: 'report.png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]) });
    h.vision.mockResolvedValue({
      content: JSON.stringify({ document_type: 'PSC inspection report', fields: { vessel_name: { value: 'MV EXAMPLE', page: 1, evidence: 'Ship: MV EXAMPLE' }, deficiencies: { value: '1,204', page: 1, evidence: 'Deficiencies: 1,204' } } }),
      model: 'grok-4.7',
      inputTokens: 900,
      outputTokens: 60,
    });
    const own = [
      { key: 'vessel_name', label: 'Vessel name', type: 'text', description: 'Name of the vessel' },
      { key: 'deficiencies', type: 'number', description: 'Number of deficiencies' },
    ];
    const res = await call('c-1', { path: 'report.png', fields: own });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Object.keys(h.vision.mock.calls[0]![0].jsonSchema.properties.fields.properties)).toEqual(['vessel_name', 'deficiencies']);
    expect(data).toMatchObject({ schema: 'custom', values: { vessel_name: 'MV EXAMPLE', deficiencies: 1204 } });
    expect(h.audit.mock.calls[0]![0].after).toMatchObject({ schema: 'custom', fields: 2 });

    const bad = await call('c-1', { path: 'report.png', fields: [{ key: 'Bad Key', type: 'text', description: 'x' }] });
    expect(bad.status).toBe(422);
    expect((await bad.json()).error).toMatch(/key must be lowercase/);
    expect(h.vision).toHaveBeenCalledTimes(1);
  });

  it('caps the pages sent', { timeout: 30_000 }, async () => {
    vi.stubEnv('EXTRACTION_MAX_PAGES', '2');
    h.read.mockResolvedValue({ name: 'long.pdf', bytes: makePdf(['1', '2', '3', '4']) });
    const data = await (await call('c-1', { path: 'long.pdf', schema: 'seafarer_certificate' })).json();
    expect(data.pages).toEqual({ sent: 2, total: 4, truncated: true });
    expect(h.vision.mock.calls[0]![0].text).toContain('the first 2 of 4 pages');
  });

  it('checks the schema, file type and size before calling the model', async () => {
    expect((await call('c-1', { path: 'a.pdf', schema: 'payslip' })).status).toBe(422);
    h.read.mockResolvedValue({ name: 'a.docx', bytes: new TextEncoder().encode('PK\u0003\u0004 not a pdf') });
    const wrongType = await call('c-1', { path: 'a.docx', schema: 'seafarer_certificate' });
    expect(wrongType.status).toBe(422);
    expect((await wrongType.json()).error).toMatch(/Only PDF, PNG and JPEG/);
    const { FileTooLargeError } = await import('@/lib/connections/types');
    h.read.mockRejectedValue(new FileTooLargeError('big.pdf', 30 * 1048576, 20 * 1048576));
    expect((await call('c-1', { path: 'big.pdf', schema: 'seafarer_certificate' })).status).toBe(413);
    expect((await call('c-1', { path: '../payroll/x.pdf', schema: 'seafarer_certificate' })).status).toBe(400);
    expect(h.vision).not.toHaveBeenCalled();
  });

  it('only for people who may use the connection; storage errors are redacted', async () => {
    h.resolveAuth.mockResolvedValue(ben);
    expect((await call('c-1', { path: 'a.pdf', schema: 'seafarer_certificate' })).status).toBe(404);
    h.rows.set('c-1', row({ visibility: 'org' }));
    h.read.mockRejectedValue(new Error('SignatureDoesNotMatch for key TOPSECRETVALUE123'));
    const res = await call('c-1', { path: 'a.pdf', schema: 'seafarer_certificate' });
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('TOPSECRETVALUE123');
  });

  it('reports a model failure plainly', async () => {
    h.read.mockResolvedValue({ name: 'a.png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]) });
    h.vision.mockRejectedValue(new Error('400 image too small'));
    const res = await call('c-1', { path: 'a.png', schema: 'seafarer_certificate' });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/could not read a\.png: 400 image too small/), details: { code: 'extraction_failed' } });
  });
});
