#!/usr/bin/env python3
"""Download a report's definition (PBIR visuals, pages, filters) via the Fabric REST API (read-only).

Uses POST /v1/workspaces/{ws}/reports/{id}/getDefinition, a long-running operation.
Output is written as decoded definition files.

Env: PBI_TENANT_ID, PBI_CLIENT_ID, PBI_CLIENT_SECRET (same as the other PBI scripts).

Example:
    python scripts/fetch_powerbi_report_definition.py \
        --workspace-id <ws-guid> --report-id <report-guid> --output-dir powerbi-estate/report-definitions
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import sys
from pathlib import Path

import requests

_SCRIPT_DIR = Path(__file__).resolve().parent


def _load_module(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, _SCRIPT_DIR / filename)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


fabric = _load_module("pbi_model_definition", "fetch_powerbi_model_definition.py")
pbi = fabric.pbi


def fetch_report_definition(session: requests.Session, workspace_id: str, report_id: str, fmt: str | None) -> dict:
    url = f"{fabric.FABRIC_ROOT}/workspaces/{workspace_id}/reports/{report_id}/getDefinition"
    if fmt:
        url += f"?format={fmt}"
    response = session.post(url, timeout=60)
    if response.status_code == 200:
        return response.json()
    if response.status_code == 202:
        return fabric.wait_for_operation(session, response)
    raise pbi.PowerBIError(f"getDefinition HTTP {response.status_code}: {fabric.error_text(response)}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace-id", required=True)
    parser.add_argument("--report-id", required=True)
    parser.add_argument("--format", default=None, help="Optional: PBIR or PBIR-Legacy (default: service default)")
    parser.add_argument("--output-dir", type=Path, default=Path("powerbi-estate/report-definitions"))
    args = parser.parse_args()

    pbi.load_pbi_env_from_dotenv()
    tenant_id = os.getenv("PBI_TENANT_ID", "").strip()
    client_id = os.getenv("PBI_CLIENT_ID", "").strip()
    client_secret = os.getenv("PBI_CLIENT_SECRET", "").strip()
    if not (tenant_id and client_id and client_secret):
        print("Set PBI_TENANT_ID, PBI_CLIENT_ID and PBI_CLIENT_SECRET.", file=sys.stderr)
        return 2

    out_dir = args.output_dir.expanduser().resolve() / args.report_id
    try:
        with requests.Session() as session:
            token = fabric.get_fabric_token(session, tenant_id, client_id, client_secret)
            session.headers.update({"Authorization": f"Bearer {token}", "Accept": "application/json"})
            definition = fetch_report_definition(session, args.workspace_id, args.report_id, args.format)
        written = fabric.write_parts(definition, out_dir)
    except pbi.PowerBIError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    print(f"Saved {len(written)} definition part(s) to {out_dir}")
    for path in written:
        print(f"  {path.relative_to(out_dir)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
