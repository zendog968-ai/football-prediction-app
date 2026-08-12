#!/usr/bin/env python3
"""Expose supported leagues and teams from the local inference SQLite database."""

from __future__ import annotations

import argparse
import json
import sqlite3


def main() -> None:
    parser = argparse.ArgumentParser(description="List football prediction database metadata and teams")
    parser.add_argument("--database", required=True)
    parser.add_argument("--league")
    args = parser.parse_args()

    with sqlite3.connect(args.database) as connection:
        connection.row_factory = sqlite3.Row
        leagues = [
            dict(row)
            for row in connection.execute(
                """
                SELECT league_code AS code, league_name AS name,
                       MIN(match_date) AS first_date, MAX(match_date) AS last_date,
                       COUNT(*) AS match_count
                FROM matches
                GROUP BY league_code, league_name
                ORDER BY CASE league_code
                    WHEN 'BRA1' THEN 1 WHEN 'E0' THEN 2 WHEN 'SP1' THEN 3
                    WHEN 'D1' THEN 4 WHEN 'I1' THEN 5 WHEN 'F1' THEN 6 ELSE 99 END
                """
            )
        ]
        if args.league:
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
                    (args.league, args.league),
                )
            ]
        else:
            teams = []

    payload = {
        "leagues": leagues,
        "teams": teams,
        "coverage": {
            "firstDate": min((league["first_date"] for league in leagues), default=None),
            "lastDate": max((league["last_date"] for league in leagues), default=None),
            "model": "校準後 XGBoost 三分類模型",
            "disclaimer": "預測只使用資料庫最後一場已完成比賽前可得的歷史資料；不包含即時傷停、先發、天氣或賠率。",
        },
    }
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
