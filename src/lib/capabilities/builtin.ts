import { z } from 'zod';
import type { CapabilityDefinition } from './types';
import { EXTRACTION_FIELD_TYPES, MAX_CUSTOM_FIELDS, extractionSchemaNames, resolveExtractionSchema } from '@/lib/extraction/schemas';

// Built-in capability contracts for the first connector set (REST, email, team notification, object
// store, document extraction). Only contracts and simulation mocks live here; live handlers are
// registered separately once a connection type is approved, so nothing in this file can reach a
// real system.

/**
 * Permissions a capability may require. `inspector:use` already exists in rbac.ts. The two
 * `connector:*` keys are proposed and NOT seeded yet, so publishing a flow that writes or sends is
 * blocked until an owner decides who receives them (docs/business-ai-studio/06-connectors-security.md).
 */
export const CAPABILITY_PERMISSIONS = {
  READ: 'inspector:use',
  WRITE: 'connector:write',
  EXTERNAL: 'connector:external',
} as const;

const scalar = z.union([z.string(), z.number(), z.boolean()]);
const s = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

export const httpRequest: CapabilityDefinition = {
  id: 'http.request',
  version: '1.0.0',
  title: 'REST request',
  description: 'Call an operation on a configured REST/OpenAPI connection. The host and credentials come from the connection, never from the flow.',
  provider: 'http',
  tags: ['rest', 'api', 'http', 'openapi', 'webhook', 'integration'],
  sideEffect: 'read',
  risk: 'low',
  approval: 'none',
  requiredPermission: CAPABILITY_PERMISSIONS.READ,
  classify: (input) => {
    const method = typeof input.method === 'string' ? input.method.toUpperCase() : '';
    if (method === 'GET') return {};
    if (method === 'DELETE') return { sideEffect: 'write', risk: 'high', approval: 'required', requiredPermission: CAPABILITY_PERMISSIONS.WRITE };
    return { sideEffect: 'write', risk: 'medium', approval: 'required', requiredPermission: CAPABILITY_PERMISSIONS.WRITE };
  },
  fields: {
    connection: { binding: 'literal', required: true, description: 'Connection id (holds base URL and credentials)' },
    method: { binding: 'literal', required: true, description: 'GET, POST, PUT, PATCH or DELETE' },
    path: { binding: 'data', required: true, egress: 'http_path', description: 'Path relative to the connection base URL' },
    query: { binding: 'data', description: 'Query-string parameters' },
    body: { binding: 'data', description: 'JSON request body' },
  },
  input: z.object({
    connection: z.string().min(1).max(120),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    path: z.string().min(1).max(2000),
    query: z.record(scalar).optional(),
    body: z.unknown().optional(),
  }),
  estimatedCostUsd: 0,
  idempotency: 'key',
  describe: (i) => `${s(i.method)} ${s(i.path)} on connection "${s(i.connection)}"`,
  simulate: (i) => (i.method === 'GET' ? { status: 200, body: {} } : { status: 202, body: { accepted: true } }),
};

export const emailSend: CapabilityDefinition = {
  id: 'email.send',
  version: '1.0.0',
  title: 'Send email',
  description: 'Send an email from the organisation mailbox. Recipients are checked against the tenant domain allowlist on every call.',
  provider: 'email',
  tags: ['email', 'mail', 'send', 'notify', 'supplier', 'follow-up', 'outbound'],
  sideEffect: 'external',
  risk: 'high',
  approval: 'required',
  requiredPermission: CAPABILITY_PERMISSIONS.EXTERNAL,
  fields: {
    to: { binding: 'data', required: true, egress: 'email', description: 'Recipient addresses' },
    subject: { binding: 'data', required: true, description: 'Subject line' },
    body: { binding: 'data', required: true, description: 'Plain-text body' },
  },
  input: z.object({
    to: z.array(z.string().email()).min(1).max(20),
    subject: z.string().min(1).max(200),
    body: z.string().min(1).max(20_000),
  }),
  estimatedCostUsd: 0.0001,
  idempotency: 'key',
  describe: (i) => `Email "${s(i.subject)}" to ${Array.isArray(i.to) ? i.to.join(', ') : s(i.to)}`,
  simulate: (i) => ({ accepted: i.to, messageId: 'simulated' }),
};

