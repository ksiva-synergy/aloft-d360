import { describe, expect, it } from 'vitest';
import { filterChats, groupChats, type InspectorChatItem } from '../InspectorChatList';

const item = (id: string, updated_at: string, over: Partial<InspectorChatItem> = {}): InspectorChatItem => ({
  id, title: id, last_message: null, pinned: false, surface: 'inspector', updated_at, ...over,
});

describe('groupChats', () => {
  const now = new Date(2026, 10, 1, 12, 0, 0);
  it('buckets pinned first, then by local day', () => {
    const groups = groupChats([
      item('old', new Date(2026, 9, 1).toISOString()),
      item('today', new Date(2026, 10, 1, 9).toISOString()),
      item('yday', new Date(2026, 9, 31, 23).toISOString()),
      item('week', new Date(2026, 9, 28).toISOString()),
      item('pin', new Date(2026, 8, 1).toISOString(), { pinned: true }),
    ], now);
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ['Pinned', ['pin']],
      ['Today', ['today']],
      ['Yesterday', ['yday']],
      ['Previous 7 days', ['week']],
      ['Older', ['old']],
    ]);
  });

  it('omits empty groups and sorts newest first', () => {
    const groups = groupChats([
      item('a', new Date(2026, 10, 1, 8).toISOString()),
      item('b', new Date(2026, 10, 1, 10).toISOString()),
    ], now);
    expect(groups).toEqual([{ label: 'Today', items: [expect.objectContaining({ id: 'b' }), expect.objectContaining({ id: 'a' })] }]);
  });
});

describe('filterChats', () => {
  it('matches title or last message, case-insensitive', () => {
    const items = [item('x', '2026-01-01', { title: 'Fuel by vessel' }), item('y', '2026-01-01', { title: null, last_message: 'Port CALLS' })];
    expect(filterChats(items, 'fuel').map((i) => i.id)).toEqual(['x']);
    expect(filterChats(items, 'calls').map((i) => i.id)).toEqual(['y']);
    expect(filterChats(items, '  ')).toHaveLength(2);
  });
});
