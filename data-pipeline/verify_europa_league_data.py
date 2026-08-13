#!/usr/bin/env python3
"""Validate the UEFA Europa League data contract in an Aurelia SQLite database."""

from __future__ import annotations

import argparse
import sqlite3
from datetime import date
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="驗證歐霸盃資料範圍與品質")
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--as-of", required=True, help="UTC cutoff YYYY-MM-DD")
    args = parser.parse_args()
    cutoff = date.fromisoformat(args.as_of)
    with sqlite3.connect(args.database) as connection:
        row = connection.execute(
            """SELECT COUNT(*), COUNT(DISTINCT season), MIN(match_date), MAX(match_date),
                      SUM(CASE WHEN home_xg IS NOT NULL OR away_xg IS NOT NULL THEN 1 ELSE 0 END),
                      SUM(CASE WHEN match_date > ? THEN 1 ELSE 0 END)
               FROM matches WHERE league_code = 'UEL'""",
            (cutoff.isoformat(),),
        ).fetchone()
        current_rows = connection.execute(
            "SELECT COUNT(*) FROM matches WHERE league_code = 'UEL' AND season = ?",
            (f"{cutoff.year}-{cutoff.year + 1}",),
        ).fetchone()[0]
    if not row or row[0] == 0 or row[1] < 5 or row[4] or row[5]:
        raise RuntimeError(f"歐霸盃資料驗證失敗：{row}")
    print(f"UEL matches={row[0]:,} seasons={row[1]} range={row[2]}..{row[3]} current_season_matches={current_rows} xG_rows=0 future_rows=0")


if __name__ == "__main__":
    main()
