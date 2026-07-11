/**
 * Lightweight version-diff utility for the dashboard builder.
 * Computes widget-count-level diff between two version snapshots.
 * Uses shallow JSON.stringify comparison — not field-level diff.
 */
import type { WidgetSpec } from '@/lib/dashboards/types';

export interface VersionDiffSummary {
  added: number;
  removed: number;
  modified: number;
}

export function computeVersionDiff(
  older: { widgets: WidgetSpec[] },
  newer: { widgets: WidgetSpec[] },
): VersionDiffSummary {
  const olderMap = new Map<string, string>();
  for (const w of older.widgets) {
    olderMap.set(w.widgetId, JSON.stringify(w));
  }

  const newerMap = new Map<string, string>();
  for (const w of newer.widgets) {
    newerMap.set(w.widgetId, JSON.stringify(w));
  }

  let added = 0;
  let removed = 0;
  let modified = 0;

  for (const [id, json] of newerMap) {
    if (!olderMap.has(id)) {
      added++;
    } else if (olderMap.get(id) !== json) {
      modified++;
    }
  }

  for (const id of olderMap.keys()) {
    if (!newerMap.has(id)) {
      removed++;
    }
  }

  return { added, removed, modified };
}
