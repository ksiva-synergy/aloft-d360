import 'server-only';

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { FabricDefinitionPart } from '@/lib/powerbi/fabric';

type DefinitionKind = 'definitions' | 'report-definitions' | 'report-definitions-legacy';

/** Local or mounted raw store (gitignored `powerbi-estate/` by default). */
export function getPbiRawStoreRoot(): string {
  const fromEnv = process.env.PBI_RAW_STORE_ROOT?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(process.cwd(), 'powerbi-estate');
}

export interface PbiRawS3Config {
  bucket: string;
  prefix: string;
  region: string;
}

/**
 * Optional S3 copy of the raw store, enabled by `PBI_RAW_S3_BUCKET`. Keys mirror the local
 * relative path: `<prefix>/<kind>/<itemId>/<part path>`, so `storage_path` works for both.
 * Credentials come from the default AWS chain (ECS task role on Fargate; `AWS_PROFILE` or
 * `aws login` locally). Nothing here reads keys from `.env`.
 */
export function getPbiRawS3Config(env: NodeJS.ProcessEnv = process.env): PbiRawS3Config | null {
  const bucket = env.PBI_RAW_S3_BUCKET?.trim();
  if (!bucket) return null;
  const prefix = (env.PBI_RAW_S3_PREFIX?.trim() || 'pbi-raw').replace(/^\/+|\/+$/g, '');
  const region = env.PBI_RAW_S3_REGION?.trim() || env.AWS_REGION?.trim() || 'ap-south-1';
  return { bucket, prefix, region };
}

let cachedClient: { region: string; client: S3Client } | null = null;

function s3ClientFor(region: string): S3Client {
  if (!cachedClient || cachedClient.region !== region) {
    cachedClient = { region, client: new S3Client({ region, maxAttempts: 3 }) };
  }
  return cachedClient.client;
}

const S3_CONCURRENCY = 8;
const S3_DELETE_BATCH = 1000;

async function runPool<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(S3_CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await worker(item);
    }
  });
  await Promise.all(lanes);
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function s3FolderPrefix(cfg: PbiRawS3Config, relDir: string): string {
  return `${cfg.prefix}/${toPosix(relDir)}/`;
}

async function listAllKeys(bucket: string, prefix: string, region: string): Promise<string[]> {
  const client = s3ClientFor(region);
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const r = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
    );
    for (const o of r.Contents ?? []) {
      if (o.Key && !o.Key.endsWith('/')) keys.push(o.Key);
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

/**
 * Make the S3 folder for one item match the new download: delete the old objects under its
 * prefix, then upload every new part. Same rule as the local folder wipe.
 */
async function replaceS3Folder(cfg: PbiRawS3Config, relDir: string, parts: FabricDefinitionPart[]): Promise<void> {
  const client = s3ClientFor(cfg.region);
  const prefix = s3FolderPrefix(cfg, relDir);

  const old = await listAllKeys(cfg.bucket, prefix, cfg.region);
  for (let i = 0; i < old.length; i += S3_DELETE_BATCH) {
    const batch = old.slice(i, i + S3_DELETE_BATCH);
    const r = await client.send(
      new DeleteObjectsCommand({
        Bucket: cfg.bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    if (r.Errors?.length) {
      throw new Error(`S3 delete failed for ${r.Errors.length} object(s) under ${prefix}`);
    }
  }

  await runPool(parts, async (part) => {
    await client.send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: prefix + toPosix(part.path),
        Body: Buffer.from(part.payload, 'base64'),
      }),
    );
  });
}

/**
 * Ensure the local folder for one stored item exists. On Fargate the local disk starts empty, so
 * the folder is copied down from S3 when it is missing. Returns true when local files are present.
 */
export async function restorePbiRawFolder(relDir: string): Promise<boolean> {
  const root = getPbiRawStoreRoot();
  const absDir = path.join(root, relDir);
  const hasLocal = fs.existsSync(absDir) && fs.readdirSync(absDir).length > 0;

  const cfg = getPbiRawS3Config();
  if (!cfg || hasLocal) return hasLocal;

  const prefix = s3FolderPrefix(cfg, relDir);
  const keys = await listAllKeys(cfg.bucket, prefix, cfg.region);
  if (keys.length === 0) return false;

  const client = s3ClientFor(cfg.region);
  await runPool(keys, async (key) => {
    const rel = key.slice(prefix.length);
    const segments = rel.split('/');
    if (!rel || segments.includes('..')) return;
    const target = path.join(absDir, ...segments);
    const r = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
    const bytes = (await r.Body?.transformToByteArray()) ?? new Uint8Array();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(bytes));
  });
  return true;
}

export function hashDefinitionParts(parts: FabricDefinitionPart[]): string {
  const h = createHash('sha256');
  for (const part of parts) {
    h.update(part.path);
    h.update('\0');
    h.update(part.payload);
    h.update('\0');
  }
  return h.digest('hex').slice(0, 32);
}

/**
 * Write one downloaded item to the local raw store, and to S3 when `PBI_RAW_S3_BUCKET` is set.
 * Local folder and S3 prefix are both replaced, so a re-download never leaves old parts behind.
 */
export async function writeDefinitionParts(
  kind: DefinitionKind,
  itemId: string,
  parts: FabricDefinitionPart[],
): Promise<{ absDir: string; relativeDir: string; partCount: number; contentHash: string }> {
  const root = getPbiRawStoreRoot();
  const relDir = path.join(kind, itemId);
  const absDir = path.join(root, relDir);

  if (fs.existsSync(absDir)) {
    for (const ent of fs.readdirSync(absDir, { withFileTypes: true })) {
      const p = path.join(absDir, ent.name);
      if (ent.isDirectory()) fs.rmSync(p, { recursive: true, force: true });
      else fs.unlinkSync(p);
    }
  }

  for (const part of parts) {
    const target = path.join(absDir, part.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(part.payload, 'base64'));
  }

  const cfg = getPbiRawS3Config();
  if (cfg) {
    await replaceS3Folder(cfg, toPosix(relDir), parts);
  }

  const contentHash = hashDefinitionParts(parts);
  return {
    absDir,
    relativeDir: toPosix(relDir),
    partCount: parts.length,
    contentHash,
  };
}
