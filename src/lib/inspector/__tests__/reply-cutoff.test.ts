import { describe, it, expect } from 'vitest';
import { finishCutOffReply, isOutputCapStop, REPLY_CUT_OFF_NOTICE } from '@/lib/inspector/reply-cutoff';
import {
  largeResultDisplayNote,
  CHAT_TABLE_ROWS_WITH_PANEL,
  CHAT_TABLE_ROWS_WITHOUT_PANEL,
  countMarkdownTableDataRows,
  shouldOfferChatFullTable,
} from '@/lib/inspector/result-display';
import type { QueryResult } from '@/hooks/useInspectorChat';

describe('isOutputCapStop', () => {
  it('recognises each provider output-cap reason', () => {
    expect(isOutputCapStop('max_tokens')).toBe(true);
    expect(isOutputCapStop('length')).toBe(true);
    expect(isOutputCapStop('max_output_tokens')).toBe(true);
  });
  it('ignores normal stops', () => {
    expect(isOutputCapStop('end_turn')).toBe(false);
    expect(isOutputCapStop('stop')).toBe(false);
    expect(isOutputCapStop('tool_use')).toBe(false);
    expect(isOutputCapStop(undefined)).toBe(false);
  });
});

describe('finishCutOffReply', () => {
  it('drops a half-written table row and appends the notice', () => {
    const text = '225 people.\n\n| Name | Dept |\n|---|---|\n| Ana | Ops |\n| Ben | Fin';
    const out = finishCutOffReply(text);
    expect(out).toBe(`225 people.\n\n| Name | Dept |\n|---|---|\n| Ana | Ops |\n\n${REPLY_CUT_OFF_NOTICE}`);
  });
  it('keeps a complete last row', () => {
    const out = finishCutOffReply('| A |\n|---|\n| x |');
    expect(out.startsWith('| A |\n|---|\n| x |\n\n')).toBe(true);
  });
  it('is idempotent', () => {
    const once = finishCutOffReply('Some text');
    expect(finishCutOffReply(once)).toBe(once);
  });
  it('handles an empty reply', () => {
    expect(finishCutOffReply('')).toBe(REPLY_CUT_OFF_NOTICE);
  });
});

describe('largeResultDisplayNote', () => {
  it('says nothing when the list fits', () => {
    expect(largeResultDisplayNote(CHAT_TABLE_ROWS_WITH_PANEL, true)).toBeNull();
    expect(largeResultDisplayNote(CHAT_TABLE_ROWS_WITHOUT_PANEL, false)).toBeNull();
  });
  it('points at the Results panel and in-chat table when the surface has one', () => {
    const note = largeResultDisplayNote(225, true)!;
    expect(note).toContain('225');
    expect(note).toContain('Results panel');
    expect(note).toContain('searchable table under your reply');
    expect(note).toContain(`at most ${CHAT_TABLE_ROWS_WITH_PANEL} rows`);
  });
  it('asks for a "Showing X of N" line when the chat is the only view', () => {
    const note = largeResultDisplayNote(225, false)!;
    expect(note).not.toContain('Results panel');
    expect(note).toContain(`Showing ${CHAT_TABLE_ROWS_WITHOUT_PANEL} of 225.`);
    expect(note).toContain('Open full table');
  });
});

describe('shouldOfferChatFullTable', () => {
  const result = (rowCount: number, rows: number): QueryResult => ({
    columns: [{ name: 'a', type_name: 'string' }],
    rows: Array.from({ length: rows }, () => ({ a: 'x' })),
    sql: 'SELECT 1',
    rowCount,
    truncated: false,
  });

  it('needs a markdown table in the message', () => {
    expect(shouldOfferChatFullTable('Just prose.', result(100, 100))).toBe(false);
  });

  it('offers popup when warehouse has more rows than the typed table', () => {
    const md = '| name |\n|---|---|\n| a |\n| b |\n| c |';
    expect(countMarkdownTableDataRows(md)).toBe(3);
    expect(shouldOfferChatFullTable(md, result(225, 225))).toBe(true);
  });
});
