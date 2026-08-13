#!/usr/bin/env python3
"""Set the immutable release tag in a validated Aurelia data manifest."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Finalize validated data release manifest")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--release-tag", required=True)
    args = parser.parse_args()
    payload = json.loads(args.manifest.read_text(encoding="utf-8"))
    payload["release_tag"] = args.release_tag
    args.manifest.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
