# Databricks notebook source
# MAGIC %md
# MAGIC # Power BI bridge lineage (from Aurora Postgres)
# MAGIC
# MAGIC This notebook reads **only Aurora Postgres** — Power BI bridge tables and optional Estate usage
# MAGIC snapshots already persisted there. It does **not** query Databricks `system.access.*` lineage.
# MAGIC
# MAGIC | Layer | Where it lives | What it means |
# MAGIC |-------|----------------|---------------|
# MAGIC | **Power Query (M)** | `pbi_tables.source_m` | Full partition M; column/warehouse mapping is derived at compile time (`m-lineage.ts`) |
# MAGIC | **PBI → UC crosswalk** | `pbi_source_bindings` | `uc_full_path`, `native_sql`, `bind_status`, optional `context_object_id` → `platform_context_objects` |
# MAGIC | **Stable identity** | `lineage_tag` on tables/columns/measures | Fabric object id across re-parses — **not** data lineage |
# MAGIC | **Semantic deps (DAX / PQ refs)** | Built in memory | `buildModelGraph` — use Estate API `GET …/powerbi/models/{id}/graph` or re-run graph logic in the app |
# MAGIC | **Model relationships** | `pbi_relationships` | Join keys inside the semantic model |
# MAGIC
# MAGIC **Setup:** Create a secret scope (e.g. `aloft`) with keys `postgres_jdbc_url` (full JDBC URL, SSL) or
# MAGIC host/user/password/database for URL assembly. Restrict notebook access to stewards.

# COMMAND ----------

dbutils.widgets.text("org_id", "", "org_id (required)")
dbutils.widgets.text("model_name", "", "model_name (optional filter)")
dbutils.widgets.text("pbi_model_uuid", "", "pbi_models.id UUID (optional; overrides name)")

org_id = dbutils.widgets.get("org_id").strip()
model_name = dbutils.widgets.get("model_name").strip()
pbi_model_uuid = dbutils.widgets.get("pbi_model_uuid").strip()

if not org_id:
    raise ValueError("Set widget org_id")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Connect (JDBC)

# COMMAND ----------

jdbc_url = dbutils.secrets.get(scope="aloft", key="postgres_jdbc_url")

# Read-only property map; tune pool for your warehouse size
jdbc_props = {
    "user": dbutils.secrets.get(scope="aloft", key="postgres_user"),
    "password": dbutils.secrets.get(scope="aloft", key="postgres_password"),
    "driver": "org.postgresql.Driver",
    "fetchsize": "10000",
}

def pg_query(sql: str):
    return (
        spark.read.format("jdbc")
        .option("url", jdbc_url)
        .option("query", sql)
        .options(**jdbc_props)
        .load()
    )

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1) Models in scope

# COMMAND ----------

model_filter = ""
if pbi_model_uuid:
    model_filter = f" AND m.id = '{pbi_model_uuid.replace(chr(39), chr(39)+chr(39))}'::uuid"
elif model_name:
    esc = model_name.replace("'", "''")
    model_filter = f" AND m.name ILIKE '%{esc}%'"

models_df = pg_query(f"""
SELECT
  m.id AS model_id,
  m.name AS model_name,
  m.pbi_model_id,
  m.lifecycle,
  m.props->'parse'->>'parsed_at' AS parsed_at,
  w.name AS workspace_name
FROM pbi_models m
JOIN pbi_workspaces w ON w.id = m.workspace_id
WHERE m.org_id = '{org_id.replace("'", "''")}'
  AND m.lifecycle = 'active'
  {model_filter}
ORDER BY m.name
""")

display(models_df)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2) Table → warehouse bindings (the crosswalk)

# COMMAND ----------

bindings_df = pg_query(f"""
SELECT
  m.name AS model_name,
  t.name AS pbi_table,
  t.lineage_tag AS table_lineage_tag,
  t.partition_kind,
  t.storage_mode,
  b.bind_status,
  b.connector,
  b.connection_host,
  b.uc_full_path,
  LEFT(b.native_sql, 500) AS native_sql_preview,
  o.full_path AS context_object_full_path,
  o.id AS context_object_id,
  b.updated_at AS binding_updated_at
FROM pbi_source_bindings b
JOIN pbi_tables t ON t.id = b.table_id AND t.lifecycle = 'active'
JOIN pbi_models m ON m.id = b.model_id
LEFT JOIN platform_context_objects o ON o.id = b.context_object_id
WHERE b.org_id = '{org_id.replace("'", "''")}'
  {model_filter.replace('m.id', 'b.model_id') if model_filter else ''}
ORDER BY m.name, t.name
""")

