import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@aws-sdk/client-s3', () => {
  class Cmd {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  class ListObjectsV2Command extends Cmd {}
  class DeleteObjectsCommand extends Cmd {}
  class PutObjectCommand extends Cmd {}
  class GetObjectCommand extends Cmd {}
  class S3Client {
    send(cmd: Cmd) {
      return mockSend(cmd);
    }
  }
  return { S3Client, ListObjectsV2Command, DeleteObjectsCommand, PutObjectCommand, GetObjectCommand };
});

import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { restorePbiRawFolder, writeDefinitionParts, getPbiRawS3Config } from '@/lib/powerbi/raw-store';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const PARTS = [
  { path: 'database.tmdl', payload: b64('database') },
  { path: 'tables/Fact/Fact.tmdl', payload: b64('table') },
];

let root: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pbi-raw-s3-'));
  process.env.PBI_RAW_STORE_ROOT = root;
  delete process.env.PBI_RAW_S3_BUCKET;
  delete process.env.PBI_RAW_S3_PREFIX;
  mockSend.mockReset();
});

afterEach(() => {
  process.env = { ...savedEnv };
  fs.rmSync(root, { recursive: true, force: true });
});

describe('getPbiRawS3Config', () => {
  it('is off unless PBI_RAW_S3_BUCKET is set', () => {
    expect(getPbiRawS3Config({})).toBeNull();
  });

  it('uses pbi-raw prefix and AWS_REGION by default', () => {
    expect(getPbiRawS3Config({ PBI_RAW_S3_BUCKET: 'b', AWS_REGION: 'ap-south-1' })).toEqual({
      bucket: 'b',
      prefix: 'pbi-raw',
      region: 'ap-south-1',
    });
  });
});

describe('writeDefinitionParts', () => {
  it('writes local files only when no bucket is configured', async () => {
    const out = await writeDefinitionParts('definitions', 'm1', PARTS);
    expect(out.relativeDir).toBe('definitions/m1');
    expect(fs.readFileSync(path.join(root, 'definitions', 'm1', 'database.tmdl'), 'utf8')).toBe('database');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('replaces the S3 folder: deletes old keys, then uploads each part under the same key layout', async () => {
    process.env.PBI_RAW_S3_BUCKET = 'aloft-pbi-raw-dev';
    mockSend.mockImplementation(async (cmd: unknown) => {
      if (cmd instanceof ListObjectsV2Command) {
        return { Contents: [{ Key: 'pbi-raw/definitions/m1/old.tmdl' }], IsTruncated: false };
      }
      if (cmd instanceof DeleteObjectsCommand) return { Errors: [] };
      return {};
    });

    await writeDefinitionParts('definitions', 'm1', PARTS);

    const deletes = mockSend.mock.calls.map((c) => c[0]).filter((c) => c instanceof DeleteObjectsCommand);
    expect(deletes).toHaveLength(1);
    expect(deletes[0].input).toMatchObject({
      Bucket: 'aloft-pbi-raw-dev',
      Delete: { Objects: [{ Key: 'pbi-raw/definitions/m1/old.tmdl' }], Quiet: true },
    });

    const puts = mockSend.mock.calls.map((c) => c[0]).filter((c) => c instanceof PutObjectCommand);
    const keys = puts.map((p) => p.input.Key).sort();
    expect(keys).toEqual(['pbi-raw/definitions/m1/database.tmdl', 'pbi-raw/definitions/m1/tables/Fact/Fact.tmdl']);
    const body = puts.find((p) => p.input.Key === 'pbi-raw/definitions/m1/database.tmdl')!.input.Body as Buffer;
    expect(body.toString('utf8')).toBe('database');
  });

  it('throws when S3 reports delete errors, so the caller marks the item failed', async () => {
    process.env.PBI_RAW_S3_BUCKET = 'aloft-pbi-raw-dev';
    mockSend.mockImplementation(async (cmd: unknown) => {
      if (cmd instanceof ListObjectsV2Command) return { Contents: [{ Key: 'pbi-raw/definitions/m1/x' }], IsTruncated: false };
      if (cmd instanceof DeleteObjectsCommand) return { Errors: [{ Key: 'x', Code: 'AccessDenied' }] };
      return {};
    });
    await expect(writeDefinitionParts('definitions', 'm1', PARTS)).rejects.toThrow(/S3 delete failed/);
  });
});

describe('restorePbiRawFolder', () => {
  it('is a no-op when local files already exist', async () => {
    process.env.PBI_RAW_S3_BUCKET = 'aloft-pbi-raw-dev';
    fs.mkdirSync(path.join(root, 'definitions', 'm1'), { recursive: true });
    fs.writeFileSync(path.join(root, 'definitions', 'm1', 'database.tmdl'), 'local');
    expect(await restorePbiRawFolder('definitions/m1')).toBe(true);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('downloads the S3 folder into the local store when local is missing (Fargate case)', async () => {
    process.env.PBI_RAW_S3_BUCKET = 'aloft-pbi-raw-dev';
    mockSend.mockImplementation(async (cmd: unknown) => {
      if (cmd instanceof ListObjectsV2Command) {
        return {
          Contents: [
            { Key: 'pbi-raw/definitions/m1/' },
            { Key: 'pbi-raw/definitions/m1/database.tmdl' },
            { Key: 'pbi-raw/definitions/m1/tables/Fact/Fact.tmdl' },
          ],
          IsTruncated: false,
        };
      }
      if (cmd instanceof GetObjectCommand) {
        const key = cmd.input.Key as string;
        const text = key.endsWith('database.tmdl') ? 'database' : 'table';
        return { Body: { transformToByteArray: async () => new Uint8Array(Buffer.from(text)) } };
      }
      return {};
    });

    expect(await restorePbiRawFolder('definitions/m1')).toBe(true);
    expect(fs.readFileSync(path.join(root, 'definitions', 'm1', 'database.tmdl'), 'utf8')).toBe('database');
    expect(fs.readFileSync(path.join(root, 'definitions', 'm1', 'tables', 'Fact', 'Fact.tmdl'), 'utf8')).toBe('table');
  });

  it('returns false when neither local nor S3 has the item', async () => {
    process.env.PBI_RAW_S3_BUCKET = 'aloft-pbi-raw-dev';
    mockSend.mockResolvedValue({ Contents: [], IsTruncated: false });
    expect(await restorePbiRawFolder('definitions/missing')).toBe(false);
  });
});
