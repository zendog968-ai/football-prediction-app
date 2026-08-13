#!/usr/bin/env python3
"""Append auditable Copa Sudamericana and Leagues Cup records to a candidate DB.

Sudamericana uses the ODC-BY open-results parquet source.  Leagues Cup uses
the publicly readable ESPN scoreboard endpoint because the ODC-BY source's
``CONCACAF L`` label is the former CONCACAF League, not Leagues Cup.  Only
events explicitly marked full time are ingested; upcoming fixtures are never
used as training labels.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import requests

from build_expanded_leagues_db import match_id
from build_football_db import compute_team_stats, insert_matches


ODC_SOURCE_URL = "https://raw.githubusercontent.com/schochastics/football-data/master/data/results/games.parquet"
ESPN_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/concacaf.leagues.cup/scoreboard"
SUD_CODE = "SUD"
LCUP_CODE = "LCUP"


def normalized(value: Any) -> str:
    return " ".join(str(value).strip().split())


def result_of(home_goals: int, away_goals: int) -> str:
    return "H" if home_goals > away_goals else "A" if home_goals < away_goals else "D"


def base_record(*, code: str, name: str, season: str, match_date: str, match_time: str, home: str, away: str, home_goals: int, away_goals: int, source_url: str, fetched_at: str) -> dict[str, Any]:
    return {
        "match_id": match_id(code, season, match_date, home, away, home_goals, away_goals),
        "league_code": code,
        "league_name": name,
        "season": season,
        "match_date": match_date,
        "match_time": match_time,
        "home_team": home,
        "away_team": away,
        "home_goals": home_goals,
        "away_goals": away_goals,
        "result": result_of(home_goals, away_goals),
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


def sudamericana_records(parquet: Path, as_of: date, fetched_at: str) -> list[dict[str, Any]]:
    games = pd.read_parquet(parquet, columns=["competition", "date", "home", "away", "gh", "ga"])
    games["date"] = pd.to_datetime(games["date"], errors="coerce")
    subset = games[(games["competition"] == "Copa Sud") & (games["date"] >= pd.Timestamp("2002-01-01"))].copy()
    subset = subset.dropna(subset=["date", "home", "away", "gh", "ga"])
    subset = subset[subset["date"] <= pd.Timestamp(as_of)]
    records: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in subset.itertuples(index=False):
        home, away = normalized(row.home), normalized(row.away)
        try:
            home_goals, away_goals = int(row.gh), int(row.ga)
        except (TypeError, ValueError):
            continue
        if not home or not away or home == away or min(home_goals, away_goals) < 0:
            continue
        played = pd.Timestamp(row.date)
        record = base_record(
            code=SUD_CODE, name="CONMEBOL Sudamericana", season=str(played.year), match_date=played.date().isoformat(),
            match_time="12:00:00", home=home, away=away, home_goals=home_goals, away_goals=away_goals,
            source_url=ODC_SOURCE_URL, fetched_at=fetched_at,
        )
        if record["match_id"] not in seen:
            seen.add(record["match_id"])
            records.append(record)
    seasons = {record["season"] for record in records}
    if len(seasons) < 5:
        raise RuntimeError(f"Sudamericana完整賽季不足五個：{sorted(seasons)}")
    return records


def fetch_leagues_cup_year(year: int) -> tuple[list[dict[str, Any]], str]:
    response = requests.get(ESPN_URL, params={"dates": str(year), "limit": "500"}, timeout=30)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload.get("events"), list):
        raise RuntimeError(f"ESPN Leagues Cup {year} 回應缺少events清單")
    return payload["events"], str(response.url)


def leagues_cup_records(as_of: date, fetched_at: str, raw_out: Path | None) -> list[dict[str, Any]]:
    # 2020 was cancelled and 2022 did not stage the competition.  These years
    # remain queried for auditability but cannot contribute finished matches.
    years = range(2019, as_of.year + 1)
    records: list[dict[str, Any]] = []
    raw_by_year: dict[str, Any] = {}
    for year in years:
        events, source_url = fetch_leagues_cup_year(year)
        raw_by_year[str(year)] = events
        for event in events:
            status = str(event.get("status", {}).get("type", {}).get("name", ""))
            if status != "STATUS_FULL_TIME":
                continue
            played = pd.to_datetime(event.get("date"), errors="coerce", utc=True)
            if pd.isna(played) or played.date() > as_of:
                continue
            competitors = event.get("competitions", [{}])[0].get("competitors", [])
            home = next((row for row in competitors if row.get("homeAway") == "home"), None)
            away = next((row for row in competitors if row.get("homeAway") == "away"), None)
            if not home or not away:
                continue
            try:
                home_goals, away_goals = int(home["score"]), int(away["score"])
            except (KeyError, TypeError, ValueError):
                continue
            home_team = normalized(home.get("team", {}).get("displayName", ""))
            away_team = normalized(away.get("team", {}).get("displayName", ""))
            if not home_team or not away_team or home_team == away_team:
                continue
            record = base_record(
                code=LCUP_CODE, name="Leagues Cup", season=str(played.year), match_date=played.date().isoformat(),
                match_time=played.strftime("%H:%M:%S"), home=home_team, away=away_team,
                home_goals=home_goals, away_goals=away_goals, source_url=source_url, fetched_at=fetched_at,
            )
            record["match_id"] = hashlib.sha256(f"LCUP|ESPN|{event.get('id')}".encode("utf-8")).hexdigest()[:32]
            records.append(record)
    if raw_out:
        raw_out.parent.mkdir(parents=True, exist_ok=True)
        raw_out.write_text(json.dumps(raw_by_year, ensure_ascii=False), encoding="utf-8")
    editions = sorted({record["season"] for record in records})
    if len(editions) < 5 or len(records) < 100:
        raise RuntimeError(f"Leagues Cup歷史覆蓋不足：{len(records)}場，賽季{editions}")
    return records


def validate(connection: sqlite3.Connection) -> None:
    rows = connection.execute(
        "SELECT league_code, COUNT(*), COUNT(DISTINCT season), SUM(CASE WHEN home_xg IS NOT NULL OR away_xg IS NOT NULL THEN 1 ELSE 0 END) FROM matches WHERE league_code IN ('SUD','LCUP') GROUP BY league_code ORDER BY league_code"
    ).fetchall()
    indexed = {row[0]: row for row in rows}
    if SUD_CODE not in indexed or LCUP_CODE not in indexed:
        raise RuntimeError(f"盃賽資料缺失：{rows}")
    if indexed[SUD_CODE][2] < 5 or indexed[LCUP_CODE][2] < 5 or indexed[LCUP_CODE][1] < 100:
        raise RuntimeError(f"盃賽資料覆蓋不足：{rows}")
    if any(row[3] != 0 for row in rows):
        raise RuntimeError(f"盃賽xG欄位應保持NULL：{rows}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-database", type=Path, required=True)
    parser.add_argument("--open-results", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--as-of", help="UTC cutoff YYYY-MM-DD")
    parser.add_argument("--leagues-cup-raw-out", type=Path)
    args = parser.parse_args()
    as_of = date.fromisoformat(args.as_of) if args.as_of else datetime.now(timezone.utc).date()
    if not args.base_database.exists() or not args.open_results.exists():
        raise FileNotFoundError("找不到基礎資料庫或ODC-BY公開賽果快照")
    shutil.copy2(args.base_database, args.output)
    fetched_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    records = [*sudamericana_records(args.open_results, as_of, fetched_at), *leagues_cup_records(as_of, fetched_at, args.leagues_cup_raw_out)]
    with sqlite3.connect(args.output) as connection:
        connection.execute("DELETE FROM team_stats")
        insert_matches(connection, records)
        compute_team_stats(connection)
        validate(connection)
        connection.commit()
    print(json.dumps({"as_of": as_of.isoformat(), "sudamericana_matches": sum(row["league_code"] == SUD_CODE for row in records), "leagues_cup_matches": sum(row["league_code"] == LCUP_CODE for row in records)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
