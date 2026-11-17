# Databricks notebook source
# MAGIC %md
# MAGIC # Single Power BI report — lineage stitched from Postgres
# MAGIC
# MAGIC One report, one view: **report → measures (parsed JSON) → measure home table → UC binding → catalog object**.
# MAGIC
# MAGIC | Stitched in this notebook | Not in SQL (use Estate UI / API) |
# MAGIC |---------------------------|----------------------------------|
# MAGIC | `pbi_reports`, `props.parse.measure_refs` | Measures only on disk until `pbi_parse` runs |
# MAGIC | `pbi_measures` → `pbi_tables` → `pbi_source_bindings` | Full DAX closure (multi-table per measure) |
# MAGIC | Model relationships, all bound tables on model | Page / visual / field lineage (Phase B) |
# MAGIC
# MAGIC **API (same logic as UI):** `GET /api/agent-lab/powerbi/reports/{report_uuid}/lineage`  
# MAGIC **Model rollup:** `GET /api/agent-lab/powerbi/models/{model_uuid}/lineage`
# MAGIC
# MAGIC Secrets scope `aloft`: `postgres_jdbc_url`, `postgres_user`, `postgres_password`.

# COMMAND ----------

dbutils.widgets.text("org_id", "", "org_id (required)")
dbutils.widgets.text("report_id", "", "pbi_reports.id UUID (preferred)")
dbutils.widgets.text("report_name", "", "report_name ILIKE %...% (if report_id empty)")
dbutils.widgets.text("pbi_report_id", "", "Power BI report GUID (optional filter)")

org_id = dbutils.widgets.get("org_id").strip()
report_id = dbutils.widgets.get("report_id").strip()
report_name = dbutils.widgets.get("report_name").strip()
pbi_report_id = dbutils.widgets.get("pbi_report_id").strip()

if not org_id:
    raise ValueError("Set widget org_id")
if not report_id and not report_name and not pbi_report_id:
    raise ValueError("Set report_id, or report_name, or pbi_report_id")

org_esc = org_id.replace("'", "''")

# COMMAND ----------

jdbc_url = dbutils.secrets.get(scope="aloft", key="postgres_jdbc_url")
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
# MAGIC ## 1) Resolve report + model

# COMMAND ----------

report_filter = ""
if report_id:
    rid = report_id.replace("'", "''")
    report_filter = f" AND r.id = '{rid}'::uuid"
elif pbi_report_id:
    pid = pbi_report_id.replace("'", "''")
    report_filter = f" AND r.pbi_report_id = '{pid}'"
elif report_name:
    rn = report_name.replace("'", "''")
    report_filter = f" AND r.name ILIKE '%{rn}%'"

header_df = pg_query(f"""
SELECT
  r.id AS report_uuid,
  r.name AS report_name,
  r.pbi_report_id,
  r.report_format,
  r.lifecycle AS report_lifecycle,
  r.props->'parse'->>'page_count' AS pages_parsed,
  r.props->'definition'->>'storage_path' AS definition_storage_path,
  m.id AS model_uuid,
  m.name AS model_name,
  m.pbi_model_id,
  w.name AS workspace_name
FROM pbi_reports r
JOIN pbi_models m ON m.id = r.model_id
JOIN pbi_workspaces w ON w.id = r.workspace_id
WHERE r.org_id = '{org_esc}'
  AND r.lifecycle = 'active'
  {report_filter}
ORDER BY r.updated_at DESC
LIMIT 5
""")

display(header_df)

if header_df.count() == 0:
    dbutils.notebook.exit("No matching report")

if header_df.count() > 1:
    print("Multiple reports matched — downstream cells use the first row. Set report_id to disambiguate.")

row = header_df.collect()[0]
report_uuid = row["report_uuid"]
model_uuid = row["model_uuid"]
rid_esc = str(report_uuid).replace("'", "''")
mid_esc = str(model_uuid).replace("'", "''")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2) Stitched lineage — report measures → UC (primary output)

# COMMAND ----------