display(bindings_df)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3) Bind health summary

# COMMAND ----------

bind_summary = pg_query(f"""
SELECT
  m.name AS model_name,
  COUNT(*) AS bound_tables,
  COUNT(*) FILTER (WHERE b.bind_status = 'bound' AND b.context_object_id IS NOT NULL) AS linked_to_catalog,
  COUNT(*) FILTER (WHERE b.bind_status = 'pending') AS pending,
  COUNT(*) FILTER (WHERE b.uc_full_path IS NULL AND b.native_sql IS NULL) AS no_uc_path_in_m
FROM pbi_source_bindings b
JOIN pbi_models m ON m.id = b.model_id
WHERE b.org_id = '{org_id.replace("'", "''")}'
  {model_filter.replace('m.id', 'b.model_id') if model_filter else ''}
GROUP BY m.name
ORDER BY pending DESC, m.name
""")

display(bind_summary)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4) Semantic model relationships (in-model lineage)

# COMMAND ----------

rels_df = pg_query(f"""
SELECT
  m.name AS model_name,
  r.from_column,
  r.to_column,
  r.cardinality,
  r.cross_filtering,
  r.is_active
FROM pbi_relationships r
JOIN pbi_models m ON m.id = r.model_id
WHERE r.org_id = '{org_id.replace("'", "''")}'
  AND r.lifecycle = 'active'
  {model_filter.replace('m.id', 'r.model_id') if model_filter else ''}
ORDER BY m.name, r.from_column
""")

display(rels_df)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5) Measures → home table (entry points for DAX lineage)
# MAGIC
# MAGIC Full measure → column closure is **not** persisted as edges; the app builds it via `buildModelGraph`.
# MAGIC Use the graph API or export `source_m` + `dax` and run `pbi_definitions` / translate in the app.

# COMMAND ----------

measures_df = pg_query(f"""
SELECT
  m.name AS model_name,
  mt.name AS measure_table,
  meas.name AS measure_name,
  meas.lineage_tag AS measure_lineage_tag,
  LEFT(meas.dax, 300) AS dax_preview
FROM pbi_measures meas
JOIN pbi_tables mt ON mt.id = meas.table_id
JOIN pbi_models m ON m.id = meas.model_id
WHERE meas.org_id = '{org_id.replace("'", "''")}'
  AND meas.lifecycle = 'active'
  {model_filter.replace('m.id', 'meas.model_id') if model_filter else ''}
ORDER BY m.name, meas.name
""")

display(measures_df)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 6) Optional: Estate usage neighbors in Postgres (`platform_context_usage.co_objects`)
# MAGIC
# MAGIC For each bound catalog object, expands **already-stored** T3 snapshot JSON (top co-objects per table
# MAGIC at harvest time). Still Postgres-only — no live Databricks system catalog queries.

# COMMAND ----------

t3_neighbors = pg_query(f"""
WITH latest_usage AS (
  SELECT DISTINCT ON (u.context_object_id)
    u.context_object_id,
    u.full_path,
    u.co_objects,
    u.version,
    u.captured_at
  FROM platform_context_usage u
  WHERE u.org_id = '{org_id.replace("'", "''")}'
  ORDER BY u.context_object_id, u.version DESC
)
SELECT
  m.name AS model_name,
  t.name AS pbi_table,
  b.uc_full_path,
  lu.full_path AS catalog_object,
  elem->>'full_path' AS neighbor_path,
  elem->>'kind' AS neighbor_kind,
  (elem->>'n')::int AS neighbor_weight
FROM pbi_source_bindings b
JOIN pbi_tables t ON t.id = b.table_id
JOIN pbi_models m ON m.id = b.model_id
JOIN latest_usage lu ON lu.context_object_id = b.context_object_id
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(lu.co_objects, '[]'::jsonb)) AS elem
WHERE b.org_id = '{org_id.replace("'", "''")}'
  AND b.context_object_id IS NOT NULL
  {model_filter.replace('m.id', 'b.model_id') if model_filter else ''}
ORDER BY m.name, t.name, neighbor_weight DESC NULLS LAST
""")

display(t3_neighbors)