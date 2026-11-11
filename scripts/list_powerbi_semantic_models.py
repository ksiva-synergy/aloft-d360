#!/usr/bin/env python3
"""List semantic models (datasets) in Power BI workspaces accessible to a service principal.

Requirements:
    pip install requests

Environment variables:
    PBI_TENANT_ID  - Microsoft Entra tenant ID
    PBI_CLIENT_ID  - App registration client ID
    PBI_CLIENT_SECRET - Optional; if not set, you'll be prompted securely

Examples:
    python list_powerbi_semantic_models.py
    python list_powerbi_semantic_models.py --workspace-id <workspace-guid>
    python list_powerbi_semantic_models.py --tenant-wide  # requires tenant admin API approval
    python list_powerbi_semantic_models.py --output my_inventory

This only reads metadata. It does not extract table data, edit Power BI assets,
or retrieve DAX / model definitions.
"""

import argparse
import csv
import getpass
import json
import os
import sys
import time
from pathlib import Path

import requests

API_ROOT = "https://api.powerbi.com/v1.0/myorg"
TOKEN_SCOPE = "https://analysis.windows.net/powerbi/api/.default"
PBI_ENV_KEYS = ("PBI_TENANT_ID", "PBI_CLIENT_ID", "PBI_CLIENT_SECRET")


def load_pbi_env_from_dotenv():
    """Load PBI_* from repo-root .env when unset (local dev only; values are never printed)."""
    if all(os.getenv(key, "").strip() for key in PBI_ENV_KEYS[:2]):
        return
    for candidate in (
        Path.cwd() / ".env",
        Path(__file__).resolve().parent.parent / ".env",
    ):
        if not candidate.is_file():
            continue
        try:
            text = candidate.read_text(encoding="utf-8")
        except OSError:
            continue
        for line in text.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, _, value = stripped.partition("=")
            key = key.strip()
            if key not in PBI_ENV_KEYS or os.getenv(key, "").strip():
                continue
            value = value.strip().strip('"').strip("'")
            if value:
                os.environ[key] = value
        break
FIELDS = [
    "workspace_name",
    "workspace_id",
    "semantic_model_name",
    "semantic_model_id",
    "description",
    "configured_by",
    "is_refreshable",
    "storage_mode",
]


class PowerBIError(Exception):
    pass


def get_token(session, tenant_id, client_id, client_secret):
    url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
    try:
        response = session.post(
            url,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "scope": TOKEN_SCOPE,
                "grant_type": "client_credentials",
            },
            timeout=30,
        )
    except requests.RequestException as exc:
        raise PowerBIError(f"Could not contact Microsoft Entra ID: {exc}") from exc

    if not response.ok:
        try:
            problem = response.json()
            detail = problem.get("error_description") or problem.get("error") or "Authentication failed"
        except ValueError:
            detail = "Authentication failed"
        raise PowerBIError(f"Token request returned HTTP {response.status_code}: {detail}")

    token = response.json().get("access_token")
    if not token:
        raise PowerBIError("No access_token received from Microsoft Entra ID")
    return token


def get_json(session, route, params=None):
    url = f"{API_ROOT}/{route.lstrip('/')}"
    for attempt in range(4):
        try:
            response = session.get(url, params=params, timeout=45)
        except requests.RequestException as exc:
            raise PowerBIError(f"Request failed for {route}: {exc}") from exc
        if response.status_code == 429 and attempt < 3:
            retry_after = response.headers.get("Retry-After", "5")
            try:
                wait_seconds = min(max(int(retry_after), 1), 60)
            except ValueError:
                wait_seconds = 5
            print(f"Rate limited; retrying in {wait_seconds}s...", file=sys.stderr)
            time.sleep(wait_seconds)
            continue
        if not response.ok:
            try:
                message = response.json().get("error", {}).get("message", "")
            except (ValueError, AttributeError):
                message = ""
            raise PowerBIError(f"Power BI HTTP {response.status_code} for {route}: {message}")
        try:
            return response.json()
        except ValueError as exc:
            raise PowerBIError(f"Power BI returned non-JSON response for {route}") from exc
    raise PowerBIError(f"Rate limit exceeded for {route}")


def list_workspaces(session):
    workspaces = []
    top = 100
    skip = 0
    while True:
        batch = get_json(session, "groups", {"$top": top, "$skip": skip}).get("value", [])
        workspaces.extend(batch)
        if len(batch) < top:
            break
        skip += top
    return workspaces


