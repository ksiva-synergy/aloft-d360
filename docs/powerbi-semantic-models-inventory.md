# Power BI semantic model inventory (local script)

Read-only metadata inventory via `scripts/list_powerbi_semantic_models.py` using a Microsoft Entra **application (service principal)** and client-credentials flow.

## Environment variables (`.env`)

Add these names to your local `.env` (values are not committed):

| Variable | Required | Description |
|----------|----------|-------------|
| `PBI_TENANT_ID` | Yes | Microsoft Entra directory (tenant) ID |
| `PBI_CLIENT_ID` | Yes | App registration application (client) ID |
| `PBI_CLIENT_SECRET` | Yes* | Client secret for that app |

\* If `PBI_CLIENT_SECRET` is unset, the script prompts securely at the terminal.

If you already use the same app registration for ALOFT sign-in, you can often copy the same GUIDs from `AZURE_AD_TENANT_ID` and `AZURE_AD_CLIENT_ID` (and the matching secret). The app must have Power BI API permissions and workspace access configured in Fabric / Power BI admin settings.

Example block to paste at the end of `.env`:

```env
# Power BI — list_powerbi_semantic_models.py (metadata only)
PBI_TENANT_ID=
PBI_CLIENT_ID=
PBI_CLIENT_SECRET=
```

## Run

```bash
pip install requests
python scripts/list_powerbi_semantic_models.py
```

Outputs `powerbi_semantic_models.csv` and `.json` in the current directory (override with `--output`).

See the script docstring for `--workspace-id` and `--tenant-wide` (admin API; needs IT approval).

## Full folder harvest

```bash
python scripts/harvest_powerbi_estate.py --output-dir ./powerbi-estate
```

Writes a timestamped folder under `powerbi-estate/`:

- `manifest.json` — counts and harvest time
- `semantic_models.csv` — flat index
- `report_semantic_links.csv` — each report’s `datasetId` joined to model name
- `workspaces/{id}/` — `semantic_models_list.json`, `reports.json`
- `semantic_models/{workspaceId}/` — one JSON file per model (list payload, optional detail + datasources)

Pointer: `powerbi-estate/latest.json` → newest run. Output is gitignored.
