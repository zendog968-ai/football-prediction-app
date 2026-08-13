#!/usr/bin/env python3
"""建立用於賽事勝率預測的足球 SQLite 資料庫。

資料來源：Football-Data.co.uk 公開 CSV。
資料範圍：
- 英超、義甲、西甲、德甲、法甲：2020-21 至 2024-25 五個完整賽季
- 巴甲：2020 至 2024 五個完整賽季

使用方式：
    python3 build_football_db.py --database football_data.db

本程式每次均重新建立 matches 與 team_stats，因而可安全重複執行。
Football-Data.co.uk 的欄位說明未列出比賽級 xG；因此本次將 home_xg / away_xg
及其彙總欄位保留為 NULL，絕不以非同一模型的估計值補齊。
"""

from __future__ import annotations

import argparse
import hashlib
import io
import logging
import sqlite3
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import requests

BASE_URL = "https://www.football-data.co.uk"
REQUEST_TIMEOUT_SECONDS = 30
USER_AGENT = "football-results-research/1.0 (public historical-data import)"

EUROPEAN_LEAGUES = {
    "EPL": {"name": "Premier League", "file_code": "E0"},
    "SA": {"name": "Serie A", "file_code": "I1"},
    "LL": {"name": "La Liga", "file_code": "SP1"},
    "BL": {"name": "Bundesliga", "file_code": "D1"},
    "L1": {"name": "Ligue 1", "file_code": "F1"},
}
BRAZIL_SOURCE_URL = f"{BASE_URL}/new/BRA.csv"


class SourceFetchError(RuntimeError):
    """公開資料來源無法下載或無法解析時使用。"""


def configure_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
        datefmt="%H:%M:%S",
    )


def create_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": USER_AGENT,
            "Accept": "text/csv,text/plain,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        }
    )
    return session


def download_csv(session: requests.Session, url: str) -> pd.DataFrame:
    """下載CSV並處理UTF-8 BOM、少量不規則欄位與空白列。"""
    try:
        response = session.get(url, timeout=REQUEST_TIMEOUT_SECONDS)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise SourceFetchError(f"下載失敗：{url} ({exc})") from exc

    try:
        dataframe = pd.read_csv(
            io.BytesIO(response.content),
            encoding="utf-8-sig",
            on_bad_lines="skip",
            low_memory=False,
        )
    except Exception as exc:
        raise SourceFetchError(f"CSV解析失敗：{url} ({exc})") from exc

    dataframe.columns = [str(column).strip().lstrip("\ufeff") for column in dataframe.columns]
    return dataframe.dropna(how="all")


def pick_column(dataframe: pd.DataFrame, *candidates: str, required: bool = False) -> str | None:
    normalized = {column.strip().casefold(): column for column in dataframe.columns}
    for candidate in candidates:
        found = normalized.get(candidate.casefold())
        if found:
            return found
    if required:
        raise SourceFetchError(f"CSV缺少必要欄位之一：{', '.join(candidates)}")
    return None


def nullable_int(value: Any) -> int | None:
    if value is None or pd.isna(value):
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def nullable_float(value: Any) -> float | None:
    if value is None or pd.isna(value):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def clean_team_name(value: Any) -> str:
    return " ".join(str(value).strip().split())


