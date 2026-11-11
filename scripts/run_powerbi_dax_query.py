#!/usr/bin/env python3
"""Run a read-only DAX query against a semantic model (Power BI executeQueries REST API).

Uses POST /v1.0/myorg/groups/{ws}/datasets/{id}/executeQueries. DAX EVALUATE queries
are read-only. Used to get Power BI's own numbers for parity checks.

Auth modes (--auth):
  sp      Service principal from PBI_TENANT_ID / PBI_CLIENT_ID / PBI_CLIENT_SECRET (default).
          Cannot query models that have RLS roles.
  device  Signed-in user via MSAL device-code flow on PBI_CLIENT_ID, with the delegated
          Dataset.Read.All scope. Needs "Allow public client flows" on the app
          registration. Workspace admins/members/contributors are not filtered by RLS.
          Token cache is kept outside the repo at ~/.aloft/pbi_msal_cache.json.

Azure CLI tokens (`az account get-access-token`) carry only `user_impersonation` and are
rejected by the Power BI REST API, so they are not offered here.

Tokens are never printed.

Examples:
    python scripts/run_powerbi_dax_query.py --workspace-id <ws> --model-id <model> --query "EVALUATE {1}"
    python scripts/run_powerbi_dax_query.py --auth device --workspace-id <ws> --model-id <model> \
        --query-file query.dax
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
from pathlib import Path

import requests

_SCRIPT_DIR = Path(__file__).resolve().parent
PBI_RESOURCE = "https://analysis.windows.net/powerbi/api"
DELEGATED_SCOPES = [f"{PBI_RESOURCE}/Dataset.Read.All"]
MSAL_CACHE = Path.home() / ".aloft" / "pbi_msal_cache.json"


def _load_pbi():
    spec = importlib.util.spec_from_file_location("pbi_list", _SCRIPT_DIR / "list_powerbi_semantic_models.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


pbi = _load_pbi()


def token_service_principal(session: requests.Session) -> str:
    pbi.load_pbi_env_from_dotenv()
    tenant_id = os.getenv("PBI_TENANT_ID", "").strip()
    client_id = os.getenv("PBI_CLIENT_ID", "").strip()
    client_secret = os.getenv("PBI_CLIENT_SECRET", "").strip()
    if not (tenant_id and client_id and client_secret):
        raise pbi.PowerBIError("Set PBI_TENANT_ID, PBI_CLIENT_ID and PBI_CLIENT_SECRET.")
    return pbi.get_token(session, tenant_id, client_id, client_secret)


def token_device_code() -> str:
    import msal

    pbi.load_pbi_env_from_dotenv()
    tenant_id = os.getenv("PBI_TENANT_ID", "").strip()
    client_id = os.getenv("PBI_CLIENT_ID", "").strip()
    if not (tenant_id and client_id):
        raise pbi.PowerBIError("Set PBI_TENANT_ID and PBI_CLIENT_ID.")

    cache = msal.SerializableTokenCache()
    if MSAL_CACHE.exists():
        cache.deserialize(MSAL_CACHE.read_text(encoding="utf-8"))
    app = msal.PublicClientApplication(
        client_id, authority=f"https://login.microsoftonline.com/{tenant_id}", token_cache=cache
    )

    result = None
    accounts = app.get_accounts()
    if accounts:
        result = app.acquire_token_silent(DELEGATED_SCOPES, account=accounts[0])
    if not result:
        flow = app.initiate_device_flow(scopes=DELEGATED_SCOPES)
        if "user_code" not in flow:
            raise pbi.PowerBIError(f"Device flow failed: {flow.get('error_description', flow)}")
        print(flow["message"], file=sys.stderr)
        result = app.acquire_token_by_device_flow(flow)

    if "access_token" not in result:
        raise pbi.PowerBIError(f"Sign-in failed: {result.get('error_description', result.get('error'))}")
    if cache.has_state_changed:
        MSAL_CACHE.parent.mkdir(parents=True, exist_ok=True)
        MSAL_CACHE.write_text(cache.serialize(), encoding="utf-8")
    return result["access_token"]


def get_access_token(session: requests.Session, auth: str) -> str:
    if auth == "device":
        return token_device_code()
    return token_service_principal(session)


def run_dax(session: requests.Session, workspace_id: str, model_id: str, query: str) -> dict:
    url = f"{pbi.API_ROOT}/groups/{workspace_id}/datasets/{model_id}/executeQueries"
    body = {"queries": [{"query": query}], "serializerSettings": {"includeNulls": True}}
    response = session.post(url, json=body, timeout=120)
    if not response.ok:
        try:
            detail = json.dumps(response.json())[:800]
        except ValueError:
            detail = response.text[:800]
        raise pbi.PowerBIError(f"executeQueries HTTP {response.status_code}: {detail}")
    return response.json()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--workspace-id", required=True)
    parser.add_argument("--model-id", required=True)
    query_group = parser.add_mutually_exclusive_group(required=True)
    query_group.add_argument("--query", help="DAX query starting with EVALUATE or DEFINE")
    query_group.add_argument("--query-file", type=Path, help="File containing the DAX query")
    parser.add_argument("--auth", choices=["sp", "device"], default="sp")
    parser.add_argument("--max-rows", type=int, default=20, help="Rows to print (default 20)")
    parser.add_argument("--output", type=Path, help="Optional: write all rows as JSON to this file")
    args = parser.parse_args()

    query = args.query if args.query is not None else args.query_file.read_text(encoding="utf-8")
    if not query.lstrip().upper().startswith(("EVALUATE", "DEFINE")):
        print("Only DAX EVALUATE/DEFINE queries are allowed.", file=sys.stderr)
        return 2

    try:
        with requests.Session() as session:
            token = get_access_token(session, args.auth)
            session.headers.update({"Authorization": f"Bearer {token}", "Accept": "application/json"})
            result = run_dax(session, args.workspace_id, args.model_id, query)
    except pbi.PowerBIError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    rows = result.get("results", [{}])[0].get("tables", [{}])[0].get("rows", [])
    print(f"{len(rows)} row(s)")
    for row in rows[: args.max_rows]:
        print(json.dumps(row, default=str))
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(rows, indent=2, default=str), encoding="utf-8")
        print(f"Wrote {len(rows)} row(s) to {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
