#!/usr/bin/env python3
"""Expose supported leagues and teams from the local inference SQLite database."""

from __future__ import annotations

import argparse
import json
import sqlite3


def build_payload(connection: sqlite3.Connection, league: str | None = None) -> dict[str, object]:
    connection.row_factory = sqlite3.Row
    leagues = [
        dict(row)
        for row in connection.execute(
            """
            SELECT league_code AS code, league_name AS name,
                   MIN(CASE WHEN home_goals IS NOT NULL AND away_goals IS NOT NULL THEN match_date END) AS first_completed_date,
                   MAX(CASE WHEN home_goals IS NOT NULL AND away_goals IS NOT NULL THEN match_date END) AS cutoff_date,
                   MAX(fetched_at) AS last_updated_at,
                   COUNT(*) AS match_count,
                   SUM(CASE WHEN home_goals IS NOT NULL AND away_goals IS NOT NULL THEN 1 ELSE 0 END) AS completed_match_count
            FROM matches
            GROUP BY league_code, league_name
            ORDER BY CASE league_code
                WHEN 'BRA1' THEN 1 WHEN 'E0' THEN 2 WHEN 'SP1' THEN 3
                WHEN 'D1' THEN 4 WHEN 'I1' THEN 5 WHEN 'F1' THEN 6 ELSE 99 END
            """
        )
    ]
    if league:
        teams = [
            row[0]
            for row in connection.execute(
                """
                SELECT DISTINCT team FROM (
                    SELECT home_team AS team FROM matches WHERE league_code = ?
                    UNION
                    SELECT away_team AS team FROM matches WHERE league_code = ?
                )
                ORDER BY team
                """,
                (league, league),
            )
        ]
    else:
        teams = []

    completed_ranges = [league for league in leagues if league["first_completed_date"] and league["cutoff_date"]]
    payload = {
        "leagues": leagues,
        "teams": teams,
        "coverage": {
            "scopeCount": len(leagues),
            "totalMatches": sum(int(league["match_count"] or 0) for league in leagues),
            "totalCompletedMatches": sum(int(league["completed_match_count"] or 0) for league in leagues),
            "firstDate": min((league["first_completed_date"] for league in completed_ranges), default=None),
            "lastDate": max((league["cutoff_date"] for league in completed_ranges), default=None),
            "lastUpdatedAt": max((league["last_updated_at"] for league in leagues if league["last_updated_at"]), default=None),
            "model": "校準後 XGBoost 三分類模型",
            "disclaimer": "預測只使用資料庫最後一場已完成比賽前可得的歷史資料；不包含即時傷停、先發、天氣或賠率。",
        },
    }
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="List football prediction database metadata and teams")
    parser.add_argument("--database", required=True)
    parser.add_argument("--league")
    args = parser.parse_args()

    with sqlite3.connect(args.database) as connection:
        payload = build_payload(connection, args.league)
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
