'use client';

import React from 'react';
import { Tag, type Tone } from './object-ui';

interface StatusChipProps {
  status: string;
}

function toneFor(status: string): Tone {
  const s = status.toLowerCase();
  if (['active', 'live', 'completed', 'success', 'succeeded'].includes(s)) return 'green';
  if (['deprecated', 'failed', 'error', 'cancelled'].includes(s)) return 'red';
  if (['stale', 'warning', 'pending', 'partial'].includes(s)) return 'amber';
  if (['running', 'queued'].includes(s)) return 'blue';
  return 'neutral';
}

export default function StatusChip({ status }: StatusChipProps) {
  // Status shown exactly as stored (succeeded, running, partial, …).
  return <Tag tone={toneFor(status)} dot>{status}</Tag>;
}