def make_match_id(
    league_code: str,
    season: str,
    match_date: str,
    home_team: str,
    away_team: str,
    home_goals: int,
    away_goals: int,
) -> str:
    raw = "|".join(
        [league_code, season, match_date, home_team, away_team, str(home_goals), str(away_goals)]
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def extract_matches(
    dataframe: pd.DataFrame,
    league_code: str,
    league_name: str,
    season: str,
    source_url: str,
) -> list[dict[str, Any]]:
    """統一歐洲與巴甲CSV欄位名稱，僅保留已完成的聯賽賽事。"""
    date_col = pick_column(dataframe, "Date", required=True)
    time_col = pick_column(dataframe, "Time")
    home_col = pick_column(dataframe, "HomeTeam", "Home", required=True)
    away_col = pick_column(dataframe, "AwayTeam", "Away", required=True)
    home_goals_col = pick_column(dataframe, "FTHG", "HG", required=True)
    away_goals_col = pick_column(dataframe, "FTAG", "AG", required=True)
    result_col = pick_column(dataframe, "FTR", "Res")
    half_home_goals_col = pick_column(dataframe, "HTHG")
    half_away_goals_col = pick_column(dataframe, "HTAG")

    # Football-Data.co.uk的公開欄位不含xG；下列備援可讓未來若來源加欄位時自動匯入。
    home_xg_col = pick_column(dataframe, "HomeXG", "HxG", "home_xg")
    away_xg_col = pick_column(dataframe, "AwayXG", "AxG", "away_xg")
    home_shots_col = pick_column(dataframe, "HS")
    away_shots_col = pick_column(dataframe, "AS")
    home_shots_target_col = pick_column(dataframe, "HST")
    away_shots_target_col = pick_column(dataframe, "AST")
    home_corners_col = pick_column(dataframe, "HC")
    away_corners_col = pick_column(dataframe, "AC")
    home_yellows_col = pick_column(dataframe, "HY")
    away_yellows_col = pick_column(dataframe, "AY")
    home_reds_col = pick_column(dataframe, "HR")
    away_reds_col = pick_column(dataframe, "AR")
    # 優先採市場平均終盤1X2賠率。Football-Data以欄名中的C標示終盤資料；
    # 若當季未提供市場平均終盤資料，保留NULL，不以開盤或非終盤數據替代。
    closing_home_odds_col = pick_column(dataframe, "AvgCH")
    closing_draw_odds_col = pick_column(dataframe, "AvgCD")
    closing_away_odds_col = pick_column(dataframe, "AvgCA")

    records: list[dict[str, Any]] = []
    match_ids: set[str] = set()
    fetched_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    for _, row in dataframe.iterrows():
        match_date = pd.to_datetime(row[date_col], dayfirst=True, errors="coerce")
        home_team = clean_team_name(row[home_col])
        away_team = clean_team_name(row[away_col])
        home_goals = nullable_int(row[home_goals_col])
        away_goals = nullable_int(row[away_goals_col])

        if pd.isna(match_date) or not home_team or not away_team:
            continue
        if home_team.lower() == "nan" or away_team.lower() == "nan":
            continue
        if home_goals is None or away_goals is None:
            continue

        calculated_result = "H" if home_goals > away_goals else "A" if away_goals > home_goals else "D"
        stated_result = str(row[result_col]).strip() if result_col and not pd.isna(row[result_col]) else ""
        result = stated_result if stated_result in {"H", "D", "A"} else calculated_result
        if result != calculated_result:
            logging.warning(
                "結果欄位與比分不一致，採用比分重算結果：%s %s vs %s", home_team, home_goals, away_team
            )
            result = calculated_result

        date_text = match_date.date().isoformat()
        match_id = make_match_id(
            league_code, season, date_text, home_team, away_team, home_goals, away_goals
        )
        if match_id in match_ids:
            continue
        match_ids.add(match_id)

        match_time = None
        if time_col and not pd.isna(row[time_col]):
            candidate_time = str(row[time_col]).strip()
            if candidate_time and candidate_time.lower() != "nan":
                match_time = candidate_time

        records.append(
            {
                "match_id": match_id,
                "league_code": league_code,
                "league_name": league_name,
                "season": season,
                "match_date": date_text,
                "match_time": match_time,
                "home_team": home_team,
                "away_team": away_team,
                "home_goals": home_goals,
                "away_goals": away_goals,
                "result": result,
                "half_home_goals": nullable_int(row[half_home_goals_col]) if half_home_goals_col else None,
                "half_away_goals": nullable_int(row[half_away_goals_col]) if half_away_goals_col else None,
                "home_xg": nullable_float(row[home_xg_col]) if home_xg_col else None,
                "away_xg": nullable_float(row[away_xg_col]) if away_xg_col else None,
                "home_shots": nullable_int(row[home_shots_col]) if home_shots_col else None,
                "away_shots": nullable_int(row[away_shots_col]) if away_shots_col else None,
                "home_shots_target": nullable_int(row[home_shots_target_col]) if home_shots_target_col else None,
                "away_shots_target": nullable_int(row[away_shots_target_col]) if away_shots_target_col else None,
                "home_corners": nullable_int(row[home_corners_col]) if home_corners_col else None,
                "away_corners": nullable_int(row[away_corners_col]) if away_corners_col else None,
                "home_yellow_cards": nullable_int(row[home_yellows_col]) if home_yellows_col else None,
                "away_yellow_cards": nullable_int(row[away_yellows_col]) if away_yellows_col else None,
                "home_red_cards": nullable_int(row[home_reds_col]) if home_reds_col else None,
                "away_red_cards": nullable_int(row[away_reds_col]) if away_reds_col else None,
                "home_odds": nullable_float(row[closing_home_odds_col]) if closing_home_odds_col else None,
                "draw_odds": nullable_float(row[closing_draw_odds_col]) if closing_draw_odds_col else None,
                "away_odds": nullable_float(row[closing_away_odds_col]) if closing_away_odds_col else None,
                "odds_source": "Football-Data market average closing 1X2" if closing_home_odds_col and closing_draw_odds_col and closing_away_odds_col else None,
                "source_url": source_url,
                "fetched_at": fetched_at,
            }
        )
    return records


def create_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        DROP TABLE IF EXISTS team_stats;
        DROP TABLE IF EXISTS matches;

        CREATE TABLE matches (
            match_id TEXT PRIMARY KEY,
            league_code TEXT NOT NULL,
            league_name TEXT NOT NULL,
            season TEXT NOT NULL,
            match_date TEXT NOT NULL,
            match_time TEXT,
            home_team TEXT NOT NULL,
            away_team TEXT NOT NULL,
            home_goals INTEGER NOT NULL CHECK(home_goals >= 0),
            away_goals INTEGER NOT NULL CHECK(away_goals >= 0),
            result TEXT NOT NULL CHECK(result IN ('H', 'D', 'A')),
            half_home_goals INTEGER,
            half_away_goals INTEGER,
            home_xg REAL,
            away_xg REAL,
            home_shots INTEGER,
            away_shots INTEGER,
            home_shots_target INTEGER,
            away_shots_target INTEGER,
            home_corners INTEGER,
            away_corners INTEGER,
            home_yellow_cards INTEGER,
            away_yellow_cards INTEGER,
            home_red_cards INTEGER,
            away_red_cards INTEGER,
            home_odds REAL CHECK(home_odds IS NULL OR home_odds > 1.0),
            draw_odds REAL CHECK(draw_odds IS NULL OR draw_odds > 1.0),
            away_odds REAL CHECK(away_odds IS NULL OR away_odds > 1.0),
            odds_source TEXT,
            source_url TEXT NOT NULL,
            fetched_at TEXT NOT NULL,
            UNIQUE(league_code, season, match_date, home_team, away_team, home_goals, away_goals)
        );

        CREATE INDEX idx_matches_league_season_date
          ON matches(league_code, season, match_date);
        CREATE INDEX idx_matches_home_team
          ON matches(home_team);
        CREATE INDEX idx_matches_away_team
          ON matches(away_team);

        CREATE TABLE team_stats (
            league_code TEXT NOT NULL,
            league_name TEXT NOT NULL,
            season TEXT NOT NULL,
            team TEXT NOT NULL,
            venue TEXT NOT NULL CHECK(venue IN ('home', 'away', 'overall')),
            matches_played INTEGER NOT NULL,
            wins INTEGER NOT NULL,
            draws INTEGER NOT NULL,
            losses INTEGER NOT NULL,
            points INTEGER NOT NULL,
            goals_for INTEGER NOT NULL,
            goals_against INTEGER NOT NULL,
            goal_difference INTEGER NOT NULL,
            shots_for INTEGER,
            shots_against INTEGER,
            shots_target_for INTEGER,
            shots_target_against INTEGER,
            corners_for INTEGER,
            corners_against INTEGER,
            yellow_cards INTEGER,
            red_cards INTEGER,
            xg_for REAL,
            xg_against REAL,
            xg_difference REAL,
            xg_matches INTEGER NOT NULL,
            avg_goals_for REAL NOT NULL,
            avg_goals_against REAL NOT NULL,
            avg_xg_for REAL,
            avg_xg_against REAL,
            calculated_at TEXT NOT NULL,
            PRIMARY KEY(league_code, season, team, venue)
        );

        CREATE INDEX idx_team_stats_league_season_team
          ON team_stats(league_code, season, team);
        """
    )


def insert_matches(connection: sqlite3.Connection, records: list[dict[str, Any]]) -> None:
    columns = [
        "match_id", "league_code", "league_name", "season", "match_date", "match_time",
        "home_team", "away_team", "home_goals", "away_goals", "result", "half_home_goals",
        "half_away_goals", "home_xg", "away_xg", "home_shots", "away_shots",
        "home_shots_target", "away_shots_target", "home_corners", "away_corners",
        "home_yellow_cards", "away_yellow_cards", "home_red_cards", "away_red_cards",
        "home_odds", "draw_odds", "away_odds", "odds_source",
        "source_url", "fetched_at",
    ]
    placeholders = ", ".join("?" for _ in columns)
    connection.executemany(
        f"INSERT INTO matches ({', '.join(columns)}) VALUES ({placeholders})",
        [tuple(record[column] for column in columns) for record in records],
    )


def compute_team_stats(connection: sqlite3.Connection) -> None:
    """由賽事表計算主場、客場與整體隊伍統計；不使用未來資料。"""
    rows = connection.execute(
        """
        WITH team_matches AS (
            SELECT
                league_code, league_name, season, home_team AS team, 'home' AS venue,
                home_goals AS goals_for, away_goals AS goals_against,
                home_shots AS shots_for, away_shots AS shots_against,
                home_shots_target AS shots_target_for, away_shots_target AS shots_target_against,
                home_corners AS corners_for, away_corners AS corners_against,
                home_yellow_cards AS yellow_cards, home_red_cards AS red_cards,
                home_xg AS xg_for, away_xg AS xg_against,
                CASE WHEN result = 'H' THEN 1 ELSE 0 END AS wins,
                CASE WHEN result = 'D' THEN 1 ELSE 0 END AS draws,
                CASE WHEN result = 'A' THEN 1 ELSE 0 END AS losses
            FROM matches
            UNION ALL
            SELECT
                league_code, league_name, season, away_team AS team, 'away' AS venue,
                away_goals AS goals_for, home_goals AS goals_against,
                away_shots AS shots_for, home_shots AS shots_against,
                away_shots_target AS shots_target_for, home_shots_target AS shots_target_against,
                away_corners AS corners_for, home_corners AS corners_against,
                away_yellow_cards AS yellow_cards, away_red_cards AS red_cards,
                away_xg AS xg_for, home_xg AS xg_against,
                CASE WHEN result = 'A' THEN 1 ELSE 0 END AS wins,
                CASE WHEN result = 'D' THEN 1 ELSE 0 END AS draws,
                CASE WHEN result = 'H' THEN 1 ELSE 0 END AS losses
            FROM matches
        ),
        all_venues AS (
            SELECT * FROM team_matches
            UNION ALL
            SELECT league_code, league_name, season, team, 'overall', goals_for, goals_against,
                   shots_for, shots_against, shots_target_for, shots_target_against,
                   corners_for, corners_against, yellow_cards, red_cards,
                   xg_for, xg_against, wins, draws, losses
            FROM team_matches
        )
        SELECT
            league_code, league_name, season, team, venue,
            COUNT(*) AS matches_played,
            SUM(wins) AS wins, SUM(draws) AS draws, SUM(losses) AS losses,
            SUM(wins) * 3 + SUM(draws) AS points,
            SUM(goals_for) AS goals_for, SUM(goals_against) AS goals_against,
            SUM(goals_for) - SUM(goals_against) AS goal_difference,
            SUM(shots_for), SUM(shots_against),
            SUM(shots_target_for), SUM(shots_target_against),
            SUM(corners_for), SUM(corners_against),
            SUM(yellow_cards), SUM(red_cards),
            CASE WHEN COUNT(xg_for) > 0 THEN ROUND(SUM(xg_for), 2) END,
            CASE WHEN COUNT(xg_against) > 0 THEN ROUND(SUM(xg_against), 2) END,
            CASE WHEN COUNT(xg_for) > 0 AND COUNT(xg_against) > 0
                 THEN ROUND(SUM(xg_for) - SUM(xg_against), 2) END,
            SUM(CASE WHEN xg_for IS NOT NULL AND xg_against IS NOT NULL THEN 1 ELSE 0 END),
            ROUND(AVG(goals_for), 3), ROUND(AVG(goals_against), 3),
            CASE WHEN COUNT(xg_for) > 0 THEN ROUND(AVG(xg_for), 3) END,
            CASE WHEN COUNT(xg_against) > 0 THEN ROUND(AVG(xg_against), 3) END
        FROM all_venues
        GROUP BY league_code, league_name, season, team, venue
        ORDER BY league_code, season, team, venue
        """
    ).fetchall()

    calculated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    connection.executemany(
        """
        INSERT INTO team_stats (
            league_code, league_name, season, team, venue, matches_played, wins, draws, losses,
            points, goals_for, goals_against, goal_difference, shots_for, shots_against,
            shots_target_for, shots_target_against, corners_for, corners_against, yellow_cards,
            red_cards, xg_for, xg_against, xg_difference, xg_matches, avg_goals_for,
            avg_goals_against, avg_xg_for, avg_xg_against, calculated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [tuple(row) + (calculated_at,) for row in rows],
    )


def validate_database(connection: sqlite3.Connection) -> list[tuple[str, int, int, int]]:
    invalid_rows = connection.execute(
        """
        SELECT COUNT(*) FROM matches
        WHERE home_team = away_team OR home_goals < 0 OR away_goals < 0
           OR result NOT IN ('H', 'D', 'A')
           OR (result = 'H' AND home_goals <= away_goals)
           OR (result = 'A' AND home_goals >= away_goals)
           OR (result = 'D' AND home_goals <> away_goals)
        """
    ).fetchone()[0]
    if invalid_rows:
        raise RuntimeError(f"完整性檢查失敗：{invalid_rows}筆賽事不符合比分／結果規則")

    total_matches = connection.execute("SELECT COUNT(*) FROM matches").fetchone()[0]
    total_team_stats = connection.execute("SELECT COUNT(*) FROM team_stats").fetchone()[0]
    if total_matches == 0 or total_team_stats == 0:
        raise RuntimeError("資料庫建立失敗：matches或team_stats為空")

    return connection.execute(
        """
        SELECT
            league_name,
            COUNT(*) AS matches,
            SUM(CASE WHEN home_xg IS NOT NULL AND away_xg IS NOT NULL THEN 1 ELSE 0 END) AS matches_with_xg,
            COUNT(DISTINCT season) AS seasons
        FROM matches
        GROUP BY league_code, league_name
        ORDER BY league_name
        """
    ).fetchall()


def rolling_seasons(reference_date: date) -> tuple[dict[str, str], list[str], str | None]:
    """Return five completed seasons plus the current one when it has results.

    The action can pin ``reference_date`` for reproduction. A current-season URL
    without completed matches is skipped, while the five completed seasons remain
    mandatory so the calibration window never collapses during a new season.
    """
    completed_start = reference_date.year - 1 if reference_date.month >= 7 else reference_date.year - 2
    completed_starts = range(completed_start - 4, completed_start + 1)
    starts = list(completed_starts)
    current_start: int | None = reference_date.year if reference_date.month >= 7 else completed_start + 1
    if current_start not in starts:
        starts.append(current_start)
    european = {
        f"{start}-{start + 1}": f"{start % 100:02d}{(start + 1) % 100:02d}"
        for start in starts
    }
    brazil = [str(year) for year in range(completed_start - 4, completed_start + 1)]
    current_brazil = str(reference_date.year)
    if current_brazil not in brazil:
        brazil.append(current_brazil)
    current_label = f"{current_start}-{current_start + 1}" if current_start else None
    return european, brazil, current_label


def scrape_all_matches(session: requests.Session, reference_date: date) -> list[dict[str, Any]]:
    all_records: list[dict[str, Any]] = []
    european_seasons, brazil_seasons, current_european_season = rolling_seasons(reference_date)

    for season, url_season in european_seasons.items():
        for league_code, league in EUROPEAN_LEAGUES.items():
            source_url = f"{BASE_URL}/mmz4281/{url_season}/{league['file_code']}.csv"
            logging.info("擷取 %s %s", league["name"], season)
            try:
                dataframe = download_csv(session, source_url)
            except SourceFetchError:
                if season == current_european_season:
                    logging.info("  當季來源尚未提供可用檔案，略過：%s", source_url)
                    continue
                raise
            records = extract_matches(dataframe, league_code, league["name"], season, source_url)
            if not records:
                if season == current_european_season:
                    logging.info("  當季尚無已完成賽果，略過：%s", season)
                    continue
                raise SourceFetchError(f"{league['name']} {season} 沒有已完成賽事")
            logging.info("  匯入候選賽事：%s", len(records))
            all_records.extend(records)

    logging.info("擷取巴甲合併歷史CSV，並篩選最近完整五季及可用當季賽果")
    brazil_dataframe = download_csv(session, BRAZIL_SOURCE_URL)
    season_col = pick_column(brazil_dataframe, "Season", required=True)
    for season in brazil_seasons:
        season_dataframe = brazil_dataframe[brazil_dataframe[season_col].astype(str).str.strip() == season].copy()
        records = extract_matches(
            season_dataframe, "BRA1", "Campeonato Brasileiro Série A", season, BRAZIL_SOURCE_URL
        )
        if not records:
            if season == str(reference_date.year):
                logging.info("  巴甲當季尚無已完成賽果，略過：%s", season)
                continue
            raise SourceFetchError(f"巴甲 {season} 沒有已完成賽事")
        logging.info("  巴甲 %s：匯入候選賽事 %s", season, len(records))
        all_records.extend(records)

    return all_records


def main() -> int:
    parser = argparse.ArgumentParser(description="以Football-Data.co.uk公開CSV建立足球SQLite資料庫")
    parser.add_argument("--database", default="football_data.db", help="SQLite輸出檔案（預設football_data.db）")
    parser.add_argument("--as-of", help="資料窗口參考日期（YYYY-MM-DD；預設今天UTC）")
    parser.add_argument("--verbose", action="store_true", help="輸出除錯訊息")
    args = parser.parse_args()

    configure_logging(args.verbose)
    database_path = Path(args.database).expanduser().resolve()
    database_path.parent.mkdir(parents=True, exist_ok=True)

    logging.info("開始建立資料庫：%s", database_path)
    session = create_session()
    reference_date = date.fromisoformat(args.as_of) if args.as_of else datetime.now(timezone.utc).date()
    records = scrape_all_matches(session, reference_date)

    with sqlite3.connect(database_path) as connection:
        create_schema(connection)
        insert_matches(connection, records)
        compute_team_stats(connection)
        summary = validate_database(connection)
        connection.commit()

    print("\n=== 資料庫建立成功 ===")
    print(f"資料庫：{database_path}")
    print(f"matches：{len(records):,} 筆")
    print("team_stats：已依聯賽、賽季、球隊與主／客／整體維度建立")
    print("\n聯賽 | 賽事數 | 賽季數 | 完整xG賽事數")
    for league_name, matches, xg_matches, seasons in summary:
        print(f"{league_name} | {matches:,} | {seasons} | {xg_matches:,}")
    print("\nxG註記：Football-Data.co.uk目前公開CSV未提供比賽級xG，故xG欄位保留NULL。")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (SourceFetchError, RuntimeError) as exc:
        logging.critical("建立失敗：%s", exc)
        raise SystemExit(2)
