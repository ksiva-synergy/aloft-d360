# Power BI lineage notebooks (Databricks)

| File | Format | Purpose |
|------|--------|---------|
| `single_report_lineage_from_postgres.ipynb` | **Databricks `.ipynb`** (import this) | One report: stitched lineage from Postgres |
| `single_report_lineage_from_postgres.py` | Source sync (same cells) | Repo-friendly `.py` export |
| `view_pbi_bridge_lineage_from_postgres.py` | Source sync | Model-wide bindings / measures |

## Import into Databricks

**Workspace → Import → File** → choose `single_report_lineage_from_postgres.ipynb`.

Configure secret scope **`aloft`**: `postgres_jdbc_url`, `postgres_user`, `postgres_password`.

Widgets: `org_id`, `report_id` (or `report_name` / `pbi_report_id`).