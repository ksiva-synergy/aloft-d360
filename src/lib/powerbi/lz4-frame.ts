/**
 * LZ4 frame-format decoder (https://github.com/lz4/lz4/blob/dev/doc/lz4_Frame_format.md), used
 * to read Arrow IPC buffers from the Power BI Execute DAX Queries API, which compresses record
 * batches with LZ4_FRAME. Decode only; pure TypeScript, no dependencies. Checksums are skipped
 * (the transport is TLS); block-dependent and independent blocks are both supported because
 * the output buffer keeps the full history.
 */

const MAGIC = 0x184d2204;
const SKIPPABLE_MASK = 0xfffffff0;
const SKIPPABLE_MAGIC = 0x184d2a50;

function u32(b: Uint8Array, o: number): number {
  return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
}

/** Decode one LZ4 block into `out` starting at `pos`; returns the new end position. */
function decodeBlock(src: Uint8Array, start: number, end: number, out: Uint8Array, pos: number): number {
  let i = start;
  let o = pos;
  while (i < end) {
    const token = src[i++]!;
    // literals
    let litLen = token >>> 4;
    if (litLen === 15) {
      let b: number;
      do {
        b = src[i++]!;
        litLen += b;
      } while (b === 255);
    }
    out.set(src.subarray(i, i + litLen), o);
    i += litLen;
    o += litLen;
    if (i >= end) break; // last sequence has literals only
    // match
    const offset = src[i]! | (src[i + 1]! << 8);
    i += 2;
    if (offset === 0) throw new Error('LZ4: invalid match offset 0');
    let matchLen = token & 15;
    if (matchLen === 15) {
      let b: number;
      do {
        b = src[i++]!;
        matchLen += b;
      } while (b === 255);
    }
    matchLen += 4;
    let from = o - offset;
    if (from < 0) throw new Error('LZ4: match offset before output start');
    // byte-by-byte: matches may overlap the bytes they produce
    for (let k = 0; k < matchLen; k++) out[o++] = out[from++]!;
  }
  return o;
}

/**
 * Decompress concatenated LZ4 frames. `sizeHint` (e.g. Arrow's uncompressed length prefix)
 * sizes the output exactly; without it the output grows as needed.
 */
export function lz4FrameDecode(src: Uint8Array, sizeHint?: number): Uint8Array {
  let out = new Uint8Array(Math.max(sizeHint ?? 0, 64));
  let pos = 0;
  const ensure = (extra: number) => {
    if (pos + extra <= out.length) return;
    const next = new Uint8Array(Math.max(out.length * 2, pos + extra));
    next.set(out.subarray(0, pos));
    out = next;
  };

  let i = 0;
  while (i + 4 <= src.length) {
    const magic = u32(src, i);
    i += 4;
    if ((magic & SKIPPABLE_MASK) >>> 0 === SKIPPABLE_MAGIC) {
      i += 4 + u32(src, i);
      continue;
    }
    if (magic !== MAGIC) throw new Error(`LZ4: bad frame magic 0x${magic.toString(16)}`);
    const flg = src[i++]!;
    const bd = src[i++]!;
    if (flg >>> 6 !== 1) throw new Error('LZ4: unsupported frame version');
    const blockChecksum = (flg & 0x10) !== 0;
    const contentSize = (flg & 0x08) !== 0;
    const contentChecksum = (flg & 0x04) !== 0;
    const dictId = (flg & 0x01) !== 0;
    const maxBlock = [0, 0, 0, 0, 1 << 16, 1 << 18, 1 << 20, 1 << 22][(bd >>> 4) & 7] || 1 << 22;
    if (contentSize) i += 8;
    if (dictId) i += 4;
    i += 1; // header checksum

    for (;;) {
      const size = u32(src, i);
      i += 4;
      if (size === 0) break; // end mark
      const uncompressed = (size & 0x80000000) !== 0;
      const len = size & 0x7fffffff;
      if (uncompressed) {
        ensure(len);
        out.set(src.subarray(i, i + len), pos);
        pos += len;
      } else {
        ensure(maxBlock);
        pos = decodeBlock(src, i, i + len, out, pos);
      }
      i += len;
      if (blockChecksum) i += 4;
    }
    if (contentChecksum) i += 4;
  }
  return out.subarray(0, pos);
}