stitched_df = pg_query(f"""
WITH report_row AS (
  SELECT r.id, r.model_id, r.org_id
  FROM pbi_reports r
  WHERE r.id = '{rid_esc}'::uuid
),
measure_names AS (
  SELECT DISTINCT trim(elem) AS measure_name
  FROM pbi_reports r
  CROSS JOIN LATERAL jsonb_array_elements_text(
    COALESCE(r.props->'parse'->'measure_refs', '[]'::jsonb)
  ) AS elem
  WHERE r.id = '{rid_esc}'::uuid
    AND trim(elem) <> ''
)
SELECT
  '{row["report_name"]}' AS report_name,
  mn.measure_name,
  CASE WHEN meas.id IS NULL THEN false ELSE true END AS found_on_model,
  meas.name AS model_measure_name,
  mt.name AS measure_home_table,
  b.bind_status,
  b.uc_full_path,
  b.connection_host,
  o.full_path AS catalog_object_full_path,
  CASE
    WHEN b.uc_full_path IS NOT NULL THEN 'measure_home_table'
    WHEN meas.id IS NULL THEN 'report_only_or_not_parsed'
    ELSE 'unbound_table'
  END AS lineage_note
FROM measure_names mn
LEFT JOIN report_row rr ON true
LEFT JOIN pbi_measures meas
  ON meas.org_id = rr.org_id
 AND meas.model_id = rr.model_id
 AND meas.lifecycle = 'active'
 AND lower(meas.name) = lower(mn.measure_name)
LEFT JOIN pbi_tables mt ON mt.id = meas.table_id
LEFT JOIN pbi_source_bindings b ON b.table_id = mt.id
LEFT JOIN platform_context_objects o ON o.id = b.context_object_id
ORDER BY mn.measure_name
""")

display(stitched_df)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3) High-level counts for this report's model

# COMMAND ----------

summary_df = pg_query(f"""
SELECT
  (SELECT COUNT(*)::int FROM pbi_reports x WHERE x.model_id = '{mid_esc}'::uuid AND x.lifecycle = 'active') AS reports_on_model,
  (SELECT COUNT(*)::int FROM pbi_measures x WHERE x.model_id = '{mid_esc}'::uuid AND x.lifecycle = 'active') AS measures_in_model,
  (SELECT COUNT(*)::int FROM pbi_tables x WHERE x.model_id = '{mid_esc}'::uuid AND x.lifecycle = 'active') AS semantic_tables,
  (SELECT COUNT(*)::int FROM pbi_source_bindings x
     JOIN pbi_tables t ON t.id = x.table_id AND t.lifecycle = 'active'
     WHERE x.model_id = '{mid_esc}'::uuid AND x.uc_full_path IS NOT NULL) AS warehouse_bound,
  (SELECT COUNT(DISTINCT trim(elem))::int
     FROM pbi_reports r
     CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(r.props->'parse'->'measure_refs', '[]'::jsonb)) AS elem
     WHERE r.id = '{rid_esc}'::uuid AND trim(elem) <> '') AS measures_on_this_report
""")

display(summary_df)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4) All warehouse bindings on the model (context)

# COMMAND ----------

model_warehouse_df = pg_query(f"""
SELECT
  t.name AS pbi_table,
  b.bind_status,
  b.uc_full_path,
  o.full_path AS catalog_object
FROM pbi_tables t
LEFT JOIN pbi_source_bindings b ON b.table_id = t.id
LEFT JOIN platform_context_objects o ON o.id = b.context_object_id
WHERE t.org_id = '{org_esc}'
  AND t.model_id = '{mid_esc}'::uuid
  AND t.lifecycle = 'active'
ORDER BY t.name
""")

display(model_warehouse_df)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5) Semantic join relationships (in-model lineage)

# COMMAND ----------

rels_df = pg_query(f"""
SELECT from_column, to_column, cardinality, cross_filtering, is_active
FROM pbi_relationships
WHERE org_id = '{org_esc}'
  AND model_id = '{mid_esc}'::uuid
  AND lifecycle = 'active'
ORDER BY from_column
""")

display(rels_df)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 6) Distinct UC paths touched (this report via measure home tables)
# MAGIC
# MAGIC Full multi-table DAX closure requires the app (`report-lineage.ts`) — home-table UC only here.

# COMMAND ----------

uc_df = stitched_df.filter("uc_full_path IS NOT NULL").select("uc_full_path").distinct().orderBy("uc_full_path")
display(uc_df)