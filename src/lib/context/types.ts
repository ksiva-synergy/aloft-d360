import { z } from 'zod';

// ── Source configuration ──────────────────────────────────────────────────────

export interface HarvestConfig {
  query_budget?: number;
  sample_rows?: boolean;
  tablesample_pct?: number;
  tablesample_threshold?: number;
}

export interface ContextSource {
  id: string;
  org_id: string;
  connection_kind: string;
  connection_ref: string;
  display_name: string | null;
  scope_include: string[] | null;
  scope_exclude: string[] | null;
  harvest_config: HarvestConfig | null;
  status: string;
  last_sweep_at: Date | null;
}

// ── Object reference ──────────────────────────────────────────────────────────

export interface ObjectRef {
  source_id: string;
  connection_id: string;
  full_path: string;
  catalog_name: string;
  schema_name: string;
  object_name: string;
}

// ── Structural metadata (Zod-validated; types derived via z.infer) ────────────

export const ColumnMetadataSchema = z.object({
  name: z.string(),
  ordinal: z.number().int().nonnegative(),
  data_type: z.string(),
  is_nullable: z.boolean(),
  native_comment: z.string().nullable(),
});

export type ColumnMetadata = z.infer<typeof ColumnMetadataSchema>;

export const StructuralMetadataSchema = z.object({
  ref: z.object({
    source_id: z.string(),
    connection_id: z.string(),
    full_path: z.string(),
    catalog_name: z.string(),
    schema_name: z.string(),
    object_name: z.string(),
  }),
  object_kind: z.string(),
  native_comment: z.string().nullable(),
  source_altered_at: z.date().nullable(),
  columns: z.array(ColumnMetadataSchema),
});

export type StructuralMetadata = z.infer<typeof StructuralMetadataSchema>;

// ── Profile budget + result ───────────────────────────────────────────────────

export interface ProfileBudget {
  maxStatements: number;
  tableSamplePct?: number;
  tableSampleThreshold?: number;
  estimatedRows?: number;
  objectKind?: string;
  columns?: { name: string; data_type: string; is_nullable: boolean }[];
}

export interface ObjectProfile {
  ref: ObjectRef;
  capturedAt: Date;
  stats: Record<string, unknown>;
}

// ── Canonical full_path builder ───────────────────────────────────────────────
//
// Single source of truth for the join key used by both the estate inventory
// write (estate.ts → platform_estate_objects.full_path) and the harvest write
// (databricks-adapter → harvest.ts → platform_context_objects.full_path).
//
// Rules enforced here:
//   • Trim each segment — information_schema occasionally pads with whitespace.
//   • Lower-case each segment — Unity Catalog names are case-insensitive;
//     normalising here means mixed-case names from different IS endpoints still
//     produce the same join key.
//   • No backticks, no surrounding quotes.
//   • Dollar signs and other special chars in object names are preserved verbatim
//     (e.g. "9299422$item$..." from the O3 catalog).
//
export function buildFullPath(catalog: string, schema: string, object: string): string {
  return `${catalog.trim().toLowerCase()}.${schema.trim().toLowerCase()}.${object.trim().toLowerCase()}`;
}

// ── Estate inventory row (from information_schema.tables) ────────────────────

export const EstateRowSchema = z.object({
  table_catalog: z.string(),
  table_schema:  z.string(),
  table_name:    z.string(),
  table_type:    z.string(),
  comment:       z.string().nullable(),
  last_altered:  z.string().nullable(),
});

export type EstateRow = z.infer<typeof EstateRowSchema>;
