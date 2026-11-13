export type ModelFamilyMember = {
  model_id: string;
  name: string;
  pbi_model_id: string;
  workspace_id: string;
  measure_count: number;
};

export type ModelFamilyCluster = {
  family_key: string;
  display_name: string;
  varying_parameter: string | null;
  member_constants: Record<string, Record<string, string>>;
  members: ModelFamilyMember[];
};

const YEAR_RE = /\b(19|20)\d{2}\b/g;

/** Strip year/SDK/copy noise for near-duplicate model grouping. */
export function normalizeModelFamilyKey(name: string): string {
  return name
    .replace(YEAR_RE, ' ')
    .replace(/\bSDK[- ]?\d+/gi, ' ')
    .replace(/\bcopy\s*\d*/gi, ' ')
    .replace(/\bv\d+(\.\d+)*\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function extractYear(name: string): string | null {
  const m = name.match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : null;
}

function displayNameFromKey(familyKey: string): string {
  return familyKey.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function inferVaryingParameter(members: ModelFamilyMember[]): string | null {
  const years = members.map((m) => extractYear(m.name)).filter(Boolean) as string[];
  if (years.length >= 2 && years.length === members.length) return 'year';
  return null;
}

function buildMemberConstants(
  members: ModelFamilyMember[],
  varying: string | null,
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const m of members) {
    const row: Record<string, string> = { model_name: m.name };
    if (varying === 'year') {
      const y = extractYear(m.name);
      if (y) row.year = y;
    }
    out[m.model_id] = row;
  }
  return out;
}

export function clusterModelFamilies(members: ModelFamilyMember[], minSize = 2): ModelFamilyCluster[] {
  const byKey = new Map<string, ModelFamilyMember[]>();

  for (const m of members) {
    const key = normalizeModelFamilyKey(m.name);
    if (key.length < 3) continue;
    const bucket = byKey.get(key) ?? [];
    bucket.push(m);
    byKey.set(key, bucket);
  }

  const clusters: ModelFamilyCluster[] = [];

  for (const [family_key, group] of byKey) {
    if (group.length < minSize) continue;

    const byWorkspace = new Map<string, ModelFamilyMember[]>();
    for (const m of group) {
      const ws = byWorkspace.get(m.workspace_id) ?? [];
      ws.push(m);
      byWorkspace.set(m.workspace_id, ws);
    }

    const parts =
      byWorkspace.size > 1
        ? [...byWorkspace.values()].filter((g) => g.length >= minSize)
        : [group];

    for (const part of parts) {
      if (part.length < minSize) continue;
      const varying = inferVaryingParameter(part);
      clusters.push({
        family_key,
        display_name: displayNameFromKey(family_key),
        varying_parameter: varying,
        member_constants: buildMemberConstants(part, varying),
        members: part,
      });
    }
  }

  return clusters;
}

/** Prefer highest measure count; tie-break lexicographic name. */
export function pickCanonicalMemberId(members: ModelFamilyMember[]): string {
  const sorted = [...members].sort((a, b) => {
    if (b.measure_count !== a.measure_count) return b.measure_count - a.measure_count;
    return a.name.localeCompare(b.name);
  });
  return sorted[0]!.model_id;
}
