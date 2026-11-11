#!/usr/bin/env python3
"""Decode a Power BI embedded Table.FromRows blob from TMDL into CSV/JSON."""

from __future__ import annotations

import argparse
import base64
import csv
import json
import re
import zlib
from pathlib import Path


def decode_embedded(tmdl_text: str) -> list[list]:
    match = re.search(r'Binary\.FromText\("([^"]+)"\s*,\s*BinaryEncoding\.Base64\)', tmdl_text)
    if not match:
        raise ValueError("No embedded Binary.FromText blob found in TMDL")
    raw = base64.b64decode(match.group(1))
    for wbits in (zlib.MAX_WBITS, -zlib.MAX_WBITS):
        try:
            decoded = zlib.decompress(raw, wbits)
            break
        except zlib.error:
            continue
    else:
        raise ValueError("Could not decompress embedded table")
    return json.loads(decoded)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("tmdl", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--format", choices=["csv", "json"], default="csv")
    args = parser.parse_args()

    rows = decode_embedded(args.tmdl.read_text(encoding="utf-8"))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.format == "json":
        args.output.write_text(json.dumps(rows, indent=2), encoding="utf-8")
    else:
        if not rows:
            raise ValueError("Empty embedded table")
        headers = rows[0] if all(isinstance(c, str) for c in rows[0]) else ["VESSEL_NAME", "IMO_NUMBER", "DEAD_WEIGHT"]
        with args.output.open("w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            if headers == rows[0]:
                w.writerow(headers)
                data = rows[1:]
            else:
                w.writerow(headers)
                data = rows
            for row in data:
                w.writerow(row)
    print(f"Wrote {len(rows)} row(s) to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
