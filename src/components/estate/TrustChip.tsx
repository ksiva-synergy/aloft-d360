'use client';

import React from 'react';
import { Tag } from './object-ui';

export type TrustStatus = 'assumed' | 'confirmed' | 'certified';

interface TrustChipProps {
  status: TrustStatus;
}

const TRUST: Record<TrustStatus, { tone: 'amber' | 'blue' | 'green'; label: string; title: string }> = {
  assumed:   { tone: 'amber', label: 'assumed',   title: 'LLM-generated — not yet human-validated' },
  confirmed: { tone: 'blue',  label: 'confirmed', title: 'Reviewed and confirmed by a steward' },
  certified: { tone: 'green', label: 'certified', title: 'Certified for use' },
};

export default function TrustChip({ status }: TrustChipProps) {
  const t = TRUST[status] ?? TRUST.assumed;
  return <Tag tone={t.tone} dot title={t.title}>{t.label}</Tag>;
}
