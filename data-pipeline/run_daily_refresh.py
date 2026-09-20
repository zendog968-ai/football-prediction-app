#!/usr/bin/env python3
"""Build a complete, validated Aurelia Football data release from public sources."""

from __future__ import annotations

import argparse
import json
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlretrieve


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PIPELINE_DIR = PROJECT_ROOT / "data-pipeline"
SCRIPTS_DIR = PROJECT_ROOT / "scripts"
OPEN_RESULTS_URL = "https://raw.githubusercontent.com/schochastics/football-data/master/data/results/games.parquet"
LEAGUES = ("BRA1", "EPL", "LL", "BL", "SA", "L1", "MLS", "J1", "FIN1", "KOR1", "POR1", "MEX1", "AUS1", "UEL", "SUD", "LCUP")


def run(command: list[str]) -> None:
    print("+", " ".join(command), flush=True)
    subprocess.run(command, check=True, cwd=PROJECT_ROOT, timeout=3_600)


def representative_teams(database: Path, league_code: str) -> tuple[str, str]:
    with sqlite3.connect(database) as connection:
        season = connection.execute(
            "SELECT season FROM matches WHERE league_code = ? ORDER BY match_date DESC, match_id DESC LIMIT 1", (league_code,)
        ).fetchone()
        if not season:
            raise RuntimeError(f"{league_code}: missing matches")
        rows = connection.execute(
            """
            SELECT team FROM (
              SELECT home_team AS team FROM matches WHERE league_code = ? AND season = ?
              UNION ALL SELECT away_team AS team FROM matches WHERE league_code = ? AND season = ?
            ) GROUP BY team ORDER BY COUNT(*) DESC, team LIMIT 2
            """,
            (league_code, season[0], league_code, season[0]),
        ).fetchall()
    if len(rows) != 2:
        raise RuntimeError(f"{league_code}: insufficient representative teams")
    return str(rows[0][0]), str(rows[1][0])


def smoke_predictions(database: Path, model: Path, output_dir: Path) -> None:
    for league_code in LEAGUES:
        home, away = representative_teams(database, league_code)
        result_path = output_dir / f"smoke-{league_code}.json"
        run([
            sys.executable, str(SCRIPTS_DIR / "predict_upcoming.py"), "--home", home, "--away", away,
            "--league", league_code, "--database", str(database), "--model", str(model), "--json-out", str(result_path),
        ])
        payload = json.loads(result_path.read_text(encoding="utf-8"))
        total = sum(payload["probabilities"].values())
        if abs(total - 1.0) > 1e-8:
            raise RuntimeError(f"{league_code}: probability total is {total}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build and validate daily Aurelia Football assets")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--as-of", help="UTC data cutoff YYYY-MM-DD; defaults to today")
    args = parser.parse_args()
    output = args.output_dir.resolve()
    model_dir = output / "model"
    output.mkdir(parents=True, exist_ok=True)
    model_dir.mkdir(parents=True, exist_ok=True)
    as_of_args = ["--as-of", args.as_of] if args.as_of else []

    base_database = output / "football_data.db"
    domestic_database = output / "football_data_13_leagues.db"
    europa_database = output / "football_data_europa.db"
    expanded_database = output / "football_data_expanded.db"
    parquet = output / "open_football_games.parquet"
    features = output / "training_features_expanded.csv"
    print(f"Downloading public open-results data: {OPEN_RESULTS_URL}", flush=True)
    urlretrieve(OPEN_RESULTS_URL, parquet)
    if parquet.stat().st_size < 1_000_000:
        raise RuntimeError("open-results download is unexpectedly small")

    run([sys.executable, str(PIPELINE_DIR / "build_football_db.py"), "--database", str(base_database), *as_of_args])
    run([
        sys.executable, str(PIPELINE_DIR / "build_expanded_leagues_db.py"), "--base-database", str(base_database),
        "--open-results", str(parquet), "--output", str(domestic_database), *as_of_args,
    ])
    run([
        sys.executable, str(PIPELINE_DIR / "build_europa_league_db.py"), "--base-database", str(domestic_database),
        "--open-results", str(parquet), "--output", str(europa_database), *as_of_args,
    ])
    run([
        sys.executable, str(PIPELINE_DIR / "build_sudamericana_leagues_cup_db.py"), "--base-database", str(europa_database),
        "--open-results", str(parquet), "--output", str(expanded_database), "--leagues-cup-raw-out", str(output / "leagues_cup_espn_snapshot.json"), "--sudamericana-raw-out", str(output / "sudamericana_espn_snapshot.json"), *as_of_args,
    ])
    validation_cutoff = args.as_of or datetime.now(timezone.utc).date().isoformat()
    run([sys.executable, str(PIPELINE_DIR / "verify_europa_league_data.py"), "--database", str(expanded_database), "--as-of", validation_cutoff])
    run([sys.executable, str(PIPELINE_DIR / "verify_cup_data.py"), "--database", str(expanded_database), "--as-of", validation_cutoff])
    run([sys.executable, str(PIPELINE_DIR / "verify_odds_data.py"), "--database", str(expanded_database)])
    result_sync_report = output / "result_sync_report.json"
    run([
        sys.executable, str(PIPELINE_DIR / "daily_update.py"), "--database", str(expanded_database),
        "--input-parquet", str(parquet), "--as-of", validation_cutoff, "--report-out", str(result_sync_report),
    ])
    completed_result_sync = json.loads(result_sync_report.read_text(encoding="utf-8"))
    quality_gate = completed_result_sync.get("quality_gate", {})
    if not quality_gate.get("passed"):
        raise RuntimeError(f"結果同步品質閘門未通過：{quality_gate.get('failures', [])}")
    run([sys.executable, str(SCRIPTS_DIR / "build_match_features.py"), "--database", str(expanded_database), "--output", str(features)])
    run([sys.executable, str(PIPELINE_DIR / "train_soccer_predict_model.py"), "--input", str(features), "--output-dir", str(model_dir)])
    performance = output / "model_performance_filters.json"
    run([
        sys.executable, str(SCRIPTS_DIR / "build_performance_dashboard_data.py"),
        "--metrics", str(model_dir / "cross_validation_metrics.csv"), "--oof", str(model_dir / "oof_predictions.csv"), "--output", str(performance),
    ])
    model = model_dir / "soccer_predict_model.pkl"
    smoke_predictions(expanded_database, model, output)

    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    manifest = {
        "schema_version": 1,
        "generated_at": generated_at,
        "release_tag": "pending-publication",
        "assets": {
            "database": "football_data_expanded.db",
            "model": "soccer_predict_model.pkl",
            "performance": "model_performance_filters.json",
        },
        "validated_leagues": list(LEAGUES),
        "completed_result_sync": completed_result_sync,
    }
    (output / "pipeline_status.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
