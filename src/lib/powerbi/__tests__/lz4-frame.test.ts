import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { lz4FrameDecode } from '@/lib/powerbi/lz4-frame';

import fixtures from './fixtures/lz4-frames.json';

// Frames produced by pyarrow's LZ4 codec (the same LZ4_FRAME format Power BI's Arrow stream uses).
describe('LZ4 frame decoder', () => {
  for (const [name, c] of Object.entries(fixtures as Record<string, { len: number; sha256: string; lz4_b64: string }>)) {
    it(`restores the ${name} frame byte for byte`, () => {
      const src = new Uint8Array(Buffer.from(c.lz4_b64, 'base64'));
      const out = lz4FrameDecode(src, c.len);
      expect(out.length).toBe(c.len);
      expect(createHash('sha256').update(out).digest('hex')).toBe(c.sha256);
      expect(lz4FrameDecode(src).length).toBe(c.len); // without a size hint too
    });
  }

  it('rejects data that is not an LZ4 frame', () => {
    expect(() => lz4FrameDecode(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/magic/);
  });
});
