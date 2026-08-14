#!/usr/bin/env python3
"""Quality gate for auditable Copa Sudamericana and Leagues Cup records."""

from __future__ import annotations

import argparse
import sqlite3
from datetime import date
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--as-of", required=True)
    args = parser.parse_args()
    cutoff = date.fromisoformat(args.as_of)
    with sqlite3.connect(args.database) as connection:
        rows = connection.execute(
            """
            SELECT league_code, COUNT(*), COUNT(DISTINCT season), MIN(match_date), MAX(match_date),
                   SUM(CASE WHEN home_xg IS NOT NULL OR away_xg IS NOT NULL THEN 1 ELSE 0 END),
                   SUM(CASE WHEN match_date > ? THEN 1 ELSE 0 END),
                   COUNT(DISTINCT source_url)
            FROM matches WHERE league_code IN ('SUD','LCUP') GROUP BY league_code ORDER BY league_code
            """,
            (cutoff.isoformat(),),
        ).fetchall()
        source_rows = connection.execute(
            "SELECT DISTINCT league_code, source_url FROM matches WHERE league_code IN ('SUD','LCUP')"
        ).fetchall()
    expected = {row[0]: row for row in rows}
    if set(expected) != {"SUD", "LCUP"}:
        raise RuntimeError(f"盃賽資料範圍不完整：{rows}")
    sud, lcup = expected["SUD"], expected["LCUP"]
    if sud[2] < 5 or lcup[1] < 100 or lcup[2] < 5:
        raise RuntimeError(f"盃賽歷史覆蓋不足：{rows}")
    if any(row[5] != 0 or row[6] != 0 for row in rows):
        raise RuntimeError(f"盃賽xG／日期品質檢核失敗：{rows}")
    sources = {code: set() for code in ("SUD", "LCUP")}
    for code, source_url in source_rows:
        sources[code].add(str(source_url))
    if not sources["SUD"] or not all(url.startswith(("https://raw.githubusercontent.com/schochastics/", "https://site.api.espn.com/apis/site/v2/sports/soccer/conmebol.sudamericana/scoreboard")) for url in sources["SUD"]):
        raise RuntimeError(f"Sudamericana來源不正確：{sources['SUD']}")
    if not sources["LCUP"] or not all(url.startswith("https://site.api.espn.com/apis/site/v2/sports/soccer/concacaf.leagues.cup/scoreboard") for url in sources["LCUP"]):
        raise RuntimeError(f"Leagues Cup來源不正確：{sources['LCUP']}")
    print({"as_of": cutoff.isoformat(), "competitions": rows})


if __name__ == "__main__":
    main()
