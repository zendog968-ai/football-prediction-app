#!/usr/bin/env python3
"""擴充既有 football_data.db，納入七個新增聯賽的五季公開賽果。

來源：schochastics/football-data 的 games.parquet（ODC-BY）。
來源僅提供主客隊、日期和完賽比分；xG與事件欄位一律保留為NULL。
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

from build_football_db import compute_team_stats, insert_matches

SOURCE_URL = "https://raw.githubusercontent.com/schochastics/football-data/master/data/results/games.parquet"
TARGETS = {
    "united-states": ("MLS", "Major League Soccer", "calendar"),
    "japan": ("J1", "J1 League", "calendar"),
    "finland": ("FIN1", "Veikkausliiga", "calendar"),
    "korea-republic": ("KOR1", "K League 1", "calendar"),
    "portugal": ("POR1", "Primeira Liga", "split"),
    "mexico": ("MEX1", "Liga MX", "mexico"),
    "australia": ("AUS1", "A-League Men", "split"),
}


def season_label(date: pd.Timestamp, mode: str) -> str:
    if mode == "calendar":
        return str(date.year)
    if mode == "mexico":
        return f"{date.year}-{'Clausura' if date.month <= 6 else 'Apertura'}"
    start_year = date.year if date.month >= 7 else date.year - 1
    return f"{start_year}-{start_year + 1}"


def allowed_date(match_date: pd.Timestamp, mode: str, reference_date: date) -> bool:
    """Keep a rolling five-complete-season window plus available current results."""
    if mode in {"calendar", "mexico"}:
        start = pd.Timestamp(year=reference_date.year - 5, month=1, day=1)
    else:
        # 跨年聯賽須多回看一個曆年，才能在來源尚未提供當季時保留五個完整賽季。
        start = pd.Timestamp(year=reference_date.year - 6, month=8, day=1)
    return start <= match_date <= pd.Timestamp(reference_date)


def match_id(league: str, season: str, date: str, home: str, away: str, home_goals: int, away_goals: int) -> str:
    raw = "|".join([league, season, date, home, away, str(home_goals), str(away_goals)])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def make_records(parquet_path: Path, reference_date: date) -> list[dict[str, Any]]:
    games = pd.read_parquet(parquet_path, columns=["home", "away", "date", "gh", "ga", "full_time", "competition"])
    games["date"] = pd.to_datetime(games["date"], errors="coerce")
    fetched_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    records: list[dict[str, Any]] = []

    for source_competition, (league_code, league_name, mode) in TARGETS.items():
        subset = games[games["competition"] == source_competition].copy()
        subset = subset.dropna(subset=["date", "home", "away", "gh", "ga"])
        subset = subset[subset["date"].map(lambda match_date: allowed_date(match_date, mode, reference_date))]
        seen: set[str] = set()
        for row in subset.itertuples(index=False):
            home = " ".join(str(row.home).strip().split())
            away = " ".join(str(row.away).strip().split())
            home_goals, away_goals = int(row.gh), int(row.ga)
            if not home or not away or home == away or home_goals < 0 or away_goals < 0:
                continue
            date = pd.Timestamp(row.date)
            season = season_label(date, mode)
            date_text = date.date().isoformat()
            identifier = match_id(league_code, season, date_text, home, away, home_goals, away_goals)
            if identifier in seen:
                continue
            seen.add(identifier)
            result = "H" if home_goals > away_goals else "A" if home_goals < away_goals else "D"
            records.append({
                "match_id": identifier, "league_code": league_code, "league_name": league_name,
                "season": season, "match_date": date_text, "match_time": "12:00:00",
                "home_team": home, "away_team": away, "home_goals": home_goals, "away_goals": away_goals,
                "result": result, "half_home_goals": None, "half_away_goals": None,
                "home_xg": None, "away_xg": None, "home_shots": None, "away_shots": None,
                "home_shots_target": None, "away_shots_target": None, "home_corners": None, "away_corners": None,
                "home_yellow_cards": None, "away_yellow_cards": None, "home_red_cards": None, "away_red_cards": None,
                "home_odds": None, "draw_odds": None, "away_odds": None, "odds_source": None,
                "source_url": SOURCE_URL, "fetched_at": fetched_at,
            })
        seasons = sorted({record["season"] for record in records if record["league_code"] == league_code})
        if not records or len(seasons) < 5:
            raise RuntimeError(f"{league_name}的完整賽季不足五個：{seasons}")
        print(f"{league_name}: {len([record for record in records if record['league_code'] == league_code]):,} 場，{', '.join(seasons)}")
    return records


def validate(connection: sqlite3.Connection) -> None:
    rows = connection.execute(
        """SELECT league_code, COUNT(*), COUNT(DISTINCT season),
                  SUM(CASE WHEN home_xg IS NOT NULL OR away_xg IS NOT NULL THEN 1 ELSE 0 END)
           FROM matches WHERE league_code IN ('MLS','J1','FIN1','KOR1','POR1','MEX1','AUS1')
           GROUP BY league_code ORDER BY league_code"""
    ).fetchall()
    if len(rows) != 7 or any(row[1] == 0 or row[2] < 5 or row[3] != 0 for row in rows):
        raise RuntimeError(f"新增聯賽資料驗證失敗：{rows}")
    print("\n驗證完成：所有新增聯賽均含至少五個賽季，且xG欄位保持NULL。")
    for row in rows:
        print(f"{row[0]} | {row[1]:,} 場 | {row[2]} 個賽季 | xG賽事 {row[3]}")


def main() -> None:
    parser = argparse.ArgumentParser(description="建立含七個新增聯賽的擴充足球資料庫")
    parser.add_argument("--base-database", default="football_data.db")
    parser.add_argument("--open-results", default="open_football_games.parquet")
    parser.add_argument("--output", default="football_data_expanded.db")
    parser.add_argument("--as-of", help="資料窗口參考日期（YYYY-MM-DD；預設今天UTC）")
    args = parser.parse_args()

    base, source, output = (Path(args.base_database).resolve(), Path(args.open_results).resolve(), Path(args.output).resolve())
    if not base.exists() or not source.exists():
        raise FileNotFoundError("找不到基礎資料庫或公開賽果Parquet資料集")
    shutil.copy2(base, output)
    reference_date = date.fromisoformat(args.as_of) if args.as_of else datetime.now(timezone.utc).date()
    records = make_records(source, reference_date)
    with sqlite3.connect(output) as connection:
        connection.execute("DELETE FROM team_stats")
        insert_matches(connection, records)
        compute_team_stats(connection)
        validate(connection)
        connection.commit()
    print(f"\n擴充資料庫建立完成：{output}")


if __name__ == "__main__":
    main()
