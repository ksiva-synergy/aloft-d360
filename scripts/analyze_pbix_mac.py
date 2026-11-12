#!/usr/bin/env python3
"""Locally extract Power BI PBIX semantic model metadata on macOS.

Requires: pip install pbixray
Usage:
  python3 analyze_pbix_mac.py [folder_with_pbix_files] [output_folder]
Defaults: ~/Downloads and ~/Desktop/pbix_semantic_metadata
Only metadata is extracted. Imported business data rows are never exported.
"""

import json
import sys
from pathlib import Path

from pbixray import PBIXRay


def main() -> int:
    default_downloads = Path.home() / "Downloads"
    default_output = Path.home() / "Desktop" / "pbix_semantic_metadata"

    if len(sys.argv) > 1:
        first = Path(sys.argv[1]).expanduser()
        if first.is_file() and first.suffix.lower() == ".pbix":
            files = [first]
            output = Path(sys.argv[2]).expanduser() if len(sys.argv) > 2 else default_output
        else:
            source = first
            output = Path(sys.argv[2]).expanduser() if len(sys.argv) > 2 else default_output
            if not source.is_dir():
                print(f"Input folder not found: {source}")
                return 1
            files = sorted(p for p in source.iterdir() if p.is_file() and p.suffix.lower() == ".pbix")
    else:
        source = default_downloads
        output = default_output
        if not source.is_dir():
            print(f"Input folder not found: {source}")
            return 1
        files = sorted(p for p in source.iterdir() if p.is_file() and p.suffix.lower() == ".pbix")

    if not files:
        print(f"No .pbix files found in {source}")
        print("Pass the folder containing your PBIX files as the first argument.")
        return 1

    output.mkdir(parents=True, exist_ok=True)
    inventory = []
    props = [
        "schema",
        "relationships",
        "dax_measures",
        "dax_columns",
        "dax_tables",
        "power_query",
        "m_parameters",
        "rls",
        "ols",
        "aggregations",
    ]

    for file in files:
        print(f"\nInspecting: {file.name}")
        dest = output / file.stem
        dest.mkdir(parents=True, exist_ok=True)
        item = {"file": file.name, "status": "ok", "counts": {}, "warnings": []}
        try:
            with PBIXRay(str(file), on_disk=True) as model:
                tables = [str(name) for name in model.tables]
                (dest / "tables.json").write_text(json.dumps(tables, indent=2), encoding="utf-8")
                item["table_count"] = len(tables)
                for prop in props:
                    try:
                        df = getattr(model, prop)
                        df.to_csv(dest / f"{prop}.csv", index=False)
                        item["counts"][prop] = len(df)
                    except Exception as err:
                        item["warnings"].append(f"{prop}: {err}")
                try:
                    (dest / "connections.json").write_text(
                        json.dumps(model.connections, indent=2, default=str), encoding="utf-8"
                    )
                except Exception as err:
                    item["warnings"].append(f"connections: {err}")
                preview = [
                    f"# {file.name} — semantic metadata",
                    "",
                    "Metadata is read from the downloaded PBIX file, not from live Power BI usage.",
                    "",
                    f"Tables found: **{len(tables)}**",
                    "",
                    "## Tables",
                    "",
                ]
                preview.extend(f"- `{name}`" for name in tables)
                preview.extend(["", "## Extracted CSV files", ""])
                preview.extend(f"- `{name}.csv` ({count} rows)" for name, count in item["counts"].items())
                preview.extend(["", "**Important:** This does not extract live report view counts or evaluate DAX."])
                (dest / "README.md").write_text("\n".join(preview) + "\n", encoding="utf-8")
                print(f"  Tables: {len(tables)}; DAX measures: {item['counts'].get('dax_measures', 0)}")
                print(f"  Saved: {dest}")
        except Exception as err:
            item["status"] = "failed"
            item["error"] = str(err)
            print(f"  Could not extract this PBIX: {err}")
            print("  It may be a thin/live-connected report, encrypted, or unsupported format.")
        inventory.append(item)

    (output / "inventory.json").write_text(json.dumps(inventory, indent=2), encoding="utf-8")
    print(f"\nFinished. Output folder: {output}")
    print("Review power_query.csv for Databricks sources, dax_measures.csv for KPIs,")
    print("relationships.csv for joins, and schema.csv for tables/columns.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
