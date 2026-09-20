#!/usr/bin/env python3
"""Create a validated Aurelia Football data-release manifest."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


VALIDATED_LEAGUES = ["BRA1", "EPL", "LL", "BL", "SA", "L1", "MLS", "J1", "FIN1", "KOR1", "POR1", "MEX1", "AUS1", "UEL", "SUD", "LCUP"]


def main() -> None:
    parser = argparse.ArgumentParser(description="Create Aurelia Football data manifest")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--generated-at", help="UTC ISO-8601 timestamp")
    args = parser.parse_args()
    generated_at = args.generated_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    payload = {
        "schema_version": 1,
        "generated_at": generated_at,
        "release_tag": "pending-publication",
        "assets": {
            "database": "football_data_expanded.db",
            "model": "soccer_predict_model.pkl",
            "performance": "model_performance_filters.json",
        },
        "validated_leagues": VALIDATED_LEAGUES,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
