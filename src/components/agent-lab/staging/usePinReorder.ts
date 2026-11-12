'use client';

import { useState, type DragEvent, type KeyboardEvent } from 'react';
import { usePinnedAgents } from '@/lib/agents/usePinnedAgents';
import type { PinnedAgent } from '@/lib/agents/pinned-agents-shared';

function moveTo(list: PinnedAgent[], fromId: string, toId: string): PinnedAgent[] {
  const from = list.findIndex((p) => p.id === fromId);
  const to = list.findIndex((p) => p.id === toId);
  if (from < 0 || to < 0 || from === to) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

const sameOrder = (a: PinnedAgent[], b: PinnedAgent[]) => a.length === b.length && a.every((p, i) => p.id === b[i].id);

/**
 * Drag-to-reorder for the pinned agents in the sidebar, plus Alt+↑ / Alt+↓ on a focused pin.
 * Shows the new order while dragging and saves it once on drop (cancel with Esc keeps the old order).
 */
export function usePinReorder() {
  const { pins, reorder, setPinned } = usePinnedAgents();
  const [dragId, setDragId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PinnedAgent[] | null>(null);
  const list = preview ?? pins;

  const dragProps = (id: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      setDragId(id);
      setPreview(pins);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
    },
    onDragOver: (e: DragEvent) => {
      if (!dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (id !== dragId) setPreview((prev) => moveTo(prev ?? pins, dragId, id));
    },
    onDrop: (e: DragEvent) => {
      if (dragId) e.preventDefault();
    },
    onDragEnd: (e: DragEvent) => {
      const cancelled = e.dataTransfer.dropEffect === 'none';
      if (!cancelled && preview && !sameOrder(preview, pins)) void reorder(preview.map((p) => p.id));
      setDragId(null);
      setPreview(null);
    },
  });

  const keyProps = (id: string) => ({
    onKeyDown: (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      const index = pins.findIndex((p) => p.id === id);
      const target = pins[index + (e.key === 'ArrowUp' ? -1 : 1)];
      if (target) void reorder(moveTo(pins, id, target.id).map((p) => p.id));
    },
  });

  return { list, dragId, dragProps, keyProps, setPinned };
}
