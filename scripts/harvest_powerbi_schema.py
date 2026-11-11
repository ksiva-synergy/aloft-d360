#!/usr/bin/env python3
"""Harvest semantic model schema: tables, columns, measures, DAX, Power Query (M).

Uses Power BI **Admin Scanner** (Workspace Info API). Requires tenant admin enablement
for the service principal — without it you get HTTP 401.

See docs/powerbi-semantic-schema.md.

Examples:
    python scripts/harvest_powerbi_schema.py
    python scripts/harvest_powerbi_schema.py --output-dir ./powerbi-estate
"""

from __future__ import annotations

import argparse
import datetime as dt
import getpass
import importlib.util
import json
import os
import re
import sys
import time
from pathlib import Path

import requests

_SCRIPT_DIR = Path(__file__).resolve().parent
SCAN_BATCH = 100
POLL_SECS = 45


def _load_pbi():
    path = _SCRIPT_DIR / "list_powerbi_semantic_models.py"
    spec = importlib.util.spec_from_file_location("pbi_list", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


pbi = _load_pbi()


def safe_filename(name: str, fallback: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip()[:80]
    return cleaned or fallback


def start_scan(session, workspace_ids: list[str], include_expressions: bool) -> str:
    query = "datasetSchema=true&datasourceDetails=true&lineage=true"
    if include_expressions:
        query += "&datasetExpressions=true"
    url = f"{pbi.API_ROOT}/admin/workspaces/getInfo?{query}"
    response = session.post(url, json={"workspaces": workspace_ids}, timeout=60)
    if response.status_code == 401:
        raise pbi.PowerBIError(
            "Admin Scanner returned 401. Enable SP in Power BI tenant settings "
            "(Allow service principals to use Power BI APIs), Fabric admin role, "
            "and metadata-scanning tenant settings. Application Tenant.Read.All alone is not enough."
        )
    if not response.ok:
        try:
            msg = response.json().get("error", {}).get("message", response.text[:300])
        except ValueError:
            msg = response.text[:300]
        raise pbi.PowerBIError(f"getInfo HTTP {response.status_code}: {msg}")
    scan_id = response.json().get("id")
    if not scan_id:
        raise pbi.PowerBIError("getInfo did not return a scan id")
    return scan_id


def wait_for_scan(session, scan_id: str) -> None:
    url = f"{pbi.API_ROOT}/admin/workspaces/scanStatus/{scan_id}"
    for attempt in range(40):
        response = session.get(url, timeout=60)
        if not response.ok:
            raise pbi.PowerBIError(f"scanStatus HTTP {response.status_code}")
        status = response.json().get("status")
        if status == "Succeeded":
            return
        if status in ("Failed", "Cancelled"):
            raise pbi.PowerBIError(f"scan status: {status}")
        print(f"  scan {scan_id}: {status} (poll {attempt + 1}) …", file=sys.stderr)
        time.sleep(POLL_SECS)
    raise pbi.PowerBIError("scan timed out")


def fetch_scan_result(session, scan_id: str) -> dict:
    url = f"{pbi.API_ROOT}/admin/workspaces/scanResult/{scan_id}"
    response = session.get(url, timeout=300)
    if not response.ok:
        raise pbi.PowerBIError(f"scanResult HTTP {response.status_code}")
    return response.json()


def write_dataset_schema(out_base: Path, ws_id: str, ws_name: str, dataset: dict) -> None:
    ds_id = dataset.get("id", "")
    ds_name = dataset.get("name", "model")
    payload = {
        "workspace_id": ws_id,
        "workspace_name": ws_name,
        "semantic_model_id": ds_id,
        "semantic_model_name": ds_name,
        "tables": dataset.get("tables", []),
        "relationships": dataset.get("relationships", []),
        "expressions": dataset.get("expressions", []),
        "datasourceUsages": dataset.get("datasourceUsages", []),
        "upstreamDataflows": dataset.get("upstreamDataflows", []),
    }
    stem = f"{safe_filename(ds_name, 'model')}_{ds_id}"
    write_json(out_base / ws_id / f"{stem}.schema.json", payload)


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)


def chunks(items: list[str], size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=Path("powerbi-estate"))
    parser.add_argument(
        "--no-expressions",
        action="store_true",
        help="Skip DAX and Mashup (M); tables/columns/measures only",
    )
    parser.add_argument(
        "--workspace-id",
        action="append",
        dest="workspace_ids",
        help="Limit to workspace GUID(s); default: all SP-visible workspaces",
    )
    args = parser.parse_args()

    pbi.load_pbi_env_from_dotenv()
    tenant_id = os.getenv("PBI_TENANT_ID", "").strip()
    client_id = os.getenv("PBI_CLIENT_ID", "").strip()
    client_secret = os.getenv("PBI_CLIENT_SECRET") or getpass.getpass("Power BI client secret (hidden): ")

    if not tenant_id or not client_id or not client_secret:
        print("Set PBI_TENANT_ID and PBI_CLIENT_ID, and provide a client secret.", file=sys.stderr)
        return 2

    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    harvest_dir = args.output_dir.expanduser().resolve() / f"{stamp}-schema"
    schema_dir = harvest_dir / "semantic_schema"
    raw_dir = harvest_dir / "scan_batches"

    try:
        with requests.Session() as session:
            token = pbi.get_token(session, tenant_id, client_id, client_secret)
            session.headers.update(
                {"Authorization": f"Bearer {token}", "Accept": "application/json", "Content-Type": "application/json"}
            )
            print("Authenticated successfully.")

            if args.workspace_ids:
                workspace_ids = args.workspace_ids
            else:
                workspace_ids = [w["id"] for w in pbi.list_workspaces(session)]

            print(f"Scanner: {len(workspace_ids)} workspace(s), expressions={not args.no_expressions}")

            total_models = 0
            total_tables = 0
            total_measures = 0

            for batch_no, batch in enumerate(chunks(workspace_ids, SCAN_BATCH), start=1):
                print(f"Batch {batch_no}: {len(batch)} workspace(s) …")
                scan_id = start_scan(session, batch, include_expressions=not args.no_expressions)
                wait_for_scan(session, scan_id)
                result = fetch_scan_result(session, scan_id)
                write_json(raw_dir / f"batch_{batch_no}_{scan_id}.json", result)

                for ws in result.get("workspaces", []):
                    ws_id = ws.get("id", "")
                    ws_name = ws.get("name", "")
                    for dataset in ws.get("datasets", []):
                        total_models += 1
                        tables = dataset.get("tables") or []
                        total_tables += len(tables)
                        for t in tables:
                            total_measures += len(t.get("measures") or [])
                        write_dataset_schema(schema_dir, ws_id, ws_name, dataset)

            write_json(
                harvest_dir / "manifest.json",
                {
                    "harvested_at_utc": stamp,
                    "workspace_count": len(workspace_ids),
                    "semantic_models_with_schema": total_models,
                    "table_count": total_tables,
                    "measure_count_total": total_measures,
                    "includes_expressions": not args.no_expressions,
                    "note": "Per-model files: semantic_schema/{workspaceId}/*.schema.json",
                },
            )

        print(f"\nSchema harvest complete → {harvest_dir}")
        print(f"  {total_models} model(s), {total_tables} table(s), {total_measures} measure(s)")
        return 0
    except pbi.PowerBIError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