def list_semantic_models(session, workspace_id):
    return get_json(session, f"groups/{workspace_id}/datasets").get("value", [])


def list_admin_workspaces_with_models(session):
    """Tenant-wide inventory; requires read-only Admin API access for service principal."""
    results = []
    top = 100
    skip = 0
    while True:
        batch = get_json(
            session,
            "admin/groups",
            {"$top": top, "$skip": skip, "$expand": "datasets"},
        ).get("value", [])
        results.extend(batch)
        if len(batch) < top:
            break
        skip += top
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace-id", help="Only list models in this Power BI workspace GUID")
    parser.add_argument(
        "--tenant-wide",
        action="store_true",
        help="Use Admin API to inventory all tenant workspaces (requires separate IT approval)",
    )
    parser.add_argument(
        "--output",
        default="powerbi_semantic_models",
        help="Output filename prefix (default: powerbi_semantic_models)",
    )
    args = parser.parse_args()
    if args.tenant_wide and args.workspace_id:
        parser.error("Choose either --tenant-wide or --workspace-id, not both")

    load_pbi_env_from_dotenv()
    tenant_id = os.getenv("PBI_TENANT_ID", "").strip()
    client_id = os.getenv("PBI_CLIENT_ID", "").strip()
    client_secret = os.getenv("PBI_CLIENT_SECRET") or getpass.getpass("Power BI client secret (hidden): ")

    if not tenant_id or not client_id or not client_secret:
        print("Set PBI_TENANT_ID and PBI_CLIENT_ID, and provide a client secret.", file=sys.stderr)
        return 2

    try:
        with requests.Session() as session:
            token = get_token(session, tenant_id, client_id, client_secret)
            session.headers.update({"Authorization": f"Bearer {token}", "Accept": "application/json"})
            print("Authenticated successfully.")

            if args.tenant_wide:
                workspaces = list_admin_workspaces_with_models(session)
            elif args.workspace_id:
                workspaces = [{"id": args.workspace_id, "name": "(specified workspace)"}]
            else:
                workspaces = list_workspaces(session)

            print(f"Found {len(workspaces)} accessible workspace(s).")
            rows = []
            failures = 0
            for ws in workspaces:
                ws_id = ws.get("id")
                ws_name = ws.get("name", "")
                if args.tenant_wide:
                    models = ws.get("datasets", [])
                else:
                    try:
                        models = list_semantic_models(session, ws_id)
                    except PowerBIError as exc:
                        failures += 1
                        print(f"Warning: cannot read workspace {ws_name} ({ws_id}): {exc}", file=sys.stderr)
                        continue
                print(f"  {ws_name}: {len(models)} semantic model(s)")
                for model in models:
                    rows.append(
                        {
                            "workspace_name": ws_name,
                            "workspace_id": ws_id,
                            "semantic_model_name": model.get("name", ""),
                            "semantic_model_id": model.get("id", ""),
                            "description": model.get("description", ""),
                            "configured_by": model.get("configuredBy", ""),
                            "is_refreshable": model.get("isRefreshable", ""),
                            "storage_mode": model.get("targetStorageMode", ""),
                        }
                    )

        prefix = Path(args.output).expanduser()
        prefix.parent.mkdir(parents=True, exist_ok=True)
        csv_path = prefix.with_suffix(".csv")
        json_path = prefix.with_suffix(".json")
        with csv_path.open("w", newline="", encoding="utf-8-sig") as fh:
            writer = csv.DictWriter(fh, fieldnames=FIELDS)
            writer.writeheader()
            writer.writerows(rows)
        with json_path.open("w", encoding="utf-8") as fh:
            json.dump(rows, fh, indent=2, ensure_ascii=False)

        print(f"\nSaved {len(rows)} semantic model(s):\n  {csv_path.resolve()}\n  {json_path.resolve()}")
        if not rows:
            print("No models found. Check the service principal's workspace access and Fabric tenant settings.")
        if failures:
            print(f"{failures} workspace(s) could not be read. Inventory may be incomplete.")
        return 0
    except PowerBIError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        print(
            "Check app credentials, Fabric tenant settings, workspace permissions, "
            "or read-only Admin API access for --tenant-wide.",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
