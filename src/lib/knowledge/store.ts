import 'server-only';

import { readFile } from 'node:fs/promises';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

// Where a document's original bytes are kept, by storage_ref:
//   s3://bucket/key — uploads (Phase 1), with the server's AWS credentials.
//   file:///abs/path — only for the command-line indexing script, and only when
//                      KNOWLEDGE_ALLOW_LOCAL_FILES=1, so the web server can never read local paths.
// Connection-folder files (Phase 3) are read through their storage connection instead.

let s3: S3Client | null = null;

export async function readStoredBytes(storageRef: string): Promise<Uint8Array> {
  if (storageRef.startsWith('s3://')) {
    const [, , bucket, ...key] = storageRef.split('/');
    s3 ??= new S3Client({ region: process.env.KNOWLEDGE_BUCKET_REGION?.trim() || process.env.AWS_REGION?.trim() || 'ap-south-1' });
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key.join('/') }));
    return (await res.Body?.transformToByteArray()) ?? new Uint8Array();
  }
  if (storageRef.startsWith('file://')) {
    if (process.env.KNOWLEDGE_ALLOW_LOCAL_FILES !== '1') throw new Error('Local files can only be indexed from the command-line script');
    return new Uint8Array(await readFile(decodeURIComponent(new URL(storageRef).pathname.replace(/^\/([A-Za-z]:)/, '$1'))));
  }
  throw new Error(`Unsupported storage reference "${storageRef.split(':')[0]}"`);
}
