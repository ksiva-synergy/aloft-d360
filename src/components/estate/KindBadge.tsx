'use client';

import React from 'react';
import { Tag } from './object-ui';

interface KindBadgeProps {
  kind: string;
}

export default function KindBadge({ kind }: KindBadgeProps) {
  // object_kind shown exactly as stored (table, view, materialized_view, …).
  return <Tag tone="neutral">{kind}</Tag>;
}
