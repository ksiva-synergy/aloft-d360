#!/usr/bin/env python3
"""Download a semantic model's TMDL definition via the Fabric REST API (read-only).

Uses POST /v1/workspaces/{ws}/semanticModels/{id}/getDefinition?format=TMDL, a
long-running operation. Output is written as decoded TMDL files.

Env: PBI_TENANT_ID, PBI_CLIENT_ID, PBI_CLIENT_SECRET (same as the other PBI scripts).

Example:
    python scripts/fetch_powerbi_model_definition.py \
        --workspace-id <ws-guid> --model-id <model-guid> --output-dir powerbi-estate/definitions
"""

from __future__ import annotations

import argparse
import base64
import importlib.util
import os
import sys
import time
from pathlib import Path

import requests

_SCRIPT_DIR = Path(__file__).resolve().parent
FABRIC_ROOT = "https://api.fabric.microsoft.com/v1"
FABRIC_SCOPE = "https://api.fabric.microsoft.com/.default"


def _load_pbi():
    spec = importlib.util.spec_from_file_location("pbi_list", _SCRIPT_DIR / "list_powerbi_semantic_models.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


pbi = _load_pbi()


def get_fabric_token(session: requests.Session, tenant_id: str, client_id: str, client_secret: str) -> str:
    response = session.post(
        f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token",
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": FABRIC_SCOPE,
            "grant_type": "client_credentials",
        },
        timeout=30,
    )
    if not response.ok:
        raise pbi.PowerBIError(f"Fabric token request returned HTTP {response.status_code}")
    return response.json()["access_token"]


def error_text(response: requests.Response) -> str:
    try:
        body = response.json()
        return f"{body.get('errorCode', '')}: {body.get('message', '')}".strip(": ")
    except ValueError:
        return response.text[:300]


def wait_for_operation(session: requests.Session, response: requests.Response) -> dict:
    location = response.headers.get("Location")
    op_id = response.headers.get("x-ms-operation-id")
    if not location and op_id:
        location = f"{FABRIC_ROOT}/operations/{op_id}"
    if not location:
        raise pbi.PowerBIError("getDefinition returned 202 without an operation location")

    for _ in range(60):
        retry = int(response.headers.get("Retry-After", "5") or 5)
        time.sleep(min(max(retry, 2), 30))
        status = session.get(location, timeout=60)
        if not status.ok:
            raise pbi.PowerBIError(f"operation status HTTP {status.status_code}: {error_text(status)}")
        state = status.json().get("status")
        if state == "Succeeded":
            result = session.get(f"{location.rstrip('/')}/result", timeout=120)
            if not result.ok:
                raise pbi.PowerBIError(f"operation result HTTP {result.status_code}: {error_text(result)}")
            return result.json()
        if state in ("Failed", "Undefined"):
            raise pbi.PowerBIError(f"operation {state}: {status.json().get('error')}")
        response = status
    raise pbi.PowerBIError("getDefinition timed out")


def fetch_definition(session: requests.Session, workspace_id: str, model_id: str) -> dict:
    url = f"{FABRIC_ROOT}/workspaces/{workspace_id}/semanticModels/{model_id}/getDefinition?format=TMDL"
    response = session.post(url, timeout=60)
    if response.status_code == 200:
        return response.json()
    if response.status_code == 202:
        return wait_for_operation(session, response)
    raise pbi.PowerBIError(f"getDefinition HTTP {response.status_code}: {error_text(response)}")


def write_parts(definition: dict, out_dir: Path) -> list[Path]:
    written = []
    for part in definition.get("definition", {}).get("parts", []):
        rel = Path(part["path"])
        target = out_dir / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(base64.b64decode(part["payload"]))
        written.append(target)
    return written


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace-id", required=True)
    parser.add_argument("--model-id", required=True)
    parser.add_argument("--output-dir", type=Path, default=Path("powerbi-estate/definitions"))
    args = parser.parse_args()

    pbi.load_pbi_env_from_dotenv()
    tenant_id = os.getenv("PBI_TENANT_ID", "").strip()
    client_id = os.getenv("PBI_CLIENT_ID", "").strip()
    client_secret = os.getenv("PBI_CLIENT_SECRET", "").strip()
    if not (tenant_id and client_id and client_secret):
        print("Set PBI_TENANT_ID, PBI_CLIENT_ID and PBI_CLIENT_SECRET.", file=sys.stderr)
        return 2

    out_dir = args.output_dir.expanduser().resolve() / args.model_id
    try:
        with requests.Session() as session:
            token = get_fabric_token(session, tenant_id, client_id, client_secret)
            session.headers.update({"Authorization": f"Bearer {token}", "Accept": "application/json"})
            definition = fetch_definition(session, args.workspace_id, args.model_id)
        written = write_parts(definition, out_dir)
    except pbi.PowerBIError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    print(f"Saved {len(written)} definition part(s) to {out_dir}")
    for path in written:
        print(f"  {path.relative_to(out_dir)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
