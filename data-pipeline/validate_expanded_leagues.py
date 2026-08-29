#!/usr/bin/env python3
"""Smoke-test all newly added leagues through the exact command-line inference path."""

from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path


BASE_DIR = Path(__file__).parent
DATABASE = BASE_DIR / "football_data_expanded.db"
MODEL = BASE_DIR / "expanded_model_artifacts" / "soccer_predict_model.pkl"
PREDICTOR = BASE_DIR.parent / "scripts" / "predict_upcoming.py"
LEAGUES = ["MLS", "J1", "FIN1", "KOR1", "POR1", "MEX1", "AUS1", "ARG1"]


def representative_teams(connection: sqlite3.Connection, league_code: str) -> tuple[str, str, str]:
    season = connection.execute(
        "SELECT season FROM matches WHERE league_code = ? ORDER BY match_date DESC, match_id DESC LIMIT 1",
        (league_code,),
    ).fetchone()
    if not season:
        raise RuntimeError(f"{league_code}: missing matches")
    rows = connection.execute(
        """
        SELECT team, COUNT(*) AS appearances
        FROM (
          SELECT home_team AS team FROM matches WHERE league_code = ? AND season = ?
          UNION ALL
          SELECT away_team AS team FROM matches WHERE league_code = ? AND season = ?
        )
        GROUP BY team
        ORDER BY appearances DESC, team
        LIMIT 2
        """,
        (league_code, season[0], league_code, season[0]),
    ).fetchall()
    if len(rows) < 2:
        raise RuntimeError(f"{league_code}: insufficient teams")
    return str(season[0]), str(rows[0][0]), str(rows[1][0])


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", type=Path)
    parser.add_argument("--model", type=Path)
    parser.add_argument("--as-of", help="Not used but accepted for compatibility")
    args = parser.parse_args()

    database = args.database or DATABASE
    model = args.model or MODEL

    if not database.exists() or not model.exists():
        raise FileNotFoundError(f"Missing: {database} or {model}")
    results = []
    with sqlite3.connect(database) as connection, tempfile.TemporaryDirectory(prefix="expanded-league-smoke-") as temp_dir:
        for league_code in LEAGUES:
            season, home, away = representative_teams(connection, league_code)
            output = Path(temp_dir) / f"{league_code}.json"
            command = [
                sys.executable, str(PREDICTOR), "--home", home, "--away", away,
                "--league", league_code, "--database", str(database), "--model", str(model),
                "--json-out", str(output),
            ]
            completed = subprocess.run(command, check=True, text=True, capture_output=True, timeout=180)
            payload = json.loads(output.read_text(encoding="utf-8"))
            probability_sum = sum(payload["probabilities"].values())
            if abs(probability_sum - 1.0) > 1e-8:
                raise RuntimeError(f"{league_code}: invalid probability total {probability_sum}")
            results.append({
                "league_code": league_code,
                "season": season,
                "home_team": payload["home_team"],
                "away_team": payload["away_team"],
                "prediction_as_of": payload["prediction_as_of"],
                "probability_sum": round(probability_sum, 10),
                "stdout_last_line": completed.stdout.strip().splitlines()[-1],
            })
    report = {"validated_leagues": len(results), "results": results}
    report_path = BASE_DIR / "expanded_league_smoke_report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
