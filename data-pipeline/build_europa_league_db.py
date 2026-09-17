#!/usr/bin/env python3
"""Extend a validated database with UEFA Europa League results.

Historical results use the ODC-BY schochastics dataset (competition ``UEFA EL``).
The current qualifying season is supplemented from FBref's public scores and
fixtures table.  Only rows with a final score on or before the cutoff enter the
database; no future fixtures, xG, or odds are fabricated.
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import requests

from build_football_db import compute_team_stats, insert_matches

HISTORICAL_SOURCE_URL = "https://raw.githubusercontent.com/schochastics/football-data/master/data/results/games.parquet"
UEFA_MATCHES_URL = "https://match.uefa.com/v5/matches"
UEFA_COMPETITION_ID = "14"
LEAGUE_CODE = "UEL"
LEAGUE_NAME = "UEFA Europa League"


def season_label(match_date: pd.Timestamp) -> str:
    start_year = match_date.year if match_date.month >= 7 else match_date.year - 1
    return f"{start_year}-{start_year + 1}"


def match_id(season: str, match_date: str, home: str, away: str, home_goals: int, away_goals: int) -> str:
    raw = "|".join([LEAGUE_CODE, season, match_date, home, away, str(home_goals), str(away_goals)])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def record(match_date: pd.Timestamp, home: str, away: str, home_goals: int, away_goals: int, source_url: str, fetched_at: str) -> dict[str, Any]:
    home = " ".join(home.strip().split())
    away = " ".join(away.strip().split())
    season = season_label(match_date)
    date_text = match_date.date().isoformat()
    result = "H" if home_goals > away_goals else "A" if away_goals > home_goals else "D"
    return {
        "match_id": match_id(season, date_text, home, away, home_goals, away_goals),
        "league_code": LEAGUE_CODE,
        "league_name": LEAGUE_NAME,
        "season": season,
        "match_date": date_text,
        "match_time": "12:00:00",
        "home_team": home,
        "away_team": away,
        "home_goals": home_goals,
        "away_goals": away_goals,
        "result": result,
        "half_home_goals": None,
        "half_away_goals": None,
        "home_xg": None,
        "away_xg": None,
        "home_shots": None,
        "away_shots": None,
        "home_shots_target": None,
        "away_shots_target": None,
        "home_corners": None,
        "away_corners": None,
        "home_yellow_cards": None,
        "away_yellow_cards": None,
        "home_red_cards": None,
        "away_red_cards": None,
        "home_odds": None,
        "draw_odds": None,
        "away_odds": None,
        "odds_source": None,
        "source_url": source_url,
        "fetched_at": fetched_at,
    }


def historical_records(parquet_path: Path, cutoff: date, fetched_at: str) -> list[dict[str, Any]]:
    games = pd.read_parquet(parquet_path, columns=["competition", "date", "home", "away", "gh", "ga", "full_time"])
    games["date"] = pd.to_datetime(games["date"], errors="coerce")
    start = pd.Timestamp(year=cutoff.year - 5, month=7, day=1)
    subset = games[(games["competition"] == "UEFA EL") & games["date"].notna() & games["gh"].notna() & games["ga"].notna()].copy()
    subset = subset[(subset["date"] >= start) & (subset["date"] <= pd.Timestamp(cutoff))]
    # Penalty shoot-out result columns are not compatible with a 90-minute 1X2 label.
    subset = subset[subset["full_time"].fillna("F").eq("F")]
    return [
        record(pd.Timestamp(row.date), str(row.home), str(row.away), int(row.gh), int(row.ga), HISTORICAL_SOURCE_URL, fetched_at)
        for row in subset.itertuples(index=False)
        if str(row.home).strip() and str(row.away).strip() and str(row.home) != str(row.away)
    ]


def current_season_records(cutoff: date, fetched_at: str) -> list[dict[str, Any]]:
    season_year = cutoff.year if cutoff.month >= 7 else cutoff.year - 1
    # UEFA API identifies a split season by its ending year (e.g. 2026–27 => 2027).
    api_season_year = season_year + 1
    source_url = f"{UEFA_MATCHES_URL}?competitionId={UEFA_COMPETITION_ID}&seasonYear={api_season_year}&limit=500&offset=0&order=ASC"
    response = requests.get(source_url, headers={"User-Agent": "AureliaFootballResearch/1.0 (+https://github.com/zendog968-ai/football-prediction-app)"}, timeout=30)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, list):
        raise RuntimeError("UEFA官方賽事端點回傳非列表資料")
    records: list[dict[str, Any]] = []
    for row in payload:
        if row.get("status") != "FINISHED":
            continue
        match_date = pd.to_datetime(row.get("kickOffTime", {}).get("date"), errors="coerce")
        home, away = row.get("homeTeam", {}), row.get("awayTeam", {})
        regular = row.get("score", {}).get("regular", {})
        home_goals, away_goals = regular.get("home"), regular.get("away")
        if pd.isna(match_date) or match_date.date() > cutoff or home.get("isPlaceHolder") or away.get("isPlaceHolder"):
            continue
        if not isinstance(home_goals, int) or not isinstance(away_goals, int):
            continue
        records.append(record(match_date, str(home.get("internationalName", "")), str(away.get("internationalName", "")), home_goals, away_goals, source_url, fetched_at))
    return records


def validate(connection: sqlite3.Connection) -> None:
    row = connection.execute(
        "SELECT COUNT(*), COUNT(DISTINCT season), MIN(match_date), MAX(match_date) FROM matches WHERE league_code = ?",
        (LEAGUE_CODE,),
    ).fetchone()
    if not row or row[0] == 0 or row[1] < 5:
        raise RuntimeError(f"歐霸盃資料驗證失敗：{row}")
    xg_rows = connection.execute("SELECT COUNT(*) FROM matches WHERE league_code = ? AND (home_xg IS NOT NULL OR away_xg IS NOT NULL)", (LEAGUE_CODE,)).fetchone()[0]
    if xg_rows:
        raise RuntimeError("歐霸盃來源未提供相容xG，欄位必須保持NULL")
    print(f"UEL | {row[0]:,} 場 | {row[1]} 季 | {row[2]} 至 {row[3]} | xG=0")


def filter_existing_records(connection: sqlite3.Connection, records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Skip exact Europa League rows already included in a release snapshot."""
    existing = {
        tuple(row)
        for row in connection.execute(
            """SELECT league_code, season, match_date, home_team, away_team,
                      home_goals, away_goals
               FROM matches WHERE league_code = ?""",
            (LEAGUE_CODE,),
        )
    }
    filtered = [
        item for item in records
        if (
            item["league_code"], item["season"], item["match_date"],
            item["home_team"], item["away_team"], item["home_goals"], item["away_goals"]
        ) not in existing
    ]
    skipped = len(records) - len(filtered)
    if skipped:
        print(f"已從 Release 快照跳過完全重複歐霸賽事：{skipped:,} 場")
    return filtered


def main() -> None:
    parser = argparse.ArgumentParser(description="Extend database with UEFA Europa League results")
    parser.add_argument("--base-database", required=True)
    parser.add_argument("--open-results", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--as-of", help="UTC cutoff YYYY-MM-DD; defaults to today")
    args = parser.parse_args()
    base, parquet, output = Path(args.base_database).resolve(), Path(args.open_results).resolve(), Path(args.output).resolve()
    if not base.exists() or not parquet.exists():
        raise FileNotFoundError("找不到基礎資料庫或公開賽果Parquet")
    cutoff = date.fromisoformat(args.as_of) if args.as_of else datetime.now(timezone.utc).date()
    fetched_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    records = historical_records(parquet, cutoff, fetched_at) + current_season_records(cutoff, fetched_at)
    unique = {item["match_id"]: item for item in records}
    shutil.copy2(base, output)
    with sqlite3.connect(output) as connection:
        connection.execute("DELETE FROM team_stats")
        insert_matches(connection, filter_existing_records(connection, list(unique.values())))
        compute_team_stats(connection)
        validate(connection)
        connection.commit()
    print(f"已建立歐霸盃擴充資料庫：{output}")


if __name__ == "__main__":
    main()
