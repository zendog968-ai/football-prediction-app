#!/usr/bin/env python3
"""Verify Supabase write access with a real API-Football fixture payload saved by curl."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from football_sync.api_football import normalize_fixture
from football_sync.config import Settings
from football_sync.supabase_store import SupabaseStore


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("payload", type=Path, help="Saved API-Football JSON response containing one real fixture")
    args = parser.parse_args()
    payload = json.loads(args.payload.read_text(encoding="utf-8"))
    response = payload.get("response", [])
    if not isinstance(response, list) or not response:
        raise RuntimeError("payload has no real API-Football fixture")
    fixture = normalize_fixture(response[0], datetime.now(UTC))
    store = SupabaseStore.from_settings(Settings.from_env())
    store.upsert_fixtures([fixture])
    found = store.client.table("fixtures").select("fixture_id,home_team,away_team").eq("fixture_id", fixture["api_fixture_id"]).limit(1).execute()
    if not found.data:
        raise RuntimeError("fixture upsert was not readable after write")
    print(json.dumps({"verified_fixture_id": fixture["api_fixture_id"], "home": fixture["home_team"], "away": fixture["away_team"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
