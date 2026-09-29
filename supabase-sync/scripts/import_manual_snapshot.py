#!/usr/bin/env python3
"""Import a labelled manual market snapshot and compare it with Aurelia output."""
from __future__ import annotations

import argparse
import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import requests


class ImportError(RuntimeError):
    pass


def args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--report-out", type=Path, required=True)
    return parser.parse_args()


def config() -> tuple[str, dict[str, str]]:
    url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    key = os.getenv("SUPABASE_SECRET_KEY", "").strip() or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        raise ImportError("SUPABASE_URL and SUPABASE_SECRET_KEY are required")
    return url, {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def rest_get(url: str, headers: dict[str, str], table: str, params: dict[str, str]) -> list[dict[str, Any]]:
    response = requests.get(f"{url}/rest/v1/{table}", headers=headers, params=params, timeout=20)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, list):
        raise ImportError(f"Supabase {table} response was not a list")
    return [row for row in payload if isinstance(row, dict)]


def find_fixture(url: str, headers: dict[str, str], fixture: dict[str, Any]) -> dict[str, Any]:
    date = datetime.fromisoformat(fixture["match_date_hkt"]).date()
    start = datetime(date.year, date.month, date.day, tzinfo=UTC) - timedelta(hours=8)
    end = start + timedelta(days=1)
    home_team = str(fixture["home_team"]).replace("*", "")
    away_team = str(fixture["away_team"]).replace("*", "")
    league_name = "Liga MX" if "墨西哥" in str(fixture.get("league", "")) else str(fixture.get("league", ""))
    rows = rest_get(url, headers, "fixtures", {
        "home_team": f"ilike.*{home_team}*",
        "away_team": f"ilike.*{away_team}*",
        "league_name": f"ilike.*{league_name}*" if league_name else "not.is.null",
        "event_time": f"gte.{start.isoformat().replace('+00:00', 'Z')}",
        "select": "*",
        "limit": "50",
    })
    candidates = []
    for row in rows:
        try:
            kickoff = datetime.fromisoformat(str(row["event_time"]).replace("Z", "+00:00"))
            if kickoff.tzinfo is None:
                kickoff = kickoff.replace(tzinfo=UTC)
            if kickoff < end:
                candidates.append(row)
        except (KeyError, TypeError, ValueError):
            continue
    if len(candidates) != 1:
        details = [
            {
                "fixture_id": row.get("fixture_id"),
                "league_name": row.get("league_name"),
                "event_time": row.get("event_time"),
                "status": row.get("status"),
                "home_team": row.get("home_team"),
                "away_team": row.get("away_team"),
            }
            for row in candidates
        ]
        raise ImportError(f"Expected exactly one fixture match, found {len(candidates)}: {json.dumps(details, ensure_ascii=False)}")
    return candidates[0]


def market_row(fixture_id: int, market: dict[str, Any], captured_at: str) -> dict[str, Any]:
    return {
        "fixture_id": fixture_id,
        "market_type": f"MANUAL_SCREENSHOT | {market['market_type']}",
        "handicap": market["selection"],
        "home_odds": market.get("home_odds"),
        "draw_odds": market.get("draw_odds"),
        "away_odds": market.get("away_odds"),
        "snapshot_time": captured_at,
    }


def insert_rows(url: str, headers: dict[str, str], rows: list[dict[str, Any]]) -> None:
    response = requests.post(
        f"{url}/rest/v1/odds_snapshots",
        headers={**headers, "Prefer": "return=minimal"},
        json=rows,
        timeout=20,
    )
    response.raise_for_status()


def implied(values: list[float]) -> dict[str, Any]:
    raw = [1 / value for value in values]
    total = sum(raw)
    return {"raw": raw, "normalized": [value / total for value in raw], "overround": total - 1}


def main() -> None:
    parsed = args()
    payload = json.loads(parsed.snapshot.read_text(encoding="utf-8"))
    url, headers = config()
    fixture = find_fixture(url, headers, payload["fixture"])
    fixture_id = int(fixture["fixture_id"])
    captured_at = payload["source"]["captured_at_hkt"]
    rows = [market_row(fixture_id, market, captured_at) for market in payload["markets"]]
    insert_rows(url, headers, rows)

    prediction_rows = rest_get(url, headers, "ai_predictions", {
        "fixture_id": f"eq.{fixture_id}", "select": "*", "limit": "1",
    })
    prediction = prediction_rows[0] if prediction_rows else None
    hda = next(m for m in payload["markets"] if m["market_type"] == "1X2")
    market_probability = implied([hda["home_odds"], hda["draw_odds"], hda["away_odds"]])
    model_probability = None
    comparison = None
    if prediction:
        model_probability = [
            float(prediction["home_win_prob"]),
            float(prediction["draw_prob"]),
            float(prediction["away_win_prob"]),
        ]
        comparison = {
            "model_minus_market_normalized": [
                model_probability[i] - market_probability["normalized"][i] for i in range(3)
            ],
            "model_probability_sum": sum(model_probability),
        }

    report = {
        "schema_version": 1,
        "imported_at": datetime.now(UTC).replace(microsecond=0).isoformat(),
        "fixture": fixture,
        "manual_source": payload["source"],
        "inserted_snapshot_rows": len(rows),
        "market_1x2": {
            "odds": [hda["home_odds"], hda["draw_odds"], hda["away_odds"]],
            "normalized_probability": market_probability["normalized"],
            "overround": market_probability["overround"],
        },
        "aurelia_prediction": prediction,
        "comparison": comparison,
        "limitations": [
            "Manual screenshot odds are labelled as MANUAL_SCREENSHOT and are not treated as provider odds.",
            "The screenshot is an in-play halftime snapshot; it is not a pre-match model input.",
            "The existing odds_snapshots schema stores market rows but has no dedicated source metadata column.",
        ],
    }
    parsed.report_out.parent.mkdir(parents=True, exist_ok=True)
    parsed.report_out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "fixture_id": fixture_id,
        "inserted_snapshot_rows": len(rows),
        "model_available": prediction is not None,
        "report": str(parsed.report_out),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
