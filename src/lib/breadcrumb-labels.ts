'use client';

// breadcrumb-labels — lets a page name its own dynamic path segment in the
// shell breadcrumb (AppBreadcrumb is rendered by the shell, not the page, so
// the `dynamicLabels` prop cannot reach it). A page sets a label for the raw
// segment (e.g. an object UUID) once its data loads and clears it on unmount.

import { useEffect } from 'react';
import { create } from 'zustand';

interface BreadcrumbLabelState {
  labels: Record<string, string>;
  setLabel: (segment: string, label: string) => void;
  clearLabel: (segment: string) => void;
}

export const useBreadcrumbLabels = create<BreadcrumbLabelState>((set) => ({
  labels: {},
  setLabel: (segment, label) =>
    set((s) => (s.labels[segment] === label ? s : { labels: { ...s.labels, [segment]: label } })),
  clearLabel: (segment) =>
    set((s) => {
      if (!(segment in s.labels)) return s;
      const next = { ...s.labels };
      delete next[segment];
      return { labels: next };
    }),
}));

/** Show `label` in place of the raw `segment` while the calling component is mounted. */
export function useBreadcrumbLabel(segment: string | null | undefined, label: string | null | undefined) {
  const setLabel = useBreadcrumbLabels((s) => s.setLabel);
  const clearLabel = useBreadcrumbLabels((s) => s.clearLabel);
  useEffect(() => {
    if (!segment || !label) return;
    setLabel(segment, label);
    return () => clearLabel(segment);
  }, [segment, label, setLabel, clearLabel]);
}
