#!/usr/bin/env python3
"""Synchronize licensed football fixtures, odds snapshots, and Poisson research outputs.

This runner intentionally does not issue betting or funding instructions.  It saves
probabilities, evidence strength, and data-quality warnings for research use only.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import UTC, datetime, timedelta
from typing import Any

from football_sync.api_football import ApiFootballClient, normalize_fixture, normalize_odds
from football_sync.config import Settings
from football_sync.poisson import InsufficientHistory, predict_fixture
from football_sync.supabase_store import SupabaseStore

LOGGER = logging.getLogger("football_sync")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", help="UTC fixture date in YYYY-MM-DD; defaults to today and tomorrow")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and calculate but do not write Supabase")
    parser.add_argument("--max-fixtures", type=int, help="Override the safe per-run fixture cap")
    parser.add_argument("--report-out", help="Write a non-secret JSON run report for optional notifications")
    return parser.parse_args()


def unique_fixtures(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[int] = set()
    result: list[dict[str, Any]] = []
    for item in items:
        fixture_id = item.get("fixture", {}).get("id")
        if isinstance(fixture_id, int) and fixture_id not in seen:
            seen.add(fixture_id)
            result.append(item)
    return result


def prioritize_popular_fixtures(items: list[dict[str, Any]], max_fixtures: int) -> list[dict[str, Any]]:
    """Keep at least one fixture per covered league before filling remaining capacity.

    API-Football can return a large group of matches from one competition first.
    A round-robin pass prevents leagues such as J1 from being omitted merely because
    MLS or a European league has many fixtures on the same sync date.
    """
    ordered = sorted(items, key=lambda item: str(item.get("fixture", {}).get("date") or ""))
    selected: list[dict[str, Any]] = []
    represented: set[int] = set()
    for fixture in ordered:
        league_id = fixture.get("league", {}).get("id")
        if not isinstance(league_id, int) or league_id in represented:
            continue
        selected.append(fixture)
        represented.add(league_id)
        if len(selected) >= max_fixtures:
            return selected
    for fixture in ordered:
        if fixture in selected:
            continue
        selected.append(fixture)
        if len(selected) >= max_fixtures:
            break
    return selected


def run() -> dict[str, Any]:
    args = parse_args()
    settings = Settings.from_env()
    if args.max_fixtures:
        settings = settings.with_max_fixtures(args.max_fixtures)
    client = ApiFootballClient(settings.api_football_key)
    today = datetime.now(UTC).date()
    dates = [args.date] if args.date else [today.isoformat(), (today + timedelta(days=1)).isoformat()]
    scheduled = [fixture for date in dates for fixture in client.fixtures_by_date(date)]
    live = client.live_fixtures()
    fixtures = unique_fixtures(scheduled + live)
    fixtures = [fixture for fixture in fixtures if fixture.get("league", {}).get("id") in settings.league_ids]
    fixtures = prioritize_popular_fixtures(fixtures, settings.max_fixtures)

    store = None if args.dry_run else SupabaseStore.from_settings(settings)
    counts = {"fixtures": 0, "odds_snapshots": 0, "ai_predictions": 0, "prediction_skipped": 0}
    summaries: list[dict[str, Any]] = []
    now = datetime.now(UTC)
    for raw_fixture in fixtures:
        fixture_row = normalize_fixture(raw_fixture, now)
        if store:
            store.upsert_fixtures([fixture_row])
        counts["fixtures"] += 1

        odds_rows = normalize_odds(client.fixture_odds(fixture_row["api_fixture_id"]), fixture_row, now)
        if odds_rows:
            if store:
                store.insert_odds_snapshots(odds_rows)
            counts["odds_snapshots"] += len(odds_rows)

        if fixture_row["status"] not in {"NS", "TBD", "PST"}:
            continue
        league_id = fixture_row.get("league_id")
        season = fixture_row.get("season")
        if not isinstance(league_id, int) or not isinstance(season, int):
            LOGGER.warning("Skipping fixture %s: competition or season is missing", fixture_row["api_fixture_id"])
            counts["prediction_skipped"] += 1
            continue
        try:
            home_history = client.team_recent_fixtures(
                fixture_row["home_team_id"],
                limit=settings.history_matches,
                league_id=league_id,
                season=season,
            )
            away_history = client.team_recent_fixtures(
                fixture_row["away_team_id"],
                limit=settings.history_matches,
                league_id=league_id,
                season=season,
            )
            prediction = predict_fixture(fixture_row, home_history, away_history, generated_at=now)
        except InsufficientHistory as exc:
            LOGGER.info("Skipping fixture %s: %s", fixture_row["api_fixture_id"], exc)
            counts["prediction_skipped"] += 1
            continue
        if store:
            store.upsert_predictions([prediction.to_row()])
        counts["ai_predictions"] += 1
        summaries.append({
            "league": fixture_row.get("league_name") or "Unknown league",
            "home_team": fixture_row["home_team"],
            "away_team": fixture_row["away_team"],
            "score": prediction.most_likely_score,
            "lean": prediction.research_lean,
            "stars": prediction.evidence_stars,
        })

    LOGGER.info("Sync complete: %s", counts)
    report = {"generated_at": now.isoformat(), "dry_run": args.dry_run, "counts": counts, "predictions": sorted(summaries, key=lambda item: item["stars"], reverse=True)}
    if args.report_out:
        with open(args.report_out, "w", encoding="utf-8") as handle:
            json.dump(report, handle, ensure_ascii=False, indent=2)
    print(json.dumps(report, ensure_ascii=False))
    return report


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    try:
        run()
    except Exception:
        LOGGER.exception("Sync failed")
        sys.exit(1)
