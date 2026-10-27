import { GetObjectCommand, ListObjectsV2Command, S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { FileTooLargeError, fileName, scopedPath, type BrowseResult, type S3Config, type S3Secret, type StorageProvider } from '../types';

// Amazon S3 with an access key, secret and region. No custom endpoint is accepted (types.ts), so
// requests only ever go to AWS. Read-only: list and download objects.

export function s3Provider(config: S3Config, secret: S3Secret, makeClient = (c: S3ClientConfig) => new S3Client(c)): StorageProvider {
  const client = makeClient({
    region: config.region,
    credentials: { accessKeyId: secret.accessKeyId, secretAccessKey: secret.secretAccessKey },
    maxAttempts: 2,
  });
  const root = config.rootFolder;

  return {
    async test() {
      const prefix = root ? `${root}/` : undefined;
      const r = await client.send(new ListObjectsV2Command({ Bucket: config.bucket, Prefix: prefix, MaxKeys: 1 }));
      const where = `s3://${config.bucket}/${prefix ?? ''}`;
      return r.KeyCount ? `Connected to ${where}` : `Connected to ${where} (no objects yet)`;
    },

    async list(path, max): Promise<BrowseResult> {
      const full = scopedPath(root, path);
      const prefix = full ? `${full}/` : '';
      const r = await client.send(new ListObjectsV2Command({ Bucket: config.bucket, Prefix: prefix || undefined, Delimiter: '/', MaxKeys: max }));
      const rel = (key: string) => (root ? key.slice(root.length + 1) : key);
      const folders = (r.CommonPrefixes ?? []).map((p) => {
        const key = p.Prefix!.replace(/\/$/, '');
        return { name: key.split('/').pop()!, path: rel(key), isFolder: true };
      });
      const files = (r.Contents ?? [])
        .filter((o) => o.Key && o.Key !== prefix)
        .map((o) => ({ name: o.Key!.split('/').pop()!, path: rel(o.Key!), isFolder: false, size: o.Size, modified: o.LastModified?.toISOString() }));
      return { path: path.replace(/^\/+|\/+$/g, ''), items: [...folders, ...files], truncated: !!r.IsTruncated };
    },

    async read(path, maxBytes) {
      const key = scopedPath(root, path);
      const r = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
      if ((r.ContentLength ?? 0) > maxBytes) {
        (r.Body as { destroy?: () => void } | undefined)?.destroy?.();
        throw new FileTooLargeError(fileName(key), r.ContentLength!, maxBytes);
      }
      const bytes = (await r.Body?.transformToByteArray()) ?? new Uint8Array();
      return { name: fileName(key), bytes, contentType: r.ContentType };
    },
  };
}
