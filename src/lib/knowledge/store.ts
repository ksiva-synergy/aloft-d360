import 'server-only';

import { readFile } from 'node:fs/promises';
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

// Where a document's original bytes are kept, by storage_ref:
//   s3://bucket/key — uploads, in ALOFT's knowledge bucket (KNOWLEDGE_BUCKET), with the server's AWS role.
//   file:///abs/path — only for the command-line indexing script, and only when
//                      KNOWLEDGE_ALLOW_LOCAL_FILES=1, so the web server can never read local paths.
// Connection-folder files (Phase 3) are read through their storage connection instead.
//
// Bucket layout (decided 2026-10-28; one prefix per feature so the bucket can serve other areas later):
//   <prefix>/<orgId>/<knowledgeBaseId>/<documentId>/v<version>/<file name>
// with prefix "knowledge" by default. One folder per knowledge base and per document; every version
// keeps its own folder, so nothing is overwritten. Objects carry metadata naming their knowledge base,
// document, version, sha256 and uploader, so any file can be traced back from the S3 console.

export class StorageNotConfiguredError extends Error {
  constructor() {
    super('Uploads need the knowledge bucket: set KNOWLEDGE_BUCKET (and KNOWLEDGE_BUCKET_REGION) on the server');
    this.name = 'StorageNotConfiguredError';
  }
}

export type KnowledgeBucket = { bucket: string; region: string; prefix: string };

export function knowledgeBucket(): KnowledgeBucket | null {
  const bucket = process.env.KNOWLEDGE_BUCKET?.trim();
  if (!bucket) return null;
  return {
    bucket,
    region: process.env.KNOWLEDGE_BUCKET_REGION?.trim() || process.env.AWS_REGION?.trim() || 'ap-south-1',
    prefix: (process.env.KNOWLEDGE_BUCKET_PREFIX?.trim() || 'knowledge').replace(/^\/+|\/+$/g, ''),
  };
}

const clients = new Map<string, S3Client>();
function s3(region: string): S3Client {
  let c = clients.get(region);
  if (!c) {
    c = new S3Client({ region });
    clients.set(region, c);
  }
  return c;
}

/** Letters with no accent-free decomposition, common in Nordic and Central European file names. */
const PLAIN_LETTERS: Record<string, string> = { ø: 'o', Ø: 'O', æ: 'ae', Æ: 'AE', ß: 'ss', ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', œ: 'oe', Œ: 'OE', þ: 'th', Þ: 'Th' };

/** Keeps a file name readable in the console and safe as a key: letters, digits, dot, dash, underscore. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base
    .replace(/[øØæÆßłŁđĐœŒþÞ]/g, (c) => PLAIN_LETTERS[c]!)
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  const dot = cleaned.lastIndexOf('.');
  const stem = (dot > 0 ? cleaned.slice(0, dot) : cleaned).slice(0, 100) || 'file';
  const ext = dot > 0 ? cleaned.slice(dot).slice(0, 12) : '';
  return `${stem}${ext}`;
}

export const documentFolder = (b: KnowledgeBucket, orgId: string, knowledgeBaseId: string, documentId: string) =>
  `${b.prefix}/${orgId}/${knowledgeBaseId}/${documentId}`;

export function documentKey(b: KnowledgeBucket, p: { orgId: string; knowledgeBaseId: string; documentId: string; version: number; name: string }): string {
  return `${documentFolder(b, p.orgId, p.knowledgeBaseId, p.documentId)}/v${p.version}/${safeFileName(p.name)}`;
}

export async function putKnowledgeFile(p: {
  orgId: string;
  knowledgeBaseId: string;
  documentId: string;
  version: number;
  name: string;
  bytes: Uint8Array;
  contentType?: string;
  sha256: string;
  uploadedBy: string;
}): Promise<string> {
  const b = knowledgeBucket();
  if (!b) throw new StorageNotConfiguredError();
  const key = documentKey(b, p);
  await s3(b.region).send(
    new PutObjectCommand({
      Bucket: b.bucket,
      Key: key,
      Body: p.bytes,
      ContentType: p.contentType || 'application/octet-stream',
      ServerSideEncryption: 'AES256',
      // S3 metadata values must be ASCII; the original name goes in URL-encoded.
      Metadata: {
        'knowledge-base': p.knowledgeBaseId,
        document: p.documentId,
        version: String(p.version),
        sha256: p.sha256,
        'uploaded-by': p.uploadedBy,
        'original-name': encodeURIComponent(p.name).slice(0, 1024),
      },
    }),
  );
  return `s3://${b.bucket}/${key}`;
}

async function deletePrefix(b: KnowledgeBucket, prefix: string): Promise<number> {
  const client = s3(b.region);
  let removed = 0;
  let token: string | undefined;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: b.bucket, Prefix: prefix, ContinuationToken: token }));
    const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
    if (keys.length) {
      await client.send(new DeleteObjectsCommand({ Bucket: b.bucket, Delete: { Objects: keys, Quiet: true } }));
      removed += keys.length;
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return removed;
}

/** Deletes every object under a document's folder (all its versions). */
export async function deleteDocumentFolder(orgId: string, knowledgeBaseId: string, documentId: string): Promise<number> {
  const b = knowledgeBucket();
  return b ? deletePrefix(b, `${documentFolder(b, orgId, knowledgeBaseId, documentId)}/`) : 0;
}

/** Deletes every object of a knowledge base. */
export async function deleteKnowledgeBaseFolder(orgId: string, knowledgeBaseId: string): Promise<number> {
  const b = knowledgeBucket();
  return b ? deletePrefix(b, `${b.prefix}/${orgId}/${knowledgeBaseId}/`) : 0;
}

export async function readStoredBytes(storageRef: string): Promise<Uint8Array> {
  if (storageRef.startsWith('s3://')) {
    const [, , bucket, ...key] = storageRef.split('/');
    const b = knowledgeBucket();
    const res = await s3(b?.bucket === bucket ? b.region : process.env.AWS_REGION?.trim() || 'ap-south-1').send(new GetObjectCommand({ Bucket: bucket, Key: key.join('/') }));
    return (await res.Body?.transformToByteArray()) ?? new Uint8Array();
  }
  if (storageRef.startsWith('file://')) {
    if (process.env.KNOWLEDGE_ALLOW_LOCAL_FILES !== '1') throw new Error('Local files can only be indexed from the command-line script');
    return new Uint8Array(await readFile(decodeURIComponent(new URL(storageRef).pathname.replace(/^\/([A-Za-z]:)/, '$1'))));
  }
  throw new Error(`Unsupported storage reference "${storageRef.split(':')[0]}"`);
}