export const notifyMessage: CapabilityDefinition = {
  id: 'notify.message',
  version: '1.0.0',
  title: 'Team notification',
  description: 'Post a message to an admin-configured team channel (for example Teams). The channel is fixed in the definition.',
  provider: 'teams',
  tags: ['notify', 'notification', 'teams', 'channel', 'alert', 'message'],
  sideEffect: 'external',
  risk: 'low',
  approval: 'none',
  requiredPermission: CAPABILITY_PERMISSIONS.EXTERNAL,
  fields: {
    channel: { binding: 'literal', required: true, description: 'Configured channel name' },
    text: { binding: 'data', required: true, description: 'Message text' },
  },
  input: z.object({ channel: z.string().min(1).max(120), text: z.string().min(1).max(4000) }),
  estimatedCostUsd: 0,
  idempotency: 'key',
  describe: (i) => `Post to channel "${s(i.channel)}"`,
  simulate: (i) => ({ posted: true, channel: i.channel }),
};

export const objectStoreList: CapabilityDefinition = {
  id: 'object_store.list',
  version: '1.0.0',
  title: 'List stored documents',
  description: 'List object keys under a prefix in a configured object-store connection (for example S3). Read-only.',
  provider: 's3',
  tags: ['s3', 'object', 'storage', 'documents', 'files', 'certificates'],
  sideEffect: 'read',
  risk: 'low',
  approval: 'none',
  requiredPermission: CAPABILITY_PERMISSIONS.READ,
  fields: {
    connection: { binding: 'literal', required: true, description: 'Connection id (bucket and role)' },
    prefix: { binding: 'data', required: true, description: 'Key prefix' },
    maxKeys: { binding: 'literal', description: 'Maximum keys to return (default 1000)' },
  },
  input: z.object({
    connection: z.string().min(1).max(120),
    prefix: z.string().max(1024),
    maxKeys: z.number().int().min(1).max(10_000).optional(),
  }),
  estimatedCostUsd: 0.000005,
  idempotency: 'natural',
  describe: (i) => `List objects under "${s(i.prefix)}" on connection "${s(i.connection)}"`,
  simulate: () => ({ objects: [] }),
};

export const documentExtract: CapabilityDefinition = {
  id: 'document.extract',
  version: '1.0.0',
  title: 'Extract document fields',
  description: 'Extract named fields from a stored document with OCR. Results for an unchanged document can be cached by content hash.',
  provider: 'ocr',
  tags: ['ocr', 'document', 'extract', 'pdf', 'certificate', 'invoice'],
  sideEffect: 'read',
  risk: 'low',
  approval: 'none',
  requiredPermission: CAPABILITY_PERMISSIONS.READ,
  fields: {
    connection: { binding: 'literal', required: true, description: 'Connection (S3, Azure Blob or SharePoint) holding the document' },
    key: { binding: 'data', required: true, description: 'Path of the document inside the connection, e.g. {{item.key}}' },
    schema: { binding: 'literal', description: `A built-in extraction schema: ${extractionSchemaNames().join(' | ')}. Set this OR fields.` },
    fields: {
      binding: 'literal',
      description: `Your own fields instead of a schema: [{ key: snake_case, type: ${EXTRACTION_FIELD_TYPES.join('|')}, description: what to read, label? }], 1–${MAX_CUSTOM_FIELDS}`,
    },
  },
  input: z
    .object({
      connection: z.string().min(1).max(120),
      key: z.string().min(1).max(1024),
      schema: z.string().optional(),
      fields: z.array(z.record(z.unknown())).optional(),
    })
    .superRefine((v, ctx) => {
      const r = resolveExtractionSchema(v);
      if (!r.ok) r.problems.forEach((message) => ctx.addIssue({ code: 'custom', message }));
    }),
  checkLiteral: (i) => {
    const r = resolveExtractionSchema(i);
    return r.ok ? [] : r.problems;
  },
  // Assumption for Grok 4.7 reading a few page images (about 1.5k input tokens a page); replace with measured cost.
  estimatedCostUsd: 0.05,
  idempotency: 'natural',
  describe: (i) =>
    Array.isArray(i.fields) ? `Extract ${i.fields.length} field${i.fields.length === 1 ? '' : 's'} from "${s(i.key)}"` : `Extract "${s(i.schema)}" fields from "${s(i.key)}"`,
  // Same shape as a live extraction (src/lib/extraction/extract.ts), with every field not found.
  simulate: (i) => {
    const r = resolveExtractionSchema(i);
    const keys = Object.keys(r.ok ? r.schema.fields : {});
    return {
      schema: r.ok ? r.schema.name : i.schema,
      documentType: null,
      values: Object.fromEntries(keys.map((k) => [k, null])),
      fields: Object.fromEntries(keys.map((k) => [k, { value: null, page: null, evidence: null }])),
      missing: keys,
    };
  },
};

export const BUILTIN_CAPABILITIES: readonly CapabilityDefinition[] = [
  httpRequest,
  emailSend,
  notifyMessage,
  objectStoreList,
  documentExtract,
];
