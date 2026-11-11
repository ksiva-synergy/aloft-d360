#!/usr/bin/env python3
"""Harvest Power BI semantic models and report links into a folder (read-only metadata).

Requires: pip install requests
Env: PBI_TENANT_ID, PBI_CLIENT_ID, PBI_CLIENT_SECRET (see list_powerbi_semantic_models.py)

Examples:
    python scripts/harvest_powerbi_estate.py
    python scripts/harvest_powerbi_estate.py --output-dir ./powerbi-estate
    python scripts/harvest_powerbi_estate.py --no-datasources   # faster; list fields only
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import getpass
import importlib.util
import json
import os
import re
import sys
from pathlib import Path

import requests

_SCRIPT_DIR = Path(__file__).resolve().parent


def _load_pbi_helpers():
    path = _SCRIPT_DIR / "list_powerbi_semantic_models.py"
    spec = importlib.util.spec_from_file_location("pbi_list", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


pbi = _load_pbi_helpers()

SEMANTIC_CSV_FIELDS = [
    "workspace_name",
    "workspace_id",
    "semantic_model_name",
    "semantic_model_id",
    "description",
    "configured_by",
    "is_refreshable",
    "storage_mode",
]

REPORT_CSV_FIELDS = [
    "workspace_name",
    "workspace_id",
    "report_name",
    "report_id",
    "semantic_model_id",
    "semantic_model_name",
    "report_type",
    "web_url",
]


def safe_filename(name: str, fallback: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip()[:80]
    return cleaned or fallback


def list_reports(session, workspace_id: str) -> list[dict]:
    return pbi.get_json(session, f"groups/{workspace_id}/reports").get("value", [])


def fetch_dataset_detail(session, workspace_id: str, dataset_id: str) -> dict | None:
    try:
        return pbi.get_json(session, f"groups/{workspace_id}/datasets/{dataset_id}")
    except pbi.PowerBIError:
        return None


def fetch_datasources(session, workspace_id: str, dataset_id: str) -> tuple[list | None, str | None]:
    try:
        payload = pbi.get_json(session, f"groups/{workspace_id}/datasets/{dataset_id}/datasources")
        return payload.get("value", []), None
    except pbi.PowerBIError as exc:
        return None, str(exc)


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("powerbi-estate"),
        help="Root folder for harvest output (default: powerbi-estate)",
    )
    parser.add_argument(
        "--workspace-id",
        help="Only harvest this workspace GUID",
    )
    parser.add_argument(
        "--no-datasources",
        action="store_true",
        help="Skip per-model datasource API calls",
    )
    args = parser.parse_args()

    pbi.load_pbi_env_from_dotenv()
    tenant_id = os.getenv("PBI_TENANT_ID", "").strip()
    client_id = os.getenv("PBI_CLIENT_ID", "").strip()
    client_secret = os.getenv("PBI_CLIENT_SECRET") or getpass.getpass("Power BI client secret (hidden): ")

    if not tenant_id or not client_id or not client_secret:
        print("Set PBI_TENANT_ID and PBI_CLIENT_ID, and provide a client secret.", file=sys.stderr)
        return 2

    out_root = args.output_dir.expanduser().resolve()
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    harvest_dir = out_root / stamp
    ws_dir = harvest_dir / "workspaces"
    model_dir = harvest_dir / "semantic_models"

    semantic_rows: list[dict] = []
    report_rows: list[dict] = []
    datasource_errors = 0
    detail_errors = 0

    try:
        with requests.Session() as session:
            token = pbi.get_token(session, tenant_id, client_id, client_secret)
            session.headers.update({"Authorization": f"Bearer {token}", "Accept": "application/json"})
            print("Authenticated successfully.")

            if args.workspace_id:
                workspaces = [{"id": args.workspace_id, "name": "(specified workspace)"}]
            else:
                workspaces = pbi.list_workspaces(session)

            print(f"Harvesting {len(workspaces)} workspace(s) → {harvest_dir}")

            model_name_by_id: dict[str, str] = {}

            for ws in workspaces:
                ws_id = ws["id"]
                ws_name = ws.get("name") or ws_id
                print(f"  {ws_name} …")

                try:
                    models = pbi.list_semantic_models(session, ws_id)
                except pbi.PowerBIError as exc:
                    print(f"    skip workspace (datasets): {exc}", file=sys.stderr)
                    continue

                try:
                    reports = list_reports(session, ws_id)
                except pbi.PowerBIError as exc:
                    print(f"    reports unavailable: {exc}", file=sys.stderr)
                    reports = []

                write_json(
                    ws_dir / ws_id / "workspace.json",
                    {"id": ws_id, "name": ws_name, "dataset_count": len(models), "report_count": len(reports)},
                )
                write_json(ws_dir / ws_id / "semantic_models_list.json", models)
                write_json(ws_dir / ws_id / "reports.json", reports)

                for model in models:
                    ds_id = model.get("id", "")
                    ds_name = model.get("name", "")
                    model_name_by_id[ds_id] = ds_name

                    row = {
                        "workspace_name": ws_name,
                        "workspace_id": ws_id,
                        "semantic_model_name": ds_name,
                        "semantic_model_id": ds_id,
                        "description": model.get("description", "") or "",
                        "configured_by": model.get("configuredBy", "") or "",
                        "is_refreshable": model.get("isRefreshable", ""),
                        "storage_mode": model.get("targetStorageMode", "") or "",
                    }
                    semantic_rows.append(row)

                    bundle: dict = {
                        "workspace_id": ws_id,
                        "workspace_name": ws_name,
                        "list": model,
                    }

                    detail = fetch_dataset_detail(session, ws_id, ds_id)
                    if detail:
                        bundle["detail"] = detail
                    else:
                        detail_errors += 1

                    if not args.no_datasources:
                        sources, err = fetch_datasources(session, ws_id, ds_id)
                        if sources is not None:
                            bundle["datasources"] = sources
                        else:
                            bundle["datasources_error"] = err
                            datasource_errors += 1

                    file_stem = f"{safe_filename(ds_name, 'model')}_{ds_id}"
                    write_json(model_dir / ws_id / f"{file_stem}.json", bundle)

                for rep in reports:
                    ds_id = rep.get("datasetId") or ""
                    report_rows.append(
                        {
                            "workspace_name": ws_name,
                            "workspace_id": ws_id,
                            "report_name": rep.get("name", ""),
                            "report_id": rep.get("id", ""),
                            "semantic_model_id": ds_id,
                            "semantic_model_name": model_name_by_id.get(ds_id, ""),
                            "report_type": rep.get("reportType", ""),
                            "web_url": rep.get("webUrl", ""),
                        }
                    )

        harvest_dir.mkdir(parents=True, exist_ok=True)

        csv_sem = harvest_dir / "semantic_models.csv"
        with csv_sem.open("w", newline="", encoding="utf-8-sig") as fh:
            writer = csv.DictWriter(fh, fieldnames=SEMANTIC_CSV_FIELDS)
            writer.writeheader()
            writer.writerows(semantic_rows)

        csv_rep = harvest_dir / "report_semantic_links.csv"
        with csv_rep.open("w", newline="", encoding="utf-8-sig") as fh:
            writer = csv.DictWriter(fh, fieldnames=REPORT_CSV_FIELDS)
            writer.writeheader()
            writer.writerows(report_rows)

        write_json(
            harvest_dir / "manifest.json",
            {
                "harvested_at_utc": stamp,
                "workspace_count": len(workspaces),
                "semantic_model_count": len(semantic_rows),
                "report_count": len(report_rows),
                "reports_with_semantic_model_id": sum(1 for r in report_rows if r["semantic_model_id"]),
                "detail_fetch_failures": detail_errors,
                "datasource_fetch_failures": datasource_errors,
                "paths": {
                    "semantic_models_csv": "semantic_models.csv",
                    "report_links_csv": "report_semantic_links.csv",
                    "per_workspace": "workspaces/{workspace_id}/",
                    "per_model": "semantic_models/{workspace_id}/{model}.json",
                },
            },
        )

        latest = out_root / "latest.json"
        write_json(latest, {"latest_harvest_dir": stamp, "harvested_at_utc": stamp, "path": str(harvest_dir)})

        print(f"\nDone. {len(semantic_rows)} semantic model(s), {len(report_rows)} report(s).")
        print(f"  {harvest_dir}")
        return 0
    except pbi.PowerBIError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
