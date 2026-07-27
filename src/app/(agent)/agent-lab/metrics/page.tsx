'use client';

import React from 'react';
import { MetricsCatalog } from '@/components/inspector/metrics-catalog/MetricsCatalog';

/**
 * /agent-lab/metrics — the layered metric catalog.
 *
 * Replaces the former flat governance queue (SemanticGovernancePanel mounted
 * org-wide) with a coverage overview + faceted/searchable virtualized table +
 * per-item detail drawer, switched by a Govern ⇄ Explore lens. One surface for
 * both the governance admin and the analyst; RBAC is enforced in the semantic
 * APIs (promote/archive/PATCH), the lens only reweights emphasis.
 *
 * All state + data loading lives in the catalog surface (metrics-catalog/*).
 */
export default function MetricsPage() {
  return (
    <div className="metrics-catalog" style={{ height: '100%' }}>
      {/* Suspense boundary required because MetricsCatalog reads useSearchParams
          (model/lens URL sync) — Next 15 de-opts static rendering otherwise. */}
      <React.Suspense fallback={null}>
        <MetricsCatalog />
      </React.Suspense>
    </div>
  );
}
