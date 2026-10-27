/** T2 snapshot used by T4 propose (no server-only — safe for tests/fixtures). */
export interface ObjectT2Context {
  id: string;
  full_path: string;
  object_name: string | null;
  catalog_name: string | null;
  schema_name: string | null;
  card: Record<string, unknown> | null;
  columns: Array<{
    name: string;
    data_type: string | null;
    semantic: Record<string, unknown> | null;
  }>;
}
