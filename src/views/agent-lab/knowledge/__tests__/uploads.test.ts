/**
 * The browser side of uploads: what is refused before sending (and why, in words people act on),
 * junk files dropped silently, folders kept from "Choose a folder" and from dropped folders, what
 * each server answer means for the row, and that the queue runs two at a time in order.
 */
import { describe, expect, it } from 'vitest';
import { filesFromDrop, folderOf, isJunk, precheck, settle, toItems, uploadLanes } from '../uploads';

const file = (name: string, size = 10) => new File([new Uint8Array(size)], name);

describe('before sending', () => {
  it('refuses old Office formats, unknown types, empty and oversized files with a plain reason', () => {
    expect(precheck(file('Manual.doc'), 50)).toBe('Old DOC format: save it as .docx and add it again');
    expect(precheck(file('setup.exe'), 50)).toBe('This type of file cannot be added');
    expect(precheck(file('empty.pdf', 0), 50)).toBe('The file is empty');
    expect(precheck({ name: 'huge.pdf', size: 60 * 1048576 }, 50)).toBe('60.0 MB; the limit is 50 MB');
    expect(precheck(file('Scan 001.JPG'), 50)).toBeNull();
    expect(precheck(file('notes.md'), 50)).toBeNull();
  });

  it('drops files the system leaves behind and keeps the folder of each file', () => {
    expect(['.DS_Store', '~$Manual.docx', 'Thumbs.db', 'desktop.ini'].every(isJunk)).toBe(true);
    expect(isJunk('Manual.docx')).toBe(false);
    expect(folderOf('SMS/Chapter 3/Fire.pdf')).toBe('SMS/Chapter 3');
    expect(folderOf('Fire.pdf')).toBe('');
    const items = toItems(
      [
        { file: file('A.pdf'), folder: 'SMS' },
        { file: file('~$A.docx'), folder: 'SMS' },
        { file: file('B.ppt'), folder: '' },
      ],
      50,
      { n: 0 },
    );
    expect(items.map((i) => [i.file.name, i.folder, i.state])).toEqual([
      ['A.pdf', 'SMS', 'waiting'],
      ['B.ppt', '', 'skipped'],
    ]);
  });
});

describe('reading a drop', () => {
  it('walks into dropped folders, reading every batch, and keeps their paths', async () => {
    const leaf = (name: string) => ({ isFile: true, isDirectory: false, name, file: (ok: (f: File) => void) => ok(file(name)) });
    const dir = (name: string, children: object[]) => {
      const batches = [children.slice(0, 1), children.slice(1), []];
      return { isFile: false, isDirectory: true, name, createReader: () => ({ readEntries: (ok: (e: object[]) => void) => ok(batches.shift() ?? []) }) };
    };
    const tree = dir('SMS', [leaf('Index.pdf'), dir('Chapter 2', [leaf('Fire.pdf'), leaf('Rescue.pdf')]), dir('.git', [leaf('HEAD')])]);
    const dt = { items: [{ kind: 'file', webkitGetAsEntry: () => tree }], files: [] } as unknown as DataTransfer;
    const picked = await filesFromDrop(dt);
    expect(picked.map((p) => `${p.folder}/${p.file.name}`)).toEqual(['SMS/Index.pdf', 'SMS/Chapter 2/Fire.pdf', 'SMS/Chapter 2/Rescue.pdf']);
  });
});

describe('what the server said', () => {
  it('turns answers into row states, offering Try again only when trying again can help', () => {
    expect(settle({ status: 201, body: { outcome: 'queued', document: { id: 'd', version: 3 } } })).toMatchObject({ state: 'queued', message: 'Added as version 3' });
    expect(settle({ status: 200, body: { outcome: 'unchanged' } })).toMatchObject({ state: 'unchanged' });
    expect(settle({ status: 415, body: { error: 'only PDF…' } })).toMatchObject({ state: 'failed', retryable: false, message: 'only PDF…' });
    expect(settle({ status: 0, body: { error: 'Could not reach the server' } })).toMatchObject({ state: 'failed', retryable: true });
    expect(settle({ status: 503, body: {} })).toMatchObject({ state: 'failed', retryable: true, message: 'Upload failed (503)' });
  });
});

describe('the queue', () => {
  it('runs at most two at a time, in order, and takes files added while busy', async () => {
    let running = 0;
    let peak = 0;
    const order: number[] = [];
    const release: (() => void)[] = [];
    const lanes = uploadLanes<number>(2, async (n) => {
      running++;
      peak = Math.max(peak, running);
      order.push(n);
      await new Promise<void>((r) => release.push(r));
      running--;
    });
    lanes.push(1, 2, 3);
    lanes.push(4);
    for (let i = 0; i < 4; i++) {
      await Promise.resolve();
      release.shift()?.();
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(order).toEqual([1, 2, 3, 4]);
    expect(peak).toBe(2);
    await new Promise((r) => setTimeout(r, 0));
    release.splice(0).forEach((r) => r());
    await new Promise((r) => setTimeout(r, 0));
    expect(lanes.busy).toBe(false);
  });
});
