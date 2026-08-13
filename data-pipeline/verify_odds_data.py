#!/usr/bin/env python3
"""Verify the historical closing-odds contract in a football SQLite database."""

from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="驗證歷史終盤賠率欄位與資料完整性")
    parser.add_argument("--database", required=True, type=Path)
    args = parser.parse_args()

    with sqlite3.connect(args.database) as connection:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(matches)")}
        required = {"home_odds", "draw_odds", "away_odds", "odds_source"}
        missing = required - columns
        if missing:
            raise RuntimeError(f"matches缺少終盤賠率欄位：{sorted(missing)}")
        total, complete, invalid, sourced = connection.execute(
            """
            SELECT COUNT(*),
                   SUM(CASE WHEN home_odds IS NOT NULL AND draw_odds IS NOT NULL AND away_odds IS NOT NULL THEN 1 ELSE 0 END),
                   SUM(CASE WHEN (home_odds IS NOT NULL AND home_odds <= 1.0)
                              OR (draw_odds IS NOT NULL AND draw_odds <= 1.0)
                              OR (away_odds IS NOT NULL AND away_odds <= 1.0) THEN 1 ELSE 0 END),
                   SUM(CASE WHEN odds_source IS NOT NULL THEN 1 ELSE 0 END)
            FROM matches
            """
        ).fetchone()
        if invalid:
            raise RuntimeError(f"發現{invalid}筆無效十進制賠率")
        if complete != sourced:
            raise RuntimeError(f"完整賠率列({complete})與來源列({sourced})不一致")
        by_league = connection.execute(
            """
            SELECT league_code, COUNT(*) AS matches,
                   SUM(CASE WHEN home_odds IS NOT NULL AND draw_odds IS NOT NULL AND away_odds IS NOT NULL THEN 1 ELSE 0 END) AS complete_odds
            FROM matches GROUP BY league_code ORDER BY league_code
            """
        ).fetchall()

    print(f"matches：{total:,}")
    print(f"完整終盤賠率：{complete:,}")
    print("聯賽 | 賽事 | 完整終盤賠率")
    for league, matches, odds in by_league:
        print(f"{league} | {matches:,} | {odds:,}")


if __name__ == "__main__":
    main()
